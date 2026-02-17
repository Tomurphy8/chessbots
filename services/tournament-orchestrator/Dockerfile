FROM node:22-slim AS base
WORKDIR /app

# Copy package files
COPY package.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy tsconfig and source
COPY tsconfig.json ./
COPY src/ src/

# Inline the base tsconfig settings since we don't have the workspace root
RUN node -e " \
  const fs = require('fs'); \
  const config = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')); \
  delete config.extends; \
  config.compilerOptions = { \
    target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', \
    esModuleInterop: true, forceConsistentCasingInFileNames: true, \
    strict: true, skipLibCheck: true, declaration: true, \
    declarationMap: true, sourceMap: true, \
    outDir: 'dist', rootDir: 'src' \
  }; \
  fs.writeFileSync('tsconfig.json', JSON.stringify(config, null, 2)); \
"

# Build TypeScript
RUN npx tsc

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS prod
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=base /app/dist dist/

ENV NODE_ENV=production

# Default command: watch mode (polls for new tournaments)
CMD ["node", "dist/index.js", "watch"]
