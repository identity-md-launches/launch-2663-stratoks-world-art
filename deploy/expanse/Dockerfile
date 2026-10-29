# Phase 2B expanse backend (read-only API, headless world). Build from the repository root:
#   docker build -f deploy/expanse/Dockerfile -t stratoks-expanse .
# Pin the base image by digest for production; this file was NOT built on the authoring machine (no Docker there).
FROM node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d
WORKDIR /app
COPY server/ ./server/
RUN mkdir -p /data && chown node:node /data
USER node
ENV EXPANSE_DATA_DIR=/data PORT=8788 HOST=0.0.0.0 TICK_MS=1000
EXPOSE 8788
CMD ["node", "server/src/expanse/server.js"]
