#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
olmap_dir="${OLMAP_DIR:-$repo_root/../hiking-by-transit/packages/olmap}"
vendor_dir="$repo_root/vendor"
vendor_file="$vendor_dir/olmap-1.0.0.tgz"

if [[ ! -f "$olmap_dir/package.json" ]]; then
  echo "olmap package not found at $olmap_dir" >&2
  echo "Set OLMAP_DIR to override its location." >&2
  exit 1
fi

revendor_tmp="$(mktemp -d /tmp/amtrak-bike-map-revendor.XXXXXX)"
trap 'rm -rf -- "$revendor_tmp"' EXIT

npm --prefix "$olmap_dir" run build
npm pack "$olmap_dir" --pack-destination "$revendor_tmp"
mkdir -p "$vendor_dir"
mv "$revendor_tmp/olmap-1.0.0.tgz" "$vendor_file"
npm --prefix "$repo_root" install --package-lock-only --ignore-scripts --force

echo "Updated $vendor_file and package-lock.json"
