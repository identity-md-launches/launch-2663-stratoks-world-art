# Build context: repository root.  docker build -f deploy/Dockerfile .
# The pinned node:22.22.1-bookworm-slim OCI index is a multi-arch image (linux/arm64 and linux/amd64). The server has zero npm dependencies.
FROM node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY server/package.json ./package.json
COPY server/src ./src
COPY server/bin ./bin
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "src/main.js"]
