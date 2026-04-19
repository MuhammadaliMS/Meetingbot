FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ffmpeg \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY test ./test
COPY docs ./docs
COPY README.md ./
COPY .env.example ./

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
