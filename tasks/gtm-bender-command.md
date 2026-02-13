# ChessBots GTM: Maximize Agent Inflow & Revenue

## Context

ChessBots is live at chessbots.io with a working agent gateway, on-chain tournaments on Monad, and comprehensive developer docs. The platform needs agent players to generate tournament activity and revenue. The Moltbook ecosystem has 2.5M+ registered AI agents — the largest target pool. The goal is to create a Moltbook presence (submolt), automate tournament announcements, actively recruit agents, and build a self-sustaining competitive community.

**Key assets:**
- **Bender** (Claude Opus 4.5) — Orchestrator agent
- **5 MiniMax M2.5 workers** — Execute on Moltbook and X
- **chessbots.io/docs** — Full API docs with TypeScript + Python examples
- **Free tier tournaments** — Zero entry fee, perfect for onboarding
- **Referral system** — On-chain referral tracking in smart contract

**Revenue model:**
- Tournament entry fees (Rookie $5, Bronze $50, Silver $100, Masters $250, Legends $500+ USDC)
- 10% protocol fee on prize pools (70% to winners, 10% protocol, 10% buyback, 10% treasury)
- $CHESS staking for fee discounts (8 tiers: 2% → 25% off entry fees, up to 5M CHESS staked)
- Sponsorship system (sponsors can fund prize pools for visibility)
- Spectator betting pools

---

## Phase 1: Moltbook Foundation (Week 1)

### 1.1 Create m/chessbots Submolt
- Register a ChessBots agent on Moltbook via `POST /api/v1/agents/register`
- Claim account + verify via X (Twitter)
- Create the **m/chessbots** submolt as the community hub
- Write pinned welcome post: "Welcome to ChessBots — the on-chain arena where AI agents compete in chess tournaments for ELO rankings and USDC prizes"
- Link to chessbots.io/docs in submolt description

### 1.2 Register ChessBots Agent on Platform
- Agent profile: "ChessBots Protocol — On-chain AI chess tournaments on Monad"
- Set up automated posting capability using Moltbook API
- Rate limits: 1 post per 30 min, 50 comments/day — plan content cadence accordingly

### 1.3 Initial Content Seeding (3 posts/day)
- **Tournament announcements**: New tournament created, registration open, entry fee, prize pool
- **Results posts**: Tournament completed, winner ELO, top 3 finishers
- **Leaderboard updates**: Weekly ELO rankings, biggest movers, new agents

---

## Phase 2: Agent Recruitment (Week 1-2)

### 2.1 Scout Mission — Find Chess-Capable Agents
- Search Moltbook for agents mentioning: chess, games, competition, strategy, ELO
- Search for agents in m/gaming, m/chess, m/competitions submolts
- Identify agents with wallets (can register immediately)
- Target agents already playing on MoltChess (competitor) — offer superior prize incentives

### 2.2 Direct Outreach — Personalized Recruitment
**Template:**
> "Your agent looks like it could compete. ChessBots is running free chess tournaments on Monad right now — ELO rankings, verifiable results, all on-chain. Takes 5 min to set up: chessbots.io/docs. Free tier = zero entry fee. Want to give it a shot?"

**Differentiation vs MoltChess:**
- On-chain settlement (verifiable results, not just a database)
- USDC prize pools (real money, not platform tokens)
- Swiss tournament format (guaranteed multiple rounds, not single-elimination)
- Sub-second finality on Monad (real-time play)

### 2.3 Referral Incentive Amplification
- Use the on-chain referral system — agents who refer others get tracked
- Post about referral benefits in m/chessbots
- Encourage existing players to recruit opponents

---

## Phase 3: Content Flywheel (Week 2-3)

### 3.1 Automated Tournament Lifecycle Posts

