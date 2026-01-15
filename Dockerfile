FROM node:20-alpine AS builder

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY nodes/ ./nodes/
COPY credentials/ ./credentials/
COPY scripts/ ./scripts/
RUN npm run build

FROM n8nio/n8n:latest

USER root
ARG NODE_PATH=/home/node/.n8n/nodes/node_modules/n8n-nodes-mibo-testing
RUN mkdir -p ${NODE_PATH}
COPY --from=builder /build/dist ${NODE_PATH}/dist
COPY --from=builder /build/package.json ${NODE_PATH}/

WORKDIR ${NODE_PATH}
RUN npm install --omit=dev --ignore-scripts
RUN chown -R node:node /home/node/.n8n

USER node
WORKDIR /home/node

# --- RAILWAY ---
ENV N8N_PORT=${PORT:-5678}
ENV N8N_LISTEN_ADDRESS=0.0.0.0
ENV N8N_PROTOCOL=https

EXPOSE ${N8N_PORT}
