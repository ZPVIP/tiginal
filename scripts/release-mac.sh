#!/usr/bin/env bash
# Builds the macOS x64 and arm64 packages on this Mac and uploads them to a draft GitHub release.
set -euo pipefail
cd "$(dirname "$0")/.."

keychain_service="tiginal-github-release"
version="$(node -p "require('./package.json').version")"
tag="v${version}"

fail() {
  echo "release: $*" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS packages must be built on a Mac."
[[ -z "$(git status --porcelain)" ]] || fail "commit or stash your changes first."
[[ "$(git rev-parse HEAD)" == "$(git rev-list -n 1 "${tag}" 2>/dev/null)" ]] \
  || fail "HEAD is not tagged ${tag}. Run: npm version <new-version>"
git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null \
  || fail "tag ${tag} is not on GitHub yet. Run: git push --follow-tags"

if [[ -z "${GH_TOKEN:-}" ]]; then
  GH_TOKEN="$(security find-generic-password -s "${keychain_service}" -w 2>/dev/null)" \
    || fail "no GitHub token in the keychain. Run: security add-generic-password -a \"\$USER\" -s ${keychain_service} -w"
fi
export GH_TOKEN

npm ci
npm test
npm run build:renderer
npx electron-builder --mac --x64 --arm64 --publish always

echo "Uploaded draft release ${tag}. Review and publish it at https://github.com/ZPVIP/tiginal/releases"
