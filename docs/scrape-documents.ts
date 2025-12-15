#!/usr/bin/env node
/**
 * Scrape PDF documents from Mercado Público for all purchases in data/purchases.csv
 * 
 * Usage:
 *   pnpm tsx docs/scrape-documents.ts              # Resume from checkpoint
 *   pnpm tsx docs/scrape-documents.ts --fresh      # Start fresh (ignore checkpoint)
 *   pnpm tsx docs/scrape-documents.ts --test=10    # Test mode: only process 10 codes
 *   pnpm tsx docs/scrape-documents.ts --retry      # Retry previously failed codes
 * 
 * The script follows a 4-stage navigation flow:
 * 1. Search for the purchase order using the chilecompra code
 * 2. Download the PDF report from the detail page
 * 3. Click the attachments button to open the popup
 * 4. Download all PDFs from the attachments popup
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { join, dirname } from 'path';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import pLimit from 'p-limit';
import { parseCsv } from './csv-utils';
import {
  loadCheckpoint,
  saveCheckpoint,
  markProcessed,
  markFailed,
  isProcessed,
  getRetryableCodes,
  randomSleep,
  exponentialBackoff,
  sleep,
  getCodeDirectory,
  sanitizeFilename,
  getFallbackFilename,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logDownload,
  logSkip,
  logProgress,
  logSummary,
  extractUniqueCodes,
  // Scraped codes registry (permanent storage)
  loadScrapedCodesRegistry,
  saveScrapedCodesRegistry,
  addToScrapedRegistry,
  getNewCodesToScrape,
  getScrapedCodesSet,
  type Checkpoint,
  type DownloadResult,
  type ScrapedCodesRegistry,
} from './scraper-utils';

// ============================================================================
// Configuration
// ============================================================================

const CSV_PATH = join(__dirname, '..', 'data', 'purchases.csv');
const BASE_URL = 'https://buscador.mercadopublico.cl/ordenes-de-compra';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;
const PAGE_TIMEOUT = 60000; // 60 seconds
const CONCURRENCY = 1; // Single browser to avoid detection

// ============================================================================
// CLI Arguments
// ============================================================================

interface CliArgs {
  fresh: boolean;
  test?: number;
  retry: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: CliArgs = {
    fresh: false,
    retry: false,
  };

  for (const arg of args) {
    if (arg === '--fresh') {
      parsed.fresh = true;
    } else if (arg === '--retry') {
      parsed.retry = true;
    } else if (arg.startsWith('--test=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (!isNaN(value) && value > 0) {
        parsed.test = value;
      }
    }
  }

  return parsed;
}

// ============================================================================
// Browser Navigation
// ============================================================================

/**
 * Stage 1: Search for the purchase order and navigate to its detail page
 */
async function navigateToPurchaseOrder(context: BrowserContext, page: Page, code: string): Promise<Page | null> {
  try {
    const searchUrl = `${BASE_URL}?keywords=${encodeURIComponent(code)}`;
    logInfo(`Navigating to search page: ${code}`);
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await randomSleep(2000, 3000); // Wait for dynamic content to load

    // Find link with text matching the code
    const link = page.locator(`a:has-text("${code}")`).first();
    const linkCount = await link.count();
    
    if (linkCount === 0) {
      logWarning(`No link found for code: ${code}`);
      return null;
    }

    logInfo(`Clicking purchase order link (opens new page): ${code}`);
    
    // Set up handler for new page
    const newPagePromise = context.waitForEvent('page', { timeout: PAGE_TIMEOUT });
    await link.click();
    
    const detailPage = await newPagePromise;
    await detailPage.waitForLoadState('domcontentloaded', { timeout: PAGE_TIMEOUT });
    await randomSleep(800, 1500);

    logSuccess(`Detail page opened: ${detailPage.url()}`);
    return detailPage;
  } catch (error) {
    logError(`Failed to navigate to purchase order ${code}: ${error}`);
    return null;
  }
}

