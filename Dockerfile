FROM node:22.23.3-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0
EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD node -e "const port = process.env.PORT || '8787'; fetch('http://127.0.0.1:' + port + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
