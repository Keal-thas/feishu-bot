FROM node:22-slim
# opencode 二进制,版本与 SDK 对齐
RUN npm i -g opencode-ai@1.18.32 && npm cache clean --force
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN mkdir -p data workspace && chown -R node:node /app
USER node
ENV DATA_DIR=/app/data
# 启动前先同步下载最新模型目录(见 scripts/warm-catalog.mjs),否则新容器里新上架的模型会 Model not found
COPY scripts ./scripts
CMD ["sh", "-c", "node scripts/warm-catalog.mjs; exec node_modules/.bin/tsx src/index.ts"]
