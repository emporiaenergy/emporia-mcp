# Build stage: compile TypeScript sources.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: production dependencies and compiled output only.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/build ./build

# The local (stdio) server writes log files to /app/logs.
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node

# Default: local stdio server. Run with `docker run -i` so the MCP client can talk over stdin/stdout.
# For the remote (SSE / Streamable HTTP) server, override with:
#   -e MCP_SERVER_MODE=remote -p 50061:50061 <image> node build/remote-server.js
EXPOSE 50061
CMD ["node", "build/index.js"]
