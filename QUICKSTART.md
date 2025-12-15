# Quick Start Guide

## Initial Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   # or
   npm install
   ```

2. **Install Playwright browsers:**
   ```bash
   pnpm exec playwright install chromium
   ```

## Running the Scraper

### Test with a small sample (recommended first run):
```bash
pnpm run scrape:test
```

### Run the full scraper:
```bash
pnpm run scrape
```

### Other options:
- `pnpm run scrape:fresh` - Start from scratch (ignores checkpoint)
- `pnpm run scrape:retry` - Retry previously failed codes

The scraper will:
- Read purchase codes from `data/purchases.csv`
- Download PDFs to `docs/downloads/{code}/`
- Save progress to `docs/checkpoint.json`
- Create a manifest at `docs/download-manifest.json`

## Important Notes

- The scraper runs with a visible browser window (required by CloudFront)
- With ~54,000 codes, this will take several days to complete
- The checkpoint system allows you to stop and resume anytime
- All downloaded files are stored locally and can be very large

For detailed documentation, see [docs/README.md](docs/README.md).