/**
 * Stage 2: Download the PDF report from the detail page
 */
async function downloadPDFReport(page: Page, code: string): Promise<boolean> {
  try {
    logInfo('Looking for PDF report button');

    // Wait for the PDF report button
    const pdfButton = page.locator('input#imgPDF, input[name="imgPDF"]').first();
    const buttonCount = await pdfButton.count();
    
    if (buttonCount === 0) {
      logWarning('No PDF report button found');
      return false;
    }

    // Get the onclick attribute to extract the PDF URL
    const onclick = await pdfButton.getAttribute('onclick');
    if (!onclick) {
      logWarning('PDF button has no onclick attribute');
      return false;
    }

    // Extract URL from onclick: open('PDFReport.aspx?qs=...','MercadoPublico', ...)
    const urlMatch = onclick.match(/'([^']+)'/);
    if (!urlMatch) {
      logWarning('Could not extract PDF URL from onclick');
      return false;
    }

    const relativePdfUrl = urlMatch[1];
    const baseUrl = 'https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/';
    const fullPdfUrl = baseUrl + relativePdfUrl;
    
    logInfo(`Navigating to PDF report: ${relativePdfUrl}`);

    // Create a new page and set up download handler
    const pdfPage = await page.context().newPage();
    
    try {
      const downloadPromise = pdfPage.waitForEvent('download', { timeout: 30000 });
      
      // Navigate to PDF URL (will trigger download and throw)
      pdfPage.goto(fullPdfUrl, { waitUntil: 'commit' }).catch(() => {
        // Ignore the error - it's expected when download starts
      });
      
      const download = await downloadPromise;
      
      const codeDir = getCodeDirectory(code);
      const suggestedFilename = download.suggestedFilename();
      const filename = suggestedFilename 
        ? sanitizeFilename(suggestedFilename)
        : `${code}_report.pdf`;
      
      const filePath = join(codeDir, filename);
      await download.saveAs(filePath);
      
      logSuccess(`Saved PDF report: ${filename}`);
      
      // Close the PDF page and wait a bit before continuing
      await pdfPage.close();
      await randomSleep(500, 1000);
      
      return true;
    } catch (downloadError) {
      logWarning(`Failed to download PDF report: ${downloadError}`);
      if (!pdfPage.isClosed()) {
        await pdfPage.close();
      }
      return false;
    }
  } catch (error) {
    logWarning(`Failed to get PDF report: ${error}`);
    return false;
  }
}

/**
 * Stage 3: Click the attachments button and handle the popup
 */
async function openAttachmentsPopup(page: Page): Promise<Page | null> {
  try {
    logInfo('Looking for attachments button');

    // Wait for the attachments button
    const attachmentButton = page.locator('input#imgAttachments, input[name="imgAttachments"]').first();
    const buttonCount = await attachmentButton.count();
    
    if (buttonCount === 0) {
      logWarning('No attachments button found - purchase may have no documents');
      return null;
    }

    // Set up popup handler before clicking
    const popupPromise = page.waitForEvent('popup', { timeout: 10000 });
    
    logInfo('Clicking attachments button');
    await attachmentButton.click();
    
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded', { timeout: PAGE_TIMEOUT });
    await randomSleep(500, 1000);

    logSuccess('Attachments popup opened');
    return popup;
  } catch (error) {
    logWarning(`Failed to open attachments popup: ${error}`);
    return null;
  }
}

/**
 * Stage 4: Download all PDFs from the attachments popup
 */
