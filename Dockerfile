FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache sqlite
RUN npm ci

COPY src ./src
COPY tests ./tests
COPY README.md ./
COPY AGENTS.md ./
COPY .env.example ./

CMD ["npm", "test"]
