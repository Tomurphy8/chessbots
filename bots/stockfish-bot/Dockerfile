FROM node:20-slim AS builder
WORKDIR /app

# Copy only the bot's package.json (repo-root context, no lockfile)
COPY bots/stockfish-bot/package.json ./
RUN npm install

# Copy tsconfig and source
COPY bots/stockfish-bot/tsconfig.json ./
COPY bots/stockfish-bot/src/ src/
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/bot.js"]
