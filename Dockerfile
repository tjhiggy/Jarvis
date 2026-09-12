FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build

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

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime

ARG JARVIS_VERSION=development
ARG JARVIS_COMMIT_SHA=development

ENV NODE_ENV=production
ENV JARVIS_VERSION=${JARVIS_VERSION}
ENV JARVIS_COMMIT_SHA=${JARVIS_COMMIT_SHA}
LABEL org.opencontainers.image.version="${JARVIS_VERSION}"
LABEL org.opencontainers.image.revision="${JARVIS_COMMIT_SHA}"

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
COPY scripts/docker-healthcheck.mjs ./scripts/docker-healthcheck.mjs

USER jarvis:jarvis

STOPSIGNAL SIGTERM
CMD ["node", "dist/src/index.js"]
