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
RUN mkdir -p /home/node/.n8n/custom/n8n-nodes-mibo-testing
COPY --from=builder --chown=node:node /build/dist/ /home/node/.n8n/custom/n8n-nodes-mibo-testing/dist/
COPY --from=builder --chown=node:node /build/package.json /home/node/.n8n/custom/n8n-nodes-mibo-testing/
WORKDIR /home/node/.n8n/custom/n8n-nodes-mibo-testing
RUN npm install --omit=dev --ignore-scripts 2>/dev/null || true
USER node
WORKDIR /home/node/.n8n

ENV N8N_CUSTOM_EXTENSIONS="/home/node/.n8n/custom/n8n-nodes-mibo-testing"
ENV N8N_PORT=${PORT:-5678}
ENV N8N_LISTEN_ADDRESS=0.0.0.0

EXPOSE 5678
CMD ["n8n"]
