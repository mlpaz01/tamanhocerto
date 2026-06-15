# ---- Build ----
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- Runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg (extrair/normalizar áudio) + yt-dlp (baixar áudio do YouTube)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --prod --frozen-lockfile

# Artefatos de build + migrações
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./

# Disco persistente (Fly volume) para uploads e documentos
ENV STORAGE_DIR=/data/storage
RUN mkdir -p /data/storage

EXPOSE 3000
CMD ["node", "dist/index.js"]
