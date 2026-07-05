#!/bin/sh
# Run this ONCE on your Unraid server via SSH to build the Docker image.
# After this, manage the container entirely from the Unraid GUI.
#
# Usage:
#   bash /mnt/cache/appdata/diabloweb-build/build-on-unraid.sh

set -e

# Resolve the directory this script lives in, regardless of working directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

APPDATA="/mnt/cache/appdata/diabloweb"
BUILD_DIR="/mnt/cache/appdata/diabloweb-build"

echo "==> Creating appdata directories..."
mkdir -p "$APPDATA/mpq"
mkdir -p "$APPDATA/saves"
mkdir -p "$BUILD_DIR"

echo "==> Copying build files to $BUILD_DIR ..."
cp -r "$SCRIPT_DIR/." "$BUILD_DIR/"

echo "==> Building Docker image 'diabloweb:local' (this takes ~5 minutes)..."
cd "$BUILD_DIR"
docker build -t diabloweb:local .

echo ""
echo "============================================"
echo "  Build complete!  Image: diabloweb:local"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Unraid GUI -> Docker -> Add Container"
echo "  2. Fill in the fields from README.md"
echo "  3. Open http://$(hostname -i 2>/dev/null || echo YOUR-UNRAID-IP):8666"
echo ""
