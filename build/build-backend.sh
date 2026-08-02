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
"$PYTHON" -m pip install -r backend/requirements.txt pyinstaller pillow
"$PYTHON" build/make-icon.py

echo "[4/4] PyInstaller build (usually under 2 minutes)"
"$PYTHON" -m PyInstaller --noconfirm --clean \
  --distpath dist \
  --workpath .pyinstaller-build \
  --name NewerTabX \
  --windowed \
  --icon assets/icon.ico \
  --add-data "backend/public;public" \
  --add-data "backend/app-meta.json;." \
  --collect-all uvicorn \
  --collect-all wsgidav \
  --collect-all fastapi \
  --collect-all starlette \
  --collect-all pydantic \
  --collect-submodules httpx \
  --collect-submodules anyio \
  backend/main.py

rm -f assets/icon.ico
rm -rf .pyinstaller-build NewerTabX.spec

echo
echo "Build complete: dist/NewerTabX/"
