#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -d node_modules ]]; then
  npm install --omit=dev
fi

# Prefer Node.js provisioner (works on Apple Silicon)
exec node provision-ec2.mjs "$@"
