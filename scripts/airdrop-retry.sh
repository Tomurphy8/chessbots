#!/bin/bash
# Retry Solana devnet airdrop every 30 minutes for 12 hours
# Usage: ./scripts/airdrop-retry.sh
# Stop with: Ctrl+C

SOLANA="/Users/thomasmurphy/.local/share/solana/install/active_release/bin/solana"
WALLET="GvrEVNQYRUonm7TMWgVGq9EdR1EQXZamxqrfgc82mDoh"
TARGET_SOL=2
INTERVAL=1800  # 30 minutes
MAX_ATTEMPTS=24 # 12 hours / 30 min = 24 attempts

echo "🎯 Solana Devnet Airdrop Retry Script"
echo "   Wallet: $WALLET"
echo "   Target: ${TARGET_SOL} SOL"
echo "   Retry every: $(($INTERVAL / 60)) minutes"
echo "   Max attempts: $MAX_ATTEMPTS (12 hours)"
echo "   Started: $(date)"
echo "---"

for i in $(seq 1 $MAX_ATTEMPTS); do
  BALANCE=$($SOLANA balance $WALLET --url devnet 2>/dev/null | awk '{print $1}')

  if (( $(echo "$BALANCE >= $TARGET_SOL" | bc -l 2>/dev/null || echo 0) )); then
    echo "✅ [$i/$MAX_ATTEMPTS] $(date) — Balance: ${BALANCE} SOL. Target reached!"
    echo "🎉 You're good to deploy. Run: anchor deploy --provider.cluster devnet"
    exit 0
  fi

  echo "⏳ [$i/$MAX_ATTEMPTS] $(date) — Balance: ${BALANCE:-0} SOL. Requesting airdrop..."

  # Try 2 SOL first, then 1 SOL as fallback
  if $SOLANA airdrop 2 $WALLET --url devnet 2>/dev/null; then
    echo "✅ Airdrop of 2 SOL succeeded!"
    NEW_BALANCE=$($SOLANA balance $WALLET --url devnet 2>/dev/null | awk '{print $1}')
    echo "   New balance: ${NEW_BALANCE} SOL"
    if (( $(echo "$NEW_BALANCE >= $TARGET_SOL" | bc -l 2>/dev/null || echo 0) )); then
      echo "🎉 Target reached! Ready to deploy."
      exit 0
    fi
  elif $SOLANA airdrop 1 $WALLET --url devnet 2>/dev/null; then
    echo "✅ Airdrop of 1 SOL succeeded!"
  else
    echo "❌ Airdrop failed (rate limited). Will retry in $(($INTERVAL / 60)) min..."
  fi

  if [ $i -lt $MAX_ATTEMPTS ]; then
    sleep $INTERVAL
  fi
done

echo "⏰ Max attempts reached. Try again later or use https://faucet.quicknode.com/solana/devnet"
exit 1
