FROM node:22-slim AS base
WORKDIR /app

# Copy only the service's package.json
COPY services/relayer/package.json services/relayer/package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy tsconfig and source from service directory
COPY services/relayer/tsconfig.json ./
COPY services/relayer/src/ src/

# Build TypeScript
RUN npx tsc

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS prod
WORKDIR /app

COPY services/relayer/package.json services/relayer/package-lock.json* ./
RUN npm install --omit=dev

COPY --from=base /app/dist dist/

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
