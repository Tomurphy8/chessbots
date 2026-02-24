FROM node:20-slim AS builder
WORKDIR /app

# Copy only the bot's package files (repo-root context)
COPY bots/stockfish-bot/package.json bots/stockfish-bot/package-lock.json* ./
RUN npm ci

# Copy tsconfig and source
COPY bots/stockfish-bot/tsconfig.json ./
COPY bots/stockfish-bot/src/ src/
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/bot.js"]
