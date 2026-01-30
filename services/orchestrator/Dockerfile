FROM node:22-alpine

WORKDIR /app

# Copy the built service
COPY services/orchestrator/package*.json ./
COPY services/orchestrator/dist ./dist

# Copy shared types
COPY packages/types/dist ./node_modules/@claude-swarm/types/dist
COPY packages/types/package.json ./node_modules/@claude-swarm/types/

# Install production dependencies
RUN npm install --production --ignore-scripts

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]