async function downloadPDFs(popup: Page, code: string): Promise<number> {
  try {
    logInfo('Looking for PDF download buttons');

    // Find all "Ver" (View) buttons - these open the PDFs
    const viewButtons = popup.locator('input[id*="imgShow"], input[name*="imgShow"]');
    const buttonCount = await viewButtons.count();

    if (buttonCount === 0) {
      logWarning('No PDF download buttons found');
      return 0;
    }

    logInfo(`Found ${buttonCount} PDF(s) to download`);

    const codeDir = getCodeDirectory(code);
    let downloadedCount = 0;

    for (let i = 0; i < buttonCount; i++) {
      try {
        // Get the current button (re-query to avoid stale element)
        const button = popup.locator('input[id*="imgShow"], input[name*="imgShow"]').nth(i);
        
        // Set up download handler
        const downloadPromise = popup.waitForEvent('download', { timeout: 30000 });
        
        logDownload(`Downloading PDF ${i + 1}/${buttonCount} for ${code}`);
        await button.click();
        
        const download = await downloadPromise;
        
        // Get suggested filename or use fallback
        const suggestedFilename = download.suggestedFilename();
        const filename = suggestedFilename 
          ? sanitizeFilename(suggestedFilename)
          : getFallbackFilename(code, i + 1);
        
        const filePath = join(codeDir, filename);
        await download.saveAs(filePath);
        
        logSuccess(`Saved: ${filename}`);
        downloadedCount++;
        
        await randomSleep(500, 1000);
      } catch (error) {
        logError(`Failed to download PDF ${i + 1} for ${code}: ${error}`);
      }
    }

    return downloadedCount;
  } catch (error) {
    logError(`Failed to download PDFs: ${error}`);
    return 0;
  }
}

/**
 * Process a single chilecompra code with retry logic
 */
