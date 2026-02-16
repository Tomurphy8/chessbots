#!/bin/bash
set -euo pipefail

# ChessBots Backend - Railway Deployment Script
# ═══════════════════════════════════════════════
#
# Prerequisites:
#   1. Railway CLI installed: brew install railway
#   2. Logged in: railway login
#   3. Generate secrets: openssl rand -hex 32 (for JWT_SECRET)
#                        openssl rand -hex 16 (for SERVICE_API_KEY)
#
# Usage:
#   ./scripts/deploy-railway.sh

echo "═══════════════════════════════════════════════"
echo "  ChessBots Backend - Railway Deployment"
echo "═══════════════════════════════════════════════"
echo ""

# Check Railway CLI
if ! command -v railway &> /dev/null; then
  echo "❌ Railway CLI not found. Install with: brew install railway"
  exit 1
fi

# Check login
if ! railway whoami &> /dev/null 2>&1; then
  echo "❌ Not logged in to Railway. Run: railway login"
  exit 1
fi

echo "✅ Logged in as: $(railway whoami)"
echo ""

# ── Step 1: Create project ────────────────────────────────────────────────────
echo "📦 Creating Railway project: chessbots-backend..."
railway init --name chessbots-backend 2>/dev/null || echo "   (project may already exist)"
echo ""

# ── Step 2: Generate secrets if not set ──────────────────────────────────────
SERVICE_API_KEY=${SERVICE_API_KEY:-$(openssl rand -hex 16)}
JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
PRIVATE_KEY=${PRIVATE_KEY:-""}

if [ -z "$PRIVATE_KEY" ]; then
  echo "⚠️  PRIVATE_KEY not set. The tournament orchestrator won't work without it."
  echo "   Set it with: export PRIVATE_KEY=0x..."
  echo ""
fi

# Contract addresses (Monad Mainnet)
MONAD_CONTRACT="0xCB030eE8Ee385f91F4372585Fe1fa3147FA192B8"
MONAD_USDC="0x754704Bc059F8C67012fEd69BC8A327a5aafb603"
CHESS_TOKEN="0xC138bA72CE0234448FCCab4B2208a1681c5BA1fa"
CHESS_STAKING="0xf242D07Ba9Aed9997c893B515678bc468D86E32C"
MONAD_RPC="https://rpc.monad.xyz/"

echo "🔑 Secrets configured"
echo "   SERVICE_API_KEY: ${SERVICE_API_KEY:0:8}..."
echo "   JWT_SECRET:      ${JWT_SECRET:0:8}..."
echo ""

# ── Step 3: Deploy Chess Engine ──────────────────────────────────────────────
echo "♟️  Creating chess-engine service..."
railway service create chess-engine 2>/dev/null || echo "   (service may already exist)"
railway link --service chess-engine

# Set env vars
railway vars set \
  PORT=3001 \
  HOST=0.0.0.0 \
  SERVICE_API_KEY="$SERVICE_API_KEY" \
  ALLOWED_ORIGINS="https://chessbots.io,https://www.chessbots.io" \
  NODE_ENV=production

# Deploy
railway up --service chess-engine --dockerfile services/chess-engine/Dockerfile

# Generate domain
CHESS_ENGINE_URL=$(railway domain --service chess-engine 2>/dev/null || echo "")
echo "   Chess Engine URL: $CHESS_ENGINE_URL"
echo ""

# ── Step 4: Deploy Agent Gateway ─────────────────────────────────────────────
echo "🌐 Creating agent-gateway service..."
railway service create agent-gateway 2>/dev/null || echo "   (service may already exist)"
railway link --service agent-gateway

# Set env vars (CHESS_ENGINE_URL will use Railway's internal networking)
railway vars set \
  GATEWAY_PORT=3002 \
  GATEWAY_HOST=0.0.0.0 \
  SERVICE_API_KEY="$SERVICE_API_KEY" \
  JWT_SECRET="$JWT_SECRET" \
  CHESS_ENGINE_URL="http://chess-engine.railway.internal:3001" \
  ALLOWED_ORIGINS="https://chessbots.io,https://www.chessbots.io" \
  MONAD_RPC="$MONAD_RPC" \
  MONAD_CONTRACT="$MONAD_CONTRACT" \
  NODE_ENV=production

# Deploy
railway up --service agent-gateway --dockerfile services/agent-gateway/Dockerfile

# Generate public domain for the gateway
GATEWAY_URL=$(railway domain --service agent-gateway 2>/dev/null || echo "")
echo "   Gateway URL: $GATEWAY_URL"
echo ""

# ── Step 5: Deploy Tournament Orchestrator ───────────────────────────────────
echo "🏆 Creating tournament-orchestrator service..."
railway service create tournament-orchestrator 2>/dev/null || echo "   (service may already exist)"
railway link --service tournament-orchestrator

railway vars set \
  CHESS_ENGINE_URL="http://chess-engine.railway.internal:3001" \
  SERVICE_API_KEY="$SERVICE_API_KEY" \
  MONAD_RPC="$MONAD_RPC" \
  MONAD_CONTRACT="$MONAD_CONTRACT" \
  MONAD_USDC="$MONAD_USDC" \
  CHESS_TOKEN="$CHESS_TOKEN" \
  CHESS_STAKING="$CHESS_STAKING" \
  PRIVATE_KEY="$PRIVATE_KEY" \
  POLL_INTERVAL_MS=10000 \
  NODE_ENV=production

# Deploy
railway up --service tournament-orchestrator --dockerfile services/tournament-orchestrator/Dockerfile

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ Deployment Complete!"
echo "═══════════════════════════════════════════════"
echo ""
echo "Services:"
echo "  ♟️  Chess Engine:     internal (chess-engine.railway.internal:3001)"
echo "  🌐 Agent Gateway:    $GATEWAY_URL"
echo "  🏆 Orchestrator:     running in watch mode"
echo ""
echo "Next steps:"
echo "  1. Set NEXT_PUBLIC_GATEWAY_URL=$GATEWAY_URL in Vercel env vars"
echo "  2. Redeploy frontend on Vercel"
echo "  3. Test: curl https://$GATEWAY_URL/api/health"
echo ""
