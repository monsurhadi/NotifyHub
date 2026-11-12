FROM node:22-alpine
WORKDIR /app

# dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY scripts ./scripts

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# API (add EMBEDDED_WORKER=true to also run the worker in this process). The worker service overrides CMD.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
