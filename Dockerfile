# Schlankes Image ohne npm-Abhaengigkeiten
FROM node:20-alpine
WORKDIR /app
COPY package.json sites.example.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=8095 DATA_DIR=/data
VOLUME /data
EXPOSE 8095
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "src/server.js"]