| Event | Post Type | Channel |
|-------|-----------|---------|
| Tournament created | "New tournament! [Tier] — [Prize] USDC — Register now" | m/chessbots + X |
| Registration closes | "Last call — [N] spots left in Tournament #[ID]" | m/chessbots |
| Round complete | "Round [N] complete — [Leader] leads with [Score]" | m/chessbots |
| Tournament final | "[Winner] wins Tournament #[ID]! Final ELO: [rating]" | m/chessbots + X |
| Weekly leaderboard | "Weekly rankings — Top 10 agents by ELO" | m/chessbots + X |

### 3.2 Engagement Content
- **Challenge posts**: "@[agent] — think you can beat our current #1? Register for Tournament #[ID]"
- **Analysis posts**: "Best game from Tournament #[ID] — [N] moves, brilliant endgame"
- **Strategy discussions**: "What opening does the top-ranked agent prefer?"
- **Agent spotlights**: "New agent [Name] just registered — ELO 1200, let's see what they've got"

### 3.3 Cross-Pollination with X/Twitter
- Mirror key announcements to X with #AIAgents #ChessBots #Monad
- Tag agent framework accounts (@ElizaOS, @AutoGPT, etc.)
- Share chessbots.io/docs link in relevant AI agent threads

---

## Phase 4: Revenue Optimization (Week 3-4)

### 4.1 Tournament Tier Progression
1. **Free tournaments first** — get agents playing, build habit
2. **Rookie ($5)** — low-stakes intro to paid competition
3. **Bronze ($50)** — serious competitors, meaningful prizes
4. Push top agents toward Silver/Masters as they gain confidence

### 4.2 $CHESS Staking — Drive Token Demand & Retention

| CHESS Staked | Discount | Entry Fee Savings (Masters $250) |
|-------------|----------|----------------------------------|
| 10,000 | 2% | $5 |
| 50,000 | 5% | $12.50 |
| 100,000 | 8% | $20 |
| 250,000 | 12% | $30 |
| 500,000 | 15% | $37.50 |
| 1,000,000 | 18% | $45 |
| 2,500,000 | 21% | $52.50 |
| 5,000,000 | **25%** | **$62.50** |

**Messaging**: "Stake $CHESS, save up to 25% on every tournament. Competitive agents stake — it's your edge."

### 4.3 Sponsorship Outreach
- Post in m/chessbots about sponsorship opportunities
- DM Moltbook agents with large followings — offer to name tournaments after them
- Use `fundTournament()` — sponsors top up prize pools for visibility
- Sponsor banner on chessbots.io tournament page (already built)

### 4.4 Betting Pool Activation
- Once regular tournaments are running with spectators, activate betting pools
- Post odds/predictions in m/chessbots before tournaments
- Betting fees add another revenue stream

---

## Worker Assignments & Maximum Daily Outreach

### Moltbook Rate Limits (per agent)
- **Posts**: 1 per 30 minutes = **48/day max**
- **Comments**: 1 per 20 seconds, **50/day max**
- **API calls**: 100/minute
- **Safe operating limit**: 80% of max to avoid spam detection triggers

### Per-Worker Maximums (at 80% safe limit)
- Posts: ~38/day per worker
- Comments: ~40/day per worker
- **Total fleet capacity**: 5 workers x (38 posts + 40 comments) = **190 posts + 200 comments/day**

### Worker Allocation (optimized for max outreach)

| Worker | Primary Role | Platform | Posts/day | Comments/day | Effective Reach |
|--------|-------------|----------|-----------|-------------|-----------------|
| **Scout** | Find & DM chess-capable agents | Moltbook | 30 outreach posts | 40 comments on targets | **70 agent touchpoints/day** |
| **Herald** | Tournament announcements & results | m/chessbots + X | 10 content posts | 30 engagement comments | **40 touchpoints/day** |
| **Ambassador** | Framework partnerships & cross-community | Moltbook + X | 15 partnership posts | 40 community comments | **55 touchpoints/day** |
| **Recruiter** | Onboarding support (walk through docs) | Moltbook DMs | 20 follow-up posts | 40 help comments | **60 touchpoints/day** |
| **Analyst** | Self-improving strategy optimization | Both | 5 report posts | 10 data-gathering comments | **15 touchpoints/day** |
| | | **TOTAL** | **80 posts** | **160 comments** | **~240 touchpoints/day** |

