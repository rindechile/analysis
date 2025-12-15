#!/usr/bin/env node
/**
 * Single-code scraper for n8n integration
 *
 * Usage:
 *   tsx docs/scraper-single.ts {codigo}
 *   tsx docs/scraper-single.ts 3506-434-SE25
 *
 * Output (JSON to stdout):
 *   {"success": true, "code": "3506-434-SE25", "files": ["path1.pdf", "path2.pdf"], "count": 2}
 *   {"success": false, "code": "1234-567-SE25", "error": "Failed to navigate"}
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { join, dirname, basename } from 'path';
import { readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  randomSleep,
  sleep,
  getCodeDirectory,
  sanitizeFilename,
} from './scraper-utils';

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = 'https://buscador.mercadopublico.cl/ordenes-de-compra';
const PAGE_TIMEOUT = 120000; // 120 seconds - increased for slow pages
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

// ============================================================================
// Navigation Functions (copied from scrape-documents.ts)
// ============================================================================

async function navigateToPurchaseOrder(context: BrowserContext, page: Page, code: string): Promise<Page | null> {
  try {
    const searchUrl = `${BASE_URL}?keywords=${encodeURIComponent(code)}`;
    console.error(`[DEBUG] Navigating to: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT });
    console.error(`[DEBUG] Page loaded, waiting for content...`);
    await randomSleep(3000, 5000); // Increased wait time

    // Wait for any links to appear
    await page.waitForSelector('a', { timeout: 10000 }).catch(() => {
      console.error(`[DEBUG] No links found on page`);
    });

    const link = page.locator(`a:has-text("${code}")`).first();
    const linkCount = await link.count();
    console.error(`[DEBUG] Found ${linkCount} matching links for code ${code}`);

    if (linkCount === 0) {
      // Try to get page content for debugging
      const pageTitle = await page.title();
      console.error(`[DEBUG] Page title: ${pageTitle}`);
      return null;
    }

    const newPagePromise = context.waitForEvent('page', { timeout: PAGE_TIMEOUT });
    await link.click();

    const detailPage = await newPagePromise;
    console.error(`[DEBUG] Detail page opened, waiting for load...`);

    // Try domcontentloaded first, then fall back to commit
    try {
      await detailPage.waitForLoadState('domcontentloaded', { timeout: 30000 });
      console.error(`[DEBUG] DOM loaded`);
    } catch (e) {
      console.error(`[DEBUG] DOM timeout, trying commit state...`);
      await detailPage.waitForLoadState('commit', { timeout: 10000 }).catch(() => {
        console.error(`[DEBUG] Commit timeout, continuing anyway`);
      });
    }

    await randomSleep(2000, 3000);

    console.error(`[DEBUG] Successfully navigated to detail page`);
    return detailPage;
  } catch (error) {
    console.error(`[DEBUG] Navigation error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function downloadPDFReport(page: Page, code: string): Promise<boolean> {
  try {
    const pdfButton = page.locator('input#imgPDF, input[name="imgPDF"]').first();
    const buttonCount = await pdfButton.count();

    if (buttonCount === 0) {
      return false;
    }

    const onclick = await pdfButton.getAttribute('onclick');
    if (!onclick) {
      return false;
    }

    const urlMatch = onclick.match(/'([^']+)'/);
    if (!urlMatch) {
      return false;
    }

    const relativePdfUrl = urlMatch[1];
    const baseUrl = 'https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/';
    const fullPdfUrl = baseUrl + relativePdfUrl;

    const pdfPage = await page.context().newPage();

    try {
      const downloadPromise = pdfPage.waitForEvent('download', { timeout: 30000 });

      pdfPage.goto(fullPdfUrl, { waitUntil: 'commit' }).catch(() => {});

      const download = await downloadPromise;

      const codeDir = getCodeDirectory(code);
      const suggestedFilename = download.suggestedFilename();
      const filename = suggestedFilename
        ? sanitizeFilename(suggestedFilename)
        : `${code}_report.pdf`;

      const filepath = join(codeDir, filename);
      await download.saveAs(filepath);

      return true;
    } finally {
      if (!pdfPage.isClosed()) {
        await pdfPage.close();
      }
    }
  } catch (error) {
    return false;
  }
}

async function openAttachmentsPopup(page: Page): Promise<Page | null> {
  try {
    const attachmentsButton = page.locator('input#imgAttachments, input[name="imgAttachments"]').first();
    const buttonCount = await attachmentsButton.count();

    if (buttonCount === 0) {
      return null;
    }

    const popupPromise = page.context().waitForEvent('popup', { timeout: 10000 });
    await attachmentsButton.click();

    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded', { timeout: PAGE_TIMEOUT });
    await randomSleep(800, 1500);

    return popup;
  } catch (error) {
    return null;
  }
}

async function downloadPDFs(popup: Page, code: string): Promise<number> {
  try {
    await popup.waitForLoadState('domcontentloaded', { timeout: PAGE_TIMEOUT });
    await randomSleep(1000, 2000);

    const viewButtons = popup.locator('input[id*="imgShow"]');
    const buttonCount = await viewButtons.count();

    if (buttonCount === 0) {
      return 0;
    }

    let downloadedCount = 0;

    for (let i = 0; i < buttonCount; i++) {
      try {
        const button = viewButtons.nth(i);
        const downloadPromise = popup.waitForEvent('download', { timeout: 30000 });
        await button.click();

        const download = await downloadPromise;
        const codeDir = getCodeDirectory(code);
        const suggestedFilename = download.suggestedFilename();
        const filename = suggestedFilename
          ? sanitizeFilename(suggestedFilename)
          : `${code}_${String(i + 1).padStart(2, '0')}.pdf`;

        const filepath = join(codeDir, filename);
        await download.saveAs(filepath);

        downloadedCount++;

        await randomSleep(500, 1000);
      } catch (error) {
        // Continue with next file
      }
    }

    return downloadedCount;
  } catch (error) {
    return 0;
  }
}

// ============================================================================
// Main Process Function
// ============================================================================

interface ScraperResult {
  success: boolean;
  code: string;
  files?: string[];
  count?: number;
  error?: string;
}

async function processSingleCode(code: string): Promise<ScraperResult> {
  const browser = await chromium.launch({
    headless: false, // Required to avoid CloudFront blocks
    args: [
      '--disable-blink-features=AutomationControlled', // Hide automation
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
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

  // Remove webdriver property to avoid detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const searchPage = await context.newPage();
  let detailPage: Page | null = null;

  try {
    // Stage 1: Navigate to purchase order
    detailPage = await navigateToPurchaseOrder(context, searchPage, code);
    if (!detailPage) {
      await browser.close();
      return {
        success: false,
        code,
        error: 'Failed to navigate to purchase order',
      };
    }

    // Stage 2: Download PDF report
    await downloadPDFReport(detailPage, code);

    // Stage 3: Open attachments popup
    const popup = await openAttachmentsPopup(detailPage);
    if (popup) {
      // Stage 4: Download PDFs from attachments
      await downloadPDFs(popup, code);
      await popup.close();
    }

    await detailPage.close();
    await searchPage.close();
    await browser.close();

    // Get list of downloaded files
    const codeDir = getCodeDirectory(code);
    const files: string[] = [];

    if (existsSync(codeDir)) {
      const fileNames = readdirSync(codeDir);
      files.push(...fileNames.map(f => join(codeDir, f)));
    }

    return {
      success: true,
      code,
      files,
      count: files.length,
    };
  } catch (error) {
    // Clean up
    if (detailPage && !detailPage.isClosed()) {
      await detailPage.close();
    }
    if (searchPage && !searchPage.isClosed()) {
      await searchPage.close();
    }
    await browser.close();

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      code,
      error: errorMessage,
    };
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const code = process.argv[2];

  if (!code) {
    const errorResult: ScraperResult = {
      success: false,
      code: '',
      error: 'Missing code argument. Usage: tsx scraper-single.ts {codigo}',
    };
    console.log(JSON.stringify(errorResult));
    process.exit(1);
  }

  // Validate code format (basic check)
  if (!code.match(/^\d+-\d+-[A-Z]{2}\d{2}$/)) {
    const errorResult: ScraperResult = {
      success: false,
      code,
      error: `Invalid code format: ${code}. Expected format: XXXX-XXX-XX25`,
    };
    console.log(JSON.stringify(errorResult));
    process.exit(1);
  }

  try {
    const result = await processSingleCode(code);
    console.log(JSON.stringify(result));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorResult: ScraperResult = {
      success: false,
      code,
      error: `Unexpected error: ${errorMessage}`,
    };
    console.log(JSON.stringify(errorResult));
    process.exit(1);
  }
}

main();
