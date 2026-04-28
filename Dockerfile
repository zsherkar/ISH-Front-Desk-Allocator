FROM node:24-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

ENV BASE_PATH=/
RUN pnpm --filter @workspace/shift-scheduler run build
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
ENV PORT=3000

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["sh", "./scripts/start-production.sh"]
