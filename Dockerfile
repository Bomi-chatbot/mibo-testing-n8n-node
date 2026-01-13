FROM n8nio/n8n:latest

USER root
RUN mkdir -p /home/node/.n8n/custom/n8n-nodes-mibo-testing
COPY --chown=node:node dist/ /home/node/.n8n/custom/n8n-nodes-mibo-testing/dist/
COPY --chown=node:node package.json /home/node/.n8n/custom/n8n-nodes-mibo-testing/
USER node
ENV N8N_CUSTOM_EXTENSIONS="/home/node/.n8n/custom/n8n-nodes-mibo-testing"
EXPOSE 5678
