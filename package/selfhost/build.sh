#!/usr/bin/env bash
# Builds the web app for self-hosting:
#   dist-selfhost/www                              web root to deploy
#   dist-selfhost/keeweb-<version>-<commit>.tar.gz the same as an archive

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ ! -d node_modules ]; then
    # install scripts download Electron and Chromium, the web app doesn't need them
    npm ci --ignore-scripts
fi

NODE_OPTIONS=--openssl-legacy-provider npx grunt build-web-app

out=dist-selfhost
version=$(node -p "require('./package.json').version")
commit=$(git describe --always --dirty --exclude '*')

rm -rf "$out"
mkdir -p "$out/www"
cp -R dist/. "$out/www/"
# oauth pages are used only by cloud storage providers, which are disabled in config.json
rm -rf "$out/www/oauth-result"
cp package/selfhost/config.json "$out/www/config.json"
node package/selfhost/patch-index.js "$out/www/index.html"

archive="$out/keeweb-$version-$commit-selfhost.tar.gz"
tar -czf "$archive" -C "$out/www" .

echo "Web root: $out/www"
echo "Archive:  $archive"
