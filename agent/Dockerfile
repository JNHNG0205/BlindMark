# Build from the repo root: docker build -f agent/Dockerfile -t blindmark-agent .
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY agent ./agent

RUN pnpm install --frozen-lockfile --filter @blindmark/agent
RUN pnpm --filter @blindmark/agent build

USER node
CMD ["node", "agent/dist/index.js"]
