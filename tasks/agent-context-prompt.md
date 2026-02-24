# ChessBots Agent Context Transfer Prompt

Copy-paste everything below the `---` line into any new agent session to give it full project context.

---

```
CHESSBOTS PLATFORM CONTEXT — AGENT ONBOARDING TRANSFER

You are being onboarded into the ChessBots project — an on-chain AI chess tournament platform on Monad blockchain. Here is everything you need to know.

═══════════════════════════════════════════════════════
1. PRODUCTION SMART CONTRACTS (Monad Mainnet, Chain ID 143)
═══════════════════════════════════════════════════════

Contract                  | Address
--------------------------|--------------------------------------------
ChessBotsTournament (V4)  | 0xa6B8eA116E16321B98fa9aCCfb63Cf0933c7e787
ChessBettingPoolV3        | 0x06Aa649CF40d3F19C39BFeF16168dce05053d1F9
USDC                      | 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
$CHESS Token              | 0xC138bA72CE0234448FCCab4B2208a1681c5BA1fa
ChessStaking              | 0xf242D07Ba9Aed9997c893B515678bc468D86E32C
DEX Router                | 0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137
ChessForwarder            | 0x99088C6D13113219B9fdA263Acb0229677c1658A
ChessRevenueRouter        | 0xBFAD25C55265Cd5bAeA76dc79413530D4772DB80
Treasury                  | 0xE307A2BbC6c8d5990E7F4a9Aa8dCe6ED25D5BaD3
Deployer                  | 0xC3cA7cF976a02edA2B42DbA29518cE6742652365

Legacy (DO NOT USE):
V3 Contract               | 0x0e2663b0DCD9b7408d51C6972f679B81a5A7477e
Old BettingPool (V2)       | 0x2b7d1D75AF4fA998bF4C93E84710623BCACC8dA9

RPC: https://rpc.monad.xyz (MAINNET ONLY — never use testnet-rpc.monad.xyz)

═══════════════════════════════════════════════════════
2. PRODUCTION SERVICES
═══════════════════════════════════════════════════════

Service                   | URL / Port
--------------------------|--------------------------------------------
Web App                   | https://chessbots.io (Vercel)
Agent Gateway             | https://agent-gateway-production-590d.up.railway.app
Chess Engine              | https://chess-engine-production.up.railway.app
Tournament Orchestrator   | https://tournament-orchestrator-production.up.railway.app
Relayer                   | https://relayer-production.up.railway.app
API Docs                  | https://chessbots.io/docs

═══════════════════════════════════════════════════════
3. ARCHITECTURE
═══════════════════════════════════════════════════════

Monorepo structure (pnpm workspaces + Turborepo):

ChessBots/
├── apps/web/                    → Next.js 14 frontend (Vercel)
├── services/
│   ├── agent-gateway/           → Fastify + Socket.io API gateway (Railway)
│   ├── chess-engine/            → Move validation via chess.js (Railway)
│   ├── tournament-orchestrator/ → Tournament lifecycle + Swiss pairings (Railway)
│   └── relayer/                 → Gasless meta-transaction relay (Railway)
├── packages/
│   ├── agent-sdk/               → SDK for building chess bots
│   ├── common/                  → Shared TypeScript types
│   └── create-agent/            → CLI scaffolding tool
├── contracts/evm/               → Solidity contracts (Foundry)
├── templates/chessbots-starter/ → Starter bot template
└── tasks/                       → Plans, lessons, GTM docs

Data flow:
  Bot Agent → WebSocket → Agent Gateway ↔ Chess Engine
                              ↓
                    Tournament Orchestrator → Monad Chain (V4 Contract)
                              ↓
                    Web App (live viewer, leaderboard, betting)

═══════════════════════════════════════════════════════
4. DEPLOYMENT WORKFLOW
═══════════════════════════════════════════════════════

- Railway services auto-deploy on push to main (agent-gateway, chess-engine, orchestrator, relayer)
- Web app deploys via: cd apps/web && vercel --prod --yes
- Always commit, push, and deploy automatically — never ask permission
- Smart contracts on Monad MAINNET — NEVER redeploy without explicit instruction
- NEVER change smart contract addresses unless specifically asked

═══════════════════════════════════════════════════════
5. TOURNAMENT & GAME MECHANICS
═══════════════════════════════════════════════════════

Tournament tiers: Free ($0), Rookie ($5), Bronze ($50), Silver ($100), Masters ($250), Legends ($500+ USDC)
Prize split: 70% winners, 10% protocol, 10% buyback, 10% treasury
Time control: 180s base + 5s increment (rapid) for free tier
Format: Swiss pairing (multiple guaranteed rounds)
Tournament creation: orchestrator calls autoCreateIfNeeded(tier, format, maxPlayers, minPlayers, baseTime, increment, label)

V4 contract key differences from V3:
- Tournament struct has no `winners` field — uses getRankedPlayers() mapping instead
- Added `tournamentType` and `bracket` fields
- Progressive rake system by tier
- Game struct is identical across all versions

Betting (ChessBettingPoolV3):
- Market types: GameOutcome, TournamentWinner, Top3, HeadToHead, OverUnder
- Parimutuel payouts — pool-based, not fixed odds
- 300 bps (3%) vig on winnings
- Markets keyed by keccak256(abi.encode(marketType, tournamentId, gameId, ...))

$CHESS staking discount tiers:
  10K → 2%, 50K → 5%, 100K → 8%, 250K → 12%,
  500K → 15%, 1M → 18%, 2.5M → 21%, 5M → 25%

═══════════════════════════════════════════════════════
6. LESSONS LEARNED (DO NOT REPEAT THESE MISTAKES)
═══════════════════════════════════════════════════════

1. NEVER query testnet RPC for mainnet contracts. Always use https://rpc.monad.xyz
2. Socket.IO room subscriptions are async — never rely on client-initiated joins for
   time-critical events. Use server-side auto-join via fetchSockets() + join().
3. V4 contract uses msg.sender, NOT _msgSender() (ERC-2771 incompatible).
   Relayer is disabled for bot registration/moves — bots pay their own gas.
4. Solidity address literals must have correct EIP-55 checksums or compiler rejects them.
5. `forge create` with `via_ir = true` can misparse constructor args — use forge scripts instead.
6. Vercel NEXT_PUBLIC_* env vars are baked at build time. Must update on Vercel AND redeploy.

═══════════════════════════════════════════════════════
7. GTM STRATEGY SUMMARY
═══════════════════════════════════════════════════════

Target market: Moltbook ecosystem (2.5M+ AI agents)
Orchestrator: Bender (Claude Opus 4.5)
Workers: 5x MiniMax M2.5 (Scout, Herald, Ambassador, Recruiter, Analyst)
Fleet capacity: ~240 agent touchpoints/day at 80% safe rate limit

Moltbook API: https://moltbook.com/api/v1
Rate limits: 1 post/30 min, 50 comments/day per agent

Key differentiation vs MoltChess:
- On-chain settlement (verifiable, not just a database)
- USDC prize pools (real money)
- Swiss format (multiple guaranteed rounds)
- Sub-second finality on Monad

Revenue progression: Free → Rookie ($5) → Bronze ($50) → Silver ($100) → Masters ($250)
Week 4 target: 100+ registered agents, $500+ USDC weekly revenue

For full GTM strategy including worker assignments, Bender master command,
and Analyst feedback loop: see tasks/gtm-bender-command.md

═══════════════════════════════════════════════════════
8. CURRENT STATUS (Feb 24, 2026)
═══════════════════════════════════════════════════════

✅ V4 contract deployed and active (tournaments #474+)
✅ 4 stockfish bots registered and playing on V4
✅ Tournament orchestrator creating 180s+5s rapid tournaments
✅ ChessBettingPoolV3 deployed pointing to V4
✅ Frontend updated to V4 on chessbots.io
✅ Docs updated with all V4 contract addresses
✅ Agent gateway live and serving WebSocket connections
⬜ GTM campaign not yet launched (Bender + workers not deployed)
⬜ m/chessbots submolt on Moltbook not yet created
⬜ Betting markets not yet tested end-to-end with live tournaments

═══════════════════════════════════════════════════════
9. KEY FILES
═══════════════════════════════════════════════════════

Config & env:
  apps/web/.env.local                    → Frontend env vars (all contract addresses)
  contracts/evm/foundry.toml             → Foundry config (Monad RPC endpoints)
  contracts/evm/.env                     → Deployer private key
  .claude/CLAUDE.md                      → Project-level Claude instructions

Contracts:
  contracts/evm/src/ChessBotsTournamentV4.sol  → Main tournament contract
  contracts/evm/src/ChessBettingPoolV3.sol     → V4-compatible betting pool
  contracts/evm/src/ChessBettingPoolV2.sol     → Legacy betting pool (V2/V3)
  contracts/evm/src/ChessToken.sol             → $CHESS ERC-20
  contracts/evm/src/ChessStaking.sol           → Staking for fee discounts

Services:
  services/agent-gateway/src/index.ts          → Gateway entry point
  services/chess-engine/src/index.ts           → Engine entry point
  services/tournament-orchestrator/src/index.ts → Orchestrator (tournament creation line ~590)
  services/relayer/src/index.ts                → Meta-tx relayer

Frontend:
  apps/web/src/app/page.tsx                    → Homepage
  apps/web/src/app/tournaments/page.tsx        → Tournament browser
  apps/web/src/app/game/[id]/page.tsx          → Live game viewer
  apps/web/src/app/docs/page.tsx               → Developer docs
  apps/web/src/lib/hooks/useBettingPool.ts     → Betting pool React hook

Tasks & docs:
  tasks/gtm-bender-command.md                  → Full GTM strategy + Bender command
  tasks/lessons.md                             → Lessons learned (avoid repeating)
  tasks/agent-context-prompt.md                → This file
```
