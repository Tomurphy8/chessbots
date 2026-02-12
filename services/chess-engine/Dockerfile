FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Copy workspace root files needed for pnpm install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy only the service we need
COPY services/chess-engine/package.json services/chess-engine/

# Install dependencies (production only, no devDeps)
RUN pnpm install --frozen-lockfile --filter @chessbots/chess-engine

# Copy source and build
COPY services/chess-engine/ services/chess-engine/
RUN pnpm --filter @chessbots/chess-engine run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS prod
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/chess-engine/package.json services/chess-engine/

RUN pnpm install --frozen-lockfile --filter @chessbots/chess-engine --prod

COPY --from=base /app/services/chess-engine/dist services/chess-engine/dist

WORKDIR /app/services/chess-engine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
