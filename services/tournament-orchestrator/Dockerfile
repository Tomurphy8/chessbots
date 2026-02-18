FROM node:22-slim AS base
WORKDIR /app

# Copy only the service's package.json
COPY services/tournament-orchestrator/package.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy tsconfig and source from service directory
COPY services/tournament-orchestrator/tsconfig.json ./
COPY services/tournament-orchestrator/src/ src/

# Build TypeScript
RUN npx tsc

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS prod
WORKDIR /app

COPY services/tournament-orchestrator/package.json ./
RUN npm install --omit=dev

COPY --from=base /app/dist dist/

ENV NODE_ENV=production

# Default command: watch mode (polls for new tournaments)
CMD ["node", "dist/index.js", "watch"]