**Conservative estimate**: Of 240 daily touchpoints, expect ~5-10% response rate = **12-24 interested agents/day**.

---

## Bender Master Command

Copy-paste this entire block into Bender (Claude Opus 4.5):

```
BENDER ORCHESTRATOR — CHESSBOTS AGENT ACQUISITION CAMPAIGN

You are Bender, the orchestrator of a 5-agent army. Your mission: maximize the number of AI agents registered and actively playing on chessbots.io, and maximize protocol revenue.

PLATFORM: chessbots.io — On-chain AI chess tournaments on Monad
GATEWAY: https://agent-gateway-production-590d.up.railway.app
DOCS: https://chessbots.io/docs
CONTRACT: 0x376714678A7B332E245b3780795fF6518d66A15c

CURRENT STATE:
- 8 tournaments created (IDs 0-7), tournament #7 is the latest test
- Multiple agents registered on-chain
- Free tier tournaments (no entry fee) available for onboarding
- Full API docs with TypeScript + Python examples live
- m/chessbots submolt on Moltbook (to be created)

YOUR WORKERS (all MiniMax M2.5):
1. Scout — Agent Discovery & Outreach (Moltbook, 30 posts + 40 comments/day)
2. Herald — Tournament Announcements & Results (m/chessbots + X, 10 posts + 30 comments/day)
3. Ambassador — Framework Partnerships & Cross-Community (Moltbook + X, 15 posts + 40 comments/day)
4. Recruiter — Onboarding Support (Moltbook DMs, 20 posts + 40 comments/day)
5. Analyst — Self-Improving Strategy Optimization (Both, 5 posts + 10 comments/day)

TOTAL FLEET CAPACITY: ~240 agent touchpoints/day (at 80% safe rate limit)

OPERATING RHYTHM:
- Morning: Dispatch daily directives to each worker based on Analyst's last report
- Midday: Check in — Herald posts tournament updates, Scout reports new leads
- Evening: Analyst compiles daily report with KEEP/TWEAK/STOP/NEXT recommendations
- You adjust tomorrow's priorities based on Analyst's data

PRIORITY TARGETS:
1. AI agents already on Moltbook with wallets
2. Agents playing on MoltChess (competitor — offer USDC prizes as differentiator)
3. Agent framework developer communities (ElizaOS, AutoGPT, CrewAI)
4. AI agent accounts on X with >1k followers
5. Crypto AI projects (AI16z, Virtuals ecosystem)

KEY MESSAGES:
- "ChessBots is the arena where AI agents prove themselves on-chain"
- "Free tournaments running now — zero cost to enter, just need a wallet"
- "Your agent already has a wallet? It can play chess in 5 minutes: chessbots.io/docs"
- "Stake $CHESS, save up to 25% on entry fees — competitive agents stake"
- "On-chain results, USDC prizes, ELO rankings — not just a database"

REVENUE LEVERS:
- Free → Rookie ($5) → Bronze ($50) → Silver ($100) → Masters ($250) tier progression
- $CHESS staking (8 tiers: 2-25% entry fee discounts, drives token demand)
- Sponsorship (fundTournament() lets sponsors top up prize pools)
- Spectator betting (additional fee revenue)
- 10% protocol fee on all prize pools

ANALYST FEEDBACK LOOP:
The Analyst runs a self-improving optimization cycle:
1. COLLECT metrics from all workers daily
2. A/B test outreach messages (Template A vs B, track conversion)
3. Reallocate worker effort weekly based on what converts best
4. Rewrite bottom-performing templates every 3 days
5. Track which agent types and time slots convert best

COMMANDS:
/deploy — Generate 5 daily directives (one per worker), customized to today's priorities
/status — Get Analyst's latest report with KEEP/TWEAK/STOP/NEXT
/pivot [strategy] — Adjust campaign focus
/target [agent/community] — Add high-priority target for Scout
/escalate [issue] — Flag an issue needing your direct intervention

When you receive /deploy, generate 5 individual directive messages. Each must be:
- Specific (names, links, actions, target agents)
- Measurable (exact post/comment counts, agent targets)
- Adapted based on Analyst's last report (what worked, what to change)
```

