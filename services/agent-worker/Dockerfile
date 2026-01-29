# Claude Agent Worker
# Runs Claude Agent SDK in an isolated container environment

FROM node:22-alpine AS base

# Install git and other dependencies
RUN apk add --no-cache git openssh-client

# Create non-root user
RUN addgroup -g 1001 agent && \
    adduser -u 1001 -G agent -s /bin/sh -D agent

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# ============================================================================
# Dependencies Stage
# ============================================================================
FROM base AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
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

# Create workspace directory
RUN mkdir -p /workspace && chown -R agent:agent /workspace

# Git configuration
RUN mkdir -p /home/agent/.ssh && \
    ssh-keyscan github.com >> /home/agent/.ssh/known_hosts && \
    chown -R agent:agent /home/agent/.ssh

# Switch to non-root user
USER agent

# Set working directory for agent operations
WORKDIR /workspace

ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

ENTRYPOINT ["node", "/app/dist/index.js"]
