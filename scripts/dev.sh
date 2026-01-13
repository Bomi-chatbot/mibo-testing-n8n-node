#!/bin/bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔨 Building the node for the first time...${NC}"
npm run build

echo -e "${BLUE}🐳 Starting Docker Compose with Hot Reload...${NC}"
docker compose -f docker-compose.dev.yml up -d

echo -e "${GREEN}✅ n8n is running at http://localhost:5678${NC}"
echo -e "${BLUE}👀 Watching for code changes...${NC}"

cleanup() {
    echo -e "\n${BLUE}🛑 Stopping services...${NC}"
    docker compose -f docker-compose.dev.yml down
    rm -f .last_build
    exit
}

trap cleanup SIGINT

npm run dev &

# Create reference file for 'find -newer'
touch .last_build

while true; do
    # Check if any file in dist is newer than our reference file
    if [ -n "$(find dist -type f -newer .last_build -print -quit)" ]; then
        echo -e "${GREEN}🔄 Change detected in dist, restarting n8n...${NC}"
        docker compose restart n8n
        touch .last_build
    fi
    sleep 2
done
