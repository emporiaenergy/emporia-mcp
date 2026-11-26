# Docker Hardened Images (https://dhi.io) - requires `docker login dhi.io` with a Docker Hub account.
# The -dev variant has a shell and npm for building; the runtime variant has neither and runs as non-root.

# Build stage: compile TypeScript sources.
FROM dhi.io/node:22-alpine3.22-dev AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production dependencies stage: install runtime deps only, and prepare the log directory.
FROM dhi.io/node:22-alpine3.22-dev AS deps
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
RUN mkdir -p /app/logs

# Runtime stage: no shell or package manager, non-root user (uid 1000).
FROM dhi.io/node:22-alpine3.22
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# The local (stdio) server writes log files to /app/logs.
COPY --from=deps --chown=1000:1000 /app/logs ./logs

# Default: local stdio server. Run with `docker run -i` so the MCP client can talk over stdin/stdout.
# For the remote (SSE / Streamable HTTP) server, override with:
#   -e MCP_SERVER_MODE=remote -p 50061:50061 <image> node build/remote-server.js
EXPOSE 50061
CMD ["node", "build/index.js"]
