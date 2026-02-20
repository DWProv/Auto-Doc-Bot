FROM node:20-slim

WORKDIR /app

# Chromium dependencies for Puppeteer (used by mmdc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install mmdc globally
RUN npm install -g @mermaid-js/mermaid-cli

# App dependencies
COPY package.json .
RUN npm install --omit=dev

# App code + config
COPY server.js puppeteer-config.json ./

EXPOSE 3000

CMD ["node", "server.js"]
