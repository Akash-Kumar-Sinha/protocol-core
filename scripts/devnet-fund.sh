#!/usr/bin/env bash
# Fund your devnet wallet using Helius RPC (bypasses public faucet rate limits).
#
# Usage:
#   export HELIUS_API_KEY="your-key-here"
#   ./scripts/devnet-fund.sh [target_sol]
#
# Or pass the key inline:
#   HELIUS_API_KEY="your-key" ./scripts/devnet-fund.sh 6
#
# Default target: 6 SOL

set -euo pipefail

if [ -z "${HELIUS_API_KEY:-}" ]; then
  echo "Error: HELIUS_API_KEY not set."
  echo ""
  echo "Usage:"
  echo "  export HELIUS_API_KEY=\"your-key-here\""
  echo "  ./scripts/devnet-fund.sh [target_sol]"
  exit 1
fi

TARGET_SOL="${1:-6}"
HELIUS_URL="https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}"
PUBKEY=$(solana address --keypair ~/.config/solana/id.json)

echo "Wallet:  ${PUBKEY}"
echo "Target:  ${TARGET_SOL} SOL"
echo "RPC:     Helius devnet"
echo "---"

while true; do
  # Check balance via Helius RPC
  balance_lamports=$(curl -s -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"${PUBKEY}\"]}" \
    "${HELIUS_URL}" | grep -o '"value":[0-9]*' | grep -o '[0-9]*' || echo "0")

  balance_sol=$(echo "scale=2; ${balance_lamports} / 1000000000" | bc 2>/dev/null || echo "0")
  target_lamports=$(echo "${TARGET_SOL} * 1000000000" | bc | cut -d. -f1)

  if [ "${balance_lamports}" -ge "${target_lamports}" ] 2>/dev/null; then
    echo "[$(date '+%H:%M:%S')] Done! Balance: ${balance_sol} SOL"
    exit 0
  fi

  # Request 1 SOL via Helius RPC
  result=$(curl -s -X POST -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"${PUBKEY}\",1000000000]}" \
    "${HELIUS_URL}")

  if echo "${result}" | grep -q '"result"'; then
    echo "[$(date '+%H:%M:%S')] +1 SOL requested. Balance: ${balance_sol} SOL"
    sleep 20
  else
    error=$(echo "${result}" | grep -o '"message":"[^"]*"' | head -1 || echo "unknown error")
    echo "[$(date '+%H:%M:%S')] Rate limited (${error}). Waiting 60s..."
    sleep 60
  fi
done