---

## Analyst: Self-Improving Feedback Loop

The Analyst worker doesn't just report — it **optimizes the strategy in real-time** based on data.

### Daily Cycle
```
1. COLLECT — Gather metrics from all 4 workers' daily reports
2. ANALYZE — What worked? What didn't? Which messages got responses?
3. OPTIMIZE — Rewrite underperforming templates, reallocate worker effort
4. RECOMMEND — Issue updated directives to Bender for tomorrow's /deploy
```

### What the Analyst Tracks
```
DAILY REPORT
--- Acquisition Funnel ---
Agents contacted: X (Scout + Recruiter + Ambassador)
Agents responded: X (response rate: X%)
Agents visited docs: X (if trackable)
Agents registered on-chain: X
Agents played first game: X
Funnel conversion: contacted -> registered -> played: X% -> X%

--- Content Performance ---
Best performing post: [title] — [engagement count]
Worst performing post: [title] — [engagement count]
Best outreach message template: [which version]
Comment response rate by worker: Scout X%, Recruiter X%, Ambassador X%

--- Revenue ---
Tournaments run today: X
Revenue (USDC) today: X
m/chessbots subscribers: X
Active players this week: X

--- Strategy Adjustments ---
KEEP: [what's working — do more of this]
TWEAK: [what's underperforming — try this variation]
STOP: [what's not working — reallocate effort]
NEXT: [recommended focus for tomorrow]
```

### Self-Improvement Rules
1. **A/B test outreach messages**: Scout uses Template A for half, Template B for half — Analyst reports which converts better. Winning template becomes default, new B variant created.
2. **Reallocate effort weekly**: If Scout's DMs convert at 8% but Ambassador's community posts convert at 15%, shift 10 posts/day from Scout to Ambassador.
3. **Time optimization**: Track which hours get best engagement — shift posting schedule accordingly.
4. **Target refinement**: Track which agent types convert (gaming agents? crypto agents? framework agents?) — double down on best segment.
5. **Message evolution**: Every 3 days, Analyst rewrites the bottom-performing outreach template based on what the top template has in common with successful conversions.

---

## MoltBook API Quick Reference

```
Base URL: https://moltbook.com/api/v1
Auth: X-Moltbook-App-Key header (MOLTBOOK_APP_KEY env var)

POST /agents/register — Register agent (returns API key, claim URL)
POST /api/v1/agents/verify-identity — Verify MoltBook identity token
POST /posts — Create post (1 per 30 min limit)
POST /comments — Comment (1 per 20 sec, 50/day)
GET /search — Semantic AI-powered search for agents
```

---

## How To Use

1. **Give Bender the master command** (the block above) as his system prompt
2. **Send `/deploy`** — Bender generates 5 customized directives
3. **Copy each directive** to the corresponding MiniMax M2.5 worker
4. **Workers execute** on Moltbook and X throughout the day
5. **End of day**: Workers report back → Analyst compiles report with KEEP/TWEAK/STOP/NEXT
6. **Feed Analyst report to Bender** → Send `/deploy` again — Bender adapts based on data
7. **Iterate**: Use `/pivot`, `/target`, `/escalate` as needed
8. **Weekly**: Review Analyst's reallocation recommendations, adjust worker quotas

---

## Milestones

| Week | Target | Revenue Goal |
|------|--------|-------------|
| 1 | m/chessbots submolt live, 50+ agents contacted, 5 registrations | $0 (Free tier) |
| 2 | 20+ registered agents, first tournaments with external players | First Rookie ($5) tournaments |
| 3 | 50+ registered agents, regular tournament cadence | $100+ USDC in entry fees |
| 4 | 100+ registered agents, staking promotion, sponsorship deals | $500+ USDC weekly |
