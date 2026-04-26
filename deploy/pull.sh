#!/bin/bash
# Auto-deploy hook target. Pulls latest main, rebuilds, restarts the service.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "[deploy] pulling…"
git pull origin main

echo "[deploy] installing deps (skips if lockfile unchanged)…"
npm ci --silent

echo "[deploy] building shared + client…"
npm run build --workspace=@t4al/shared --workspace=@t4al/client

echo "[deploy] running migrations (no-op if none new)…"
npm run migrate --workspace=@t4al/server

echo "[deploy] restarting service…"
systemctl restart t4al

echo "[deploy] done."
