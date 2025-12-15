# analysis
Repositorio de análisis de datos

## Project Structure

- `data/` - Contains the main dataset (`purchases.csv`) with Chilean public procurement purchase data
- `docs/` - Document scraping tools to download PDFs from Mercado Público (see [docs/README.md](docs/README.md) for details)

## Setup

Install dependencies:
```bash
pnpm install
# or
npm install
```

For web scraping, you'll also need to install Playwright browsers:
```bash
pnpm exec playwright install chromium
```

## Document Scraping

To scrape PDF documents from Mercado Público:
```bash
pnpm run scrape
```

For more details on document scraping options, see the [docs README](docs/README.md).