async function processCode(
  context: BrowserContext,
  code: string,
  attempt: number = 1
): Promise<DownloadResult> {
  const searchPage = await context.newPage();
  let detailPage: Page | null = null;
  
  try {
    // Stage 1: Navigate to purchase order (opens new page)
    detailPage = await navigateToPurchaseOrder(context, searchPage, code);
    if (!detailPage) {
      await searchPage.close();
      return { code, success: false, pdfCount: 0, error: 'Failed to navigate to purchase order' };
    }

    // Stage 2: Download PDF report from detail page
    const reportDownloaded = await downloadPDFReport(detailPage, code);
    let totalPdfCount = reportDownloaded ? 1 : 0;

    // Stage 3: Open attachments popup
    const popup = await openAttachmentsPopup(detailPage);
    if (!popup) {
      // No attachments is not necessarily an error - some purchases may not have documents
      await detailPage.close();
      await searchPage.close();
      return { code, success: true, pdfCount: totalPdfCount, directory: getCodeDirectory(code) };
    }

    // Stage 4: Download PDFs from attachments
    const attachmentPdfCount = await downloadPDFs(popup, code);
    totalPdfCount += attachmentPdfCount;
    
    await popup.close();
    await detailPage.close();
    await searchPage.close();
    
    return {
      code,
      success: true,
      pdfCount: totalPdfCount,
      directory: getCodeDirectory(code),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Clean up pages
    if (detailPage && !detailPage.isClosed()) {
      await detailPage.close();
    }
    if (searchPage && !searchPage.isClosed()) {
      await searchPage.close();
    }
    
    if (attempt < MAX_RETRIES) {
      const delay = exponentialBackoff(attempt, RETRY_BASE_DELAY);
      logWarning(`Attempt ${attempt} failed for ${code}, retrying in ${delay}ms...`);
      await sleep(delay);
      return processCode(context, code, attempt + 1);
    }
    
    return {
      code,
      success: false,
      pdfCount: 0,
      error: `Failed after ${MAX_RETRIES} attempts: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const args = parseArgs();
  
  console.log('\n' + '='.repeat(60));
  console.log('📥 MERCADO PÚBLICO PDF SCRAPER');
  console.log('='.repeat(60));
  
  // Load scraped codes registry (permanent storage of all scraped codes)
  const registry = loadScrapedCodesRegistry();
  logInfo(`Loaded scraped codes registry: ${registry.totalCount} codes already scraped (all-time)`);
  
  // Load or create checkpoint (session-based progress)
  let checkpoint: Checkpoint;
  if (args.fresh) {
    logInfo('Starting fresh session (ignoring session checkpoint)');
    checkpoint = {
      processedCodes: [],
      failedCodes: [],
      lastProcessedTimestamp: new Date().toISOString(),
      totalProcessed: 0,
      totalFailed: 0,
    };
  } else {
    checkpoint = loadCheckpoint();
    logInfo(`Loaded session checkpoint: ${checkpoint.processedCodes.length} codes processed this session`);
  }

  // Load purchase data
  logInfo(`Reading purchase data from CSV: ${CSV_PATH}`);
  const rows = parseCsv(CSV_PATH);
  const allCodes = extractUniqueCodes(rows);
  logInfo(`Found ${allCodes.length} unique chilecompra codes in CSV`);

  // Determine which codes to process
  let codesToProcess: string[];
  if (args.retry) {
    codesToProcess = getRetryableCodes(checkpoint);
    logInfo(`Retry mode: processing ${codesToProcess.length} failed codes`);
  } else if (args.test) {
    // In test mode, still filter out already scraped codes
    const newCodes = getNewCodesToScrape(allCodes, registry);
    codesToProcess = newCodes.slice(0, args.test);
    logInfo(`Test mode: processing first ${args.test} NEW codes (${allCodes.length - newCodes.length} already scraped)`);
  } else {
    // Filter out codes that are already in the permanent registry
    codesToProcess = getNewCodesToScrape(allCodes, registry);
    logInfo(`Found ${allCodes.length - codesToProcess.length} codes already in registry`);
    logInfo(`Processing ${codesToProcess.length} NEW codes`);
  }

  if (codesToProcess.length === 0) {
    logSuccess('No codes to process!');
    return;
  }

  // Launch browser
  logInfo('Launching Chromium browser...');
  const browser = await chromium.launch({
    headless: false, // Use headed mode to avoid detection
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  // Create a context with realistic browser fingerprint
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    permissions: [],
    extraHTTPHeaders: {
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    },
  });

  // Set up concurrency limiter
  const limit = pLimit(CONCURRENCY);
  let processedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  // Process codes with progress tracking
  const results = await Promise.all(
    codesToProcess.map((code) =>
      limit(async () => {
        // Skip if already processed in this session (for non-fresh runs)
        if (!args.fresh && isProcessed(checkpoint, code)) {
          logSkip(`Already processed in this session: ${code}`);
          return null;
        }

        const result = await processCode(context, code);
        
        processedCount++;
        
        if (result.success) {
          succeededCount++;
          markProcessed(checkpoint, code);
          // Add to permanent registry
          addToScrapedRegistry(registry, code);
          logSuccess(`[${processedCount}/${codesToProcess.length}] ${code}: ${result.pdfCount} PDFs`);
        } else {
          failedCount++;
          markFailed(checkpoint, code, result.error || 'Unknown error');
          logError(`[${processedCount}/${codesToProcess.length}] ${code}: ${result.error}`);
        }

        // Save checkpoint and registry every 10 codes
        if (processedCount % 10 === 0) {
          saveCheckpoint(checkpoint);
          saveScrapedCodesRegistry(registry);
          logProgress(processedCount, codesToProcess.length, succeededCount, failedCount);
        }

        return result;
      })
    )
  );

  // Final saves
  saveCheckpoint(checkpoint);
  saveScrapedCodesRegistry(registry);

  // Close browser
  await context.close();
  await browser.close();

  // Print summary
  logSummary(checkpoint, allCodes.length, registry);

  // Generate manifest
  const manifest = results.filter((r) => r !== null && r.success);
  const manifestPath = join(__dirname, 'download-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  logSuccess(`Manifest saved to: ${manifestPath}`);
}

// ============================================================================
// Entry Point
// ============================================================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
