# Claude Swarm Orchestrator
# Long-running service for task queue management and agent coordination

FROM node:22-alpine AS base

# Create non-root user
RUN addgroup -g 1001 orchestrator && \
    adduser -u 1001 -G orchestrator -s /bin/sh -D orchestrator

# ============================================================================
# Dependencies Stage
# ============================================================================
FROM base AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ============================================================================
# Build Stage
# ============================================================================
FROM base AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ============================================================================
# Production Stage
# ============================================================================
FROM base AS runner

WORKDIR /app

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Switch to non-root user
USER orchestrator

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
