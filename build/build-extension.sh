#!/usr/bin/env bash
# 浏览器插件打包：注入版本号并生成 zip。
# 用法: build/build-extension.sh [版本号]
set -euo pipefail
cd "$(dirname "$0")/.."

APP_VERSION="${1:-}"
APP_VERSION="${APP_VERSION#v}"
APP_VERSION="${APP_VERSION:-0.0.0-dev}"

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

cp browser-plugin/manifest.json browser-plugin/newtab.html "$STAGING/"
# 用构建版本号替换 manifest 中的版本
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$APP_VERSION\"/" "$STAGING/manifest.json"
rm -f "$STAGING/manifest.json.bak"

mkdir -p dist
( cd "$STAGING" && zip -q -r - . ) > "dist/NewerTabX-extension-${APP_VERSION}.zip"

echo "Extension package: dist/NewerTabX-extension-${APP_VERSION}.zip"
