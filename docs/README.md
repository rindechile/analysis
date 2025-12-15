# Mercado Público PDF Scraper

Automated scraper to download PDF documents from Chilean public procurement website (Mercado Público) for all purchases in `data/purchases.csv`.

## Features

✅ **Incremental scraping** - Only scrapes NEW codes when data is updated weekly  
✅ **Permanent registry** - `scraped-codes.json` tracks all-time scraped codes  
✅ **Resumable sessions** - Checkpoint system allows resuming interrupted scrapes  
✅ **Rate-limited** - Randomized delays (1-3s) between requests to avoid detection  
✅ **Anti-detection** - Headed browser mode with realistic user agent and headers  
✅ **Error handling** - Automatic retry with exponential backoff (up to 3 attempts)  
✅ **Progress tracking** - Real-time progress logging and final summary report  
✅ **Directory structure** - PDFs organized by `chilecompra_code` in separate folders

## Directory Structure

```
docs/
├── scrape-documents.ts       # Main scraper script
├── scraper-utils.ts          # Utility functions
├── csv-utils.ts              # CSV parsing utilities
├── scraped-codes.json        # PERMANENT registry of all scraped codes (all-time)
├── checkpoint.json           # Session-based progress tracker
├── download-manifest.json    # JSON manifest of successful downloads
└── downloads/                # PDF output directory
    └── {chilecompra_code}/   # One folder per purchase code
        └── *.pdf             # Downloaded PDFs with original names

data/
└── purchases.csv             # Source data with purchase codes
```

## Weekly Update Workflow

When new data arrives weekly:

1. **Update CSV**: Replace or append to `data/purchases.csv` with new purchase codes
2. **Run scraper**: `pnpm run scrape` - automatically detects and scrapes only NEW codes
3. **Review**: Check the summary to see how many new codes were processed

The scraper automatically:
- Loads `scraped-codes.json` to get all previously scraped codes
- Compares against the CSV to find NEW codes only
- Scrapes only the new codes
- Updates the registry with newly scraped codes

## Usage

### Basic Usage (Resume from checkpoint)
```bash
pnpm tsx docs/scrape-documents.ts
# or
pnpm run scrape
```

### Start Fresh (Ignore checkpoint)
```bash
pnpm tsx docs/scrape-documents.ts --fresh
# or
pnpm run scrape:fresh
```

### Test Mode (First N codes only)
```bash
pnpm tsx docs/scrape-documents.ts --test=10
# or
pnpm run scrape:test
```

### Retry Failed Codes
```bash
pnpm tsx docs/scrape-documents.ts --retry
# or
pnpm run scrape:retry
```

## How It Works

The scraper follows a 3-stage navigation flow for each purchase code:

### Stage 1: Search & Navigate
- Goes to `https://buscador.mercadopublico.cl/ordenes-de-compra?keywords={code}`
- Finds the link matching the purchase code
- Clicks the link (opens a new page with purchase order details)

### Stage 2: Open Attachments
- On the detail page, locates the attachments button (`#imgAttachments`)
- Clicks the button to open the attachments popup window

### Stage 3: Download PDFs
- In the popup, finds all "Ver" (view) buttons for PDFs
- Clicks each button to trigger PDF download
- Saves files with original names to `downloads/{code}/`

## Important Notes

⚠️ **Browser Mode**: The scraper runs in **headed mode** (browser window visible) because CloudFront blocks headless browsers. Do not change `headless: false`.

⚠️ **Rate Limiting**: Random delays are built-in. Do not remove them or you may trigger rate limiting/blocking.

⚠️ **Long Running**: With ~48,000 codes, expect this to take several days. Use checkpoint system to resume.

⚠️ **No Attachments**: Some purchases have no documents - this is logged as success with 0 PDFs.

## Checkpoint System

The checkpoint file (`checkpoint.json`) tracks:
- ✅ Successfully processed codes
- ❌ Failed codes with error messages and attempt counts
- 📊 Statistics (total processed, total failed)
- ⏱️ Last processed timestamp

To reset and start over, delete `checkpoint.json`.

## Output

### Download Manifest
`download-manifest.json` contains:
```json
[
  {
    "code": "3707-351-AG25",
    "success": true,
    "pdfCount": 2,
    "directory": "/path/to/downloads/3707-351-AG25"
  }
]
```

### Progress Logging
```
📊 Progress: 100/48304 (0.2%) | ✅ 95 | ❌ 5
✅ [1/48304] 3707-351-AG25: 2 PDFs
❌ [2/48304] 1234-567-AG25: Failed to navigate to purchase order
⏭️  Already processed: 3707-351-AG25
```

## Troubleshooting

### CloudFront 403 Error
If you see "The request could not be satisfied" errors:
- Ensure `headless: false` in the browser launch config
- Check that user agent and headers are properly set
- Increase random delays between requests

### Timeout Errors
- Increase `PAGE_TIMEOUT` constant (default: 60s)
- Check internet connection stability
- Some pages may genuinely be slow - retry logic should handle this

### No PDFs Downloaded
- Some purchases legitimately have no attachments
- Check `download-manifest.json` to see pdfCount
- Manually verify the purchase code on Mercado Público website

## Data Source

Reads from: `/schemas/data/purchase.csv`

Expected columns:
- Column 1: `chilecompra_code` (format: `XXXXXX-XXX-XX25`)
- Other columns: municipality_id, supplier_rut, prices, etc.

## Dependencies

- `playwright` - Browser automation
- `p-limit` - Concurrency control
- Node.js built-ins - fs, path

## Configuration

Edit these constants in `scrape-documents.ts` to adjust behavior:

```typescript
const PAGE_TIMEOUT = 60000;      // Page load timeout (ms)
const MAX_RETRIES = 3;           // Retry attempts per code
const RETRY_BASE_DELAY = 2000;   // Base delay for exponential backoff (ms)
const CONCURRENCY = 1;           // Number of parallel browsers (recommend 1)
```

## Performance

- **Speed**: ~3-5 seconds per code (with delays)
- **Total Time**: 48,304 codes × 4s avg ≈ 54 hours
- **Storage**: Varies by PDF size, estimate 5-10GB total

## License

Same as parent project.
