FROM node:22-alpine

WORKDIR /app

# Install git and Claude Code CLI
RUN apk add --no-cache git bash curl && \
    npm install -g @anthropic-ai/claude-code

# Copy the built service
COPY services/agent-worker/package*.json ./
COPY services/agent-worker/dist ./dist

# Copy shared types
COPY packages/types/dist ./node_modules/@claude-swarm/types/dist
COPY packages/types/package.json ./node_modules/@claude-swarm/types/

# Install production dependencies
RUN npm install --production --ignore-scripts

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

CMD ["node", "dist/index.js"]
