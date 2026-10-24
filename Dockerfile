FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production STORAGE_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
