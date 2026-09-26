# JalaDB API. Build context: backend/.
FROM node:26-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Node 24 runs the TypeScript sources directly (type stripping).
COPY src ./src

# Listen on all interfaces inside the container; Compose publishes the port
# on 127.0.0.1 only.
ENV API_HOST=0.0.0.0 \
    API_PORT=3000
EXPOSE 3000

USER node
CMD ["node", "src/server.ts"]
