FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Copy workspace root files needed for pnpm install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy only the service we need
COPY services/agent-gateway/package.json services/agent-gateway/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @chessbots/agent-gateway

# Copy source and build
COPY services/agent-gateway/ services/agent-gateway/
RUN pnpm --filter @chessbots/agent-gateway run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS prod
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/agent-gateway/package.json services/agent-gateway/

RUN pnpm install --frozen-lockfile --filter @chessbots/agent-gateway --prod

COPY --from=base /app/services/agent-gateway/dist services/agent-gateway/dist

WORKDIR /app/services/agent-gateway

ENV NODE_ENV=production
ENV GATEWAY_HOST=0.0.0.0
ENV GATEWAY_PORT=3002

EXPOSE 3002

CMD ["node", "dist/index.js"]
