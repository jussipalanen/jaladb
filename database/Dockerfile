# Database tooling: migrations and seed data (database/scripts/cli.ts).
# Build context: the repository root.
#
#   docker compose run --rm migrate            # apply pending migrations
#   docker compose run --rm migrate seed       # load the sample data
FROM node:24-alpine

WORKDIR /app

# Only runtime dependencies (pg). Node 24 runs the TypeScript sources directly
# (type stripping), so no build step or tsx is needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY database/migrations ./database/migrations
COPY database/functions ./database/functions
COPY database/views ./database/views
COPY database/triggers ./database/triggers
COPY database/seeds ./database/seeds
COPY database/scripts ./database/scripts

USER node
ENTRYPOINT ["node", "database/scripts/cli.ts"]
CMD ["migrate"]
