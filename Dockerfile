# 部署方式：本機 docker build + docker push（不用 gcloud builds submit，避免把 .env 上傳）。
FROM node:20

WORKDIR /app

RUN npm install -g pnpm@8.6.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Cloud Run 會帶 PORT（預設 8080），健康檢查用。
EXPOSE 8080

CMD ["pnpm", "start"]
