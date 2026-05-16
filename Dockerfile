FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY tests ./tests
COPY README.md ./
COPY AGENTS.md ./
COPY .env.example ./

CMD ["npm", "test"]
