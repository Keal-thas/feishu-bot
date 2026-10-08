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
CMD ["npx", "tsx", "src/index.ts"]
