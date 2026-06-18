#!/usr/bin/env bash
# Deploy Shibeus FC to Vercel from YOUR machine. Your token stays local.
# Prereqs: Node + npm, run from the repo root after `git pull`.
#
# 1) Put your secrets in scripts/.env.fc (copy scripts/.env.fc.example), OR
#    export them in your shell. Required:
#      VERCEL_TOKEN, TREASURY_SECRET, FC_MASTER_SEED, FC_SESSION_SECRET,
#      KV_REST_API_URL, KV_REST_API_TOKEN
#    Optional: SOLANA_RPC_DEVNET (default https://api.devnet.solana.com)
# 2) Run:  bash scripts/deploy-vercel.sh
set -euo pipefail

[ -f scripts/.env.fc ] && { set -a; . scripts/.env.fc; set +a; }

need() { eval "v=\${$1:-}"; [ -n "$v" ] || { echo "✗ missing $1 (set it in scripts/.env.fc)"; exit 1; }; }
for k in VERCEL_TOKEN TREASURY_SECRET FC_MASTER_SEED FC_SESSION_SECRET KV_REST_API_URL KV_REST_API_TOKEN; do need "$k"; done
SOLANA_RPC_DEVNET="${SOLANA_RPC_DEVNET:-https://api.devnet.solana.com}"

VC() { npx --yes vercel@latest "$@" --token="$VERCEL_TOKEN"; }

echo "→ Linking this repo to your Vercel project…"
VC link --yes

set_env() {
  VC env rm "$1" production -y >/dev/null 2>&1 || true
  printf '%s' "$2" | VC env add "$1" production >/dev/null
  echo "  ✓ $1"
}
echo "→ Setting production environment variables…"
set_env TREASURY_SECRET    "$TREASURY_SECRET"
set_env FC_MASTER_SEED     "$FC_MASTER_SEED"
set_env FC_SESSION_SECRET  "$FC_SESSION_SECRET"
set_env KV_REST_API_URL    "$KV_REST_API_URL"
set_env KV_REST_API_TOKEN  "$KV_REST_API_TOKEN"
set_env SOLANA_RPC_DEVNET  "$SOLANA_RPC_DEVNET"

echo "→ Deploying current code to production…"
URL=$(VC deploy --prod --yes)
echo ""
echo "✓ Deployed: $URL"
echo "  Verify:  curl -s $URL/api/fc-config   (want \"configured\": true)"
echo "  Play:    $URL/fc.html"
