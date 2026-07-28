FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY config ./config

RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 10001 jarvis \
  && useradd \
    --uid 10001 \
    --gid jarvis \
    --home-dir /app \
    --no-create-home \
    --shell /usr/sbin/nologin \
    jarvis \
  && mkdir -p /app/data \
  && chown jarvis:jarvis /app/data

COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/config ./config

USER jarvis:jarvis

STOPSIGNAL SIGTERM
CMD ["node", "dist/src/index.js"]
