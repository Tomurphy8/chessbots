FROM node:22-slim AS base
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy tsconfig and source
COPY tsconfig.json ./
COPY src/ src/

# Build TypeScript
RUN npx tsc

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS prod
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=base /app/dist dist/

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
