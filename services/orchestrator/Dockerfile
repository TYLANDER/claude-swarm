FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
COPY packages/types/package*.json ./packages/types/
COPY packages/shared/package*.json ./packages/shared/
COPY services/orchestrator/package*.json ./services/orchestrator/

RUN npm ci --workspace=@claude-swarm/orchestrator

COPY packages/types/ ./packages/types/
COPY packages/shared/ ./packages/shared/
COPY services/orchestrator/ ./services/orchestrator/

RUN npm run build --workspace=@claude-swarm/types && npm run build --workspace=@claude-swarm/shared && npm run build --workspace=@claude-swarm/orchestrator

EXPOSE 3000

RUN adduser -D orchestrator
USER orchestrator

CMD ["node", "services/orchestrator/dist/local.js"]
