FROM node:22-alpine

WORKDIR /app

# Install system dependencies (git for worktrees, bash required by Claude Code)
RUN apk add --no-cache git bash

# Install Claude Code CLI globally BEFORE switching to non-root user
RUN npm install -g @anthropic-ai/claude-code@latest

# Copy package files for workspace installation
COPY package*.json ./
COPY packages/types/package*.json ./packages/types/
COPY packages/shared/package*.json ./packages/shared/
COPY services/agent-worker/package*.json ./services/agent-worker/

# Install dependencies
RUN npm ci --workspace=@claude-swarm/agent-worker

# Copy source code
COPY packages/types/ ./packages/types/
COPY packages/shared/ ./packages/shared/
COPY services/agent-worker/ ./services/agent-worker/

# Build TypeScript
RUN npm run build --workspace=@claude-swarm/types && \
    npm run build --workspace=@claude-swarm/shared && \
    npm run build --workspace=@claude-swarm/agent-worker

# Create non-root user WITH home directory (required for Claude config)
RUN adduser -D -h /home/agent agent

# Create workspace directory for git worktrees
RUN mkdir -p /workspace && chown -R agent:agent /workspace

# Create Claude config directory (for session state if needed)
RUN mkdir -p /home/agent/.claude && chown -R agent:agent /home/agent/.claude

# Set environment variables
ENV HOME=/home/agent
ENV WORKSPACE_ROOT=/workspace

# Switch to non-root user
USER agent

CMD ["node", "services/agent-worker/dist/index.js"]
