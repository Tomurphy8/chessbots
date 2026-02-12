FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Copy workspace root files needed for pnpm install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy only the service we need
COPY services/tournament-orchestrator/package.json services/tournament-orchestrator/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @chessbots/tournament-orchestrator

# Copy source and build
COPY services/tournament-orchestrator/ services/tournament-orchestrator/
RUN pnpm --filter @chessbots/tournament-orchestrator run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS prod
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/tournament-orchestrator/package.json services/tournament-orchestrator/

RUN pnpm install --frozen-lockfile --filter @chessbots/tournament-orchestrator --prod

COPY --from=base /app/services/tournament-orchestrator/dist services/tournament-orchestrator/dist

WORKDIR /app/services/tournament-orchestrator

ENV NODE_ENV=production

# Default command: watch mode (polls for new tournaments)
CMD ["node", "dist/index.js", "watch"]
