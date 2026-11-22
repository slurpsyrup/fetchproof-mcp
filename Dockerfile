# stdio MCP server image for directory builds (Glama, Smithery).
# Starts without secrets so initialize and tools/list work for introspection.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin.js ./
COPY src ./src
COPY openapi ./openapi
COPY README.md LICENSE smithery.yaml ./
USER node
CMD ["node", "bin.js"]
