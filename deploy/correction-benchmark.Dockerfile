# Separate, disposable benchmark image. No production volume or network access.
FROM node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d
WORKDIR /bench
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY tests/load/brain-capacity.mjs ./tests/load/brain-capacity.mjs
USER node
ENTRYPOINT ["node", "tests/load/brain-capacity.mjs"]
