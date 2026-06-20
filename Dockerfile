FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache sqlite font-dejavu

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY README.md ./
COPY .env.example ./

ENV NODE_ENV=production
ENV DOWNLOADS_DIR=/storage/downloads
ENV SQLITE_DB_PATH=/storage/bot.sqlite
ENV XDG_CACHE_HOME=/tmp/.cache

RUN mkdir -p /storage/downloads /tmp/.cache/fontconfig && \
  chmod -R 1777 /tmp/.cache && \
  chown -R node:node /app /storage

USER node

CMD ["npm", "start"]
