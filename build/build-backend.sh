#!/usr/bin/env bash
# NewerTabX 后端打包脚本
# GitHub Actions 与手动构建共用本脚本。
# 用法: build/build-backend.sh [版本号] [owner/NewerTabX]
set -euo pipefail
cd "$(dirname "$0")/.."

APP_VERSION="${1:-}"
if [ -n "$APP_VERSION" ]; then
  APP_VERSION="${APP_VERSION#v}"
else
  APP_VERSION="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  APP_VERSION="${APP_VERSION#v}"
  [ -z "$APP_VERSION" ] && APP_VERSION="0.0.0"
  GIT_HASH="$(git rev-parse --short HEAD 2>/dev/null || true)"
  APP_VERSION="${APP_VERSION}-${GIT_HASH:-dev}"
fi

GITHUB_REPO="${2:-${GITHUB_REPO:-}}"

echo "[1/4] Writing app-meta.json (version=$APP_VERSION, repo=$GITHUB_REPO)"
printf '{"version": "%s", "repo": "%s"}\n' "$APP_VERSION" "$GITHUB_REPO" > backend/app-meta.json

echo "[2/4] Building frontend"
( cd frontend && npm ci && npm run build )

echo "[3/4] Installing Python dependencies"
PYTHON="$(command -v python3 || command -v python)"
"$PYTHON" -m pip install -r backend/requirements.txt nuitka pillow
"$PYTHON" build/make-icon.py

echo "[4/4] Nuitka standalone build (first run takes several minutes)"
OUTPUT_NAME="NewerTabX"
EXTRA_FLAGS=()
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    OUTPUT_NAME="NewerTabX.exe"
    EXTRA_FLAGS+=(--windows-console-mode=disable --windows-icon-from-ico=assets/icon.ico)
    ;;
esac
"$PYTHON" -m nuitka \
  --standalone \
  --include-package=uvicorn \
  --include-package=wsgidav \
  --include-package-data=wsgidav \
  --nofollow-import-to=tkinter \
  --nofollow-import-to=turtle \
  --nofollow-import-to=idlelib \
  --nofollow-import-to=unittest \
  --nofollow-import-to=doctest \
  --nofollow-import-to=pydoc \
  --include-data-dir=backend/public=public \
  --include-data-file=backend/app-meta.json=app-meta.json \
  --assume-yes-for-downloads \
  --output-dir=dist \
  --output-filename="$OUTPUT_NAME" \
  "${EXTRA_FLAGS[@]}" \
  backend/main.py

rm -f assets/icon.ico

rm -rf dist/NewerTabX
mv dist/main.dist dist/NewerTabX

echo
echo "Build complete: dist/NewerTabX/"
