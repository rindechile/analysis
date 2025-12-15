#!/bin/bash
# Wrapper script for running the scraper
# Usage: ./run-scraper.sh {codigo}

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if code argument is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Missing code argument${NC}"
    echo "Usage: $0 {codigo}"
    echo "Example: $0 3506-434-SE25"
    exit 1
fi

CODE="$1"

# Validate code format (basic check)
if ! [[ "$CODE" =~ ^[0-9]+-[0-9]+-[A-Z]{2}[0-9]{2}$ ]]; then
    echo -e "${YELLOW}Warning: Code format may be invalid${NC}"
    echo "Expected format: XXXX-XXX-XX25"
fi

# Check if running in Docker or local
if [ -f /.dockerenv ]; then
    # Running inside Docker container
    echo -e "${GREEN}Running scraper inside Docker container...${NC}"
    pnpm tsx /app/docs/scraper-single.ts "$CODE"
else
    # Running on host - try Docker first, then local
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}Running scraper via Docker...${NC}"
        docker exec rindechile-scraper pnpm tsx /app/docs/scraper-single.ts "$CODE"
    else
        echo -e "${GREEN}Running scraper locally...${NC}"
        pnpm tsx docs/scraper-single.ts "$CODE"
    fi
fi
