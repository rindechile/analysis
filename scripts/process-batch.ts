#!/usr/bin/env node
/**
 * Process Batch - Main orchestrator for GitHub Actions
 *
 * Flow:
 * 1. Read pending codes
 * 2. For each code: scrape → process with Gemini → save results
 * 3. Update data files (pending, processed, failed)
 * 4. Clean up temporary files
 */

import { execSync } from 'child_process';
import { readdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getPendingBatch,
  removePendingCodes,
  addProcessedOrder,
  addFailedCode,
  getStats,
  type ProcessedOrder,
} from './data-manager.js';
import {
  processFiles,
  comparAndMark,
  type FileProcessResult,
} from './gemini-processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const SCRAPER_PATH = join(__dirname, '..', 'docs', 'scraper-single.ts');
const DOWNLOADS_DIR = join(__dirname, '..', 'docs', 'downloads');

// ============================================================================
// Main Process
// ============================================================================

async function processSingleCode(code: string): Promise<{ success: boolean; order?: ProcessedOrder; error?: string }> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${code}`);
  console.log('='.repeat(60));

  try {
    // Step 1: Scrape files
    console.log('Step 1: Scraping files...');
    const scraperCommand = `pnpm tsx ${SCRAPER_PATH} "${code}"`;
    console.log(`Executing: ${scraperCommand}`);

    let scraperOutput: string;
    try {
      scraperOutput = execSync(scraperCommand, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env, // Inherit all environment variables including DISPLAY from xvfb
        },
      });
    } catch (execError: any) {
      console.error('✗ Scraper execution failed');
      console.error('STDOUT:', execError.stdout?.toString() || '(empty)');
      console.error('STDERR:', execError.stderr?.toString() || '(empty)');
      throw new Error(`Scraper failed: ${execError.stderr || execError.message}`);
    }

    const scraperResult = JSON.parse(scraperOutput.trim());

    if (!scraperResult.success) {
      console.error(`✗ Scraping failed: ${scraperResult.error}`);
      return { success: false, error: scraperResult.error };
    }

    console.log(`✓ Scraped ${scraperResult.count} files`);

    // Step 2: Get downloaded files
    const codeDir = join(DOWNLOADS_DIR, code);
    if (!existsSync(codeDir)) {
      console.error('✗ Download directory not found');
      return { success: false, error: 'Download directory not found' };
    }

    const files = readdirSync(codeDir).map(f => join(codeDir, f));
    console.log(`Found ${files.length} files to process`);

    if (files.length === 0) {
      console.error('✗ No files to process');
      return { success: false, error: 'No files downloaded' };
    }

    // Step 3: Process with Gemini
    console.log('Step 2: Processing with Gemini AI...');
    const geminiResults: FileProcessResult[] = await processFiles(files);

    const successCount = geminiResults.filter(r => r.success).length;
    console.log(`✓ Processed ${successCount}/${geminiResults.length} files successfully`);

    // Step 4: Compare and mark
    console.log('Step 3: Comparing data and determining marca...');
    const comparison = comparAndMark(geminiResults);
    console.log(`✓ Marca: ${comparison.marca} (confidence: ${comparison.confidence})`);

    // Step 5: Create processed order
    const order: ProcessedOrder = {
      code,
      marca: comparison.marca,
      items: comparison.items,
      total_orden: comparison.items.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0),
      processedAt: new Date().toISOString(),
      confidence: comparison.confidence,
      filesProcessed: comparison.filesProcessed,
    };

    // Step 6: Clean up downloaded files
    console.log('Step 4: Cleaning up temporary files...');
    rmSync(codeDir, { recursive: true, force: true });
    console.log('✓ Cleanup complete');

    return { success: true, order };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`✗ Error processing ${code}: ${errorMessage}`);

    // Clean up on error too
    const codeDir = join(DOWNLOADS_DIR, code);
    if (existsSync(codeDir)) {
      rmSync(codeDir, { recursive: true, force: true });
    }

    return { success: false, error: errorMessage };
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('GitHub Actions - Batch Processor');
  console.log('='.repeat(80));

  // Step 1: Get pending codes
  console.log(`\nFetching batch of ${BATCH_SIZE} pending codes...`);
  const codes = getPendingBatch(BATCH_SIZE);

  if (codes.length === 0) {
    console.log('✓ No pending codes to process!');
    return;
  }

  console.log(`Found ${codes.length} codes to process`);

  // Step 2: Process each code
  const processedCodes: string[] = [];
  const failedCodes: string[] = [];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    console.log(`\n[${i + 1}/${codes.length}] Processing ${code}...`);

    const result = await processSingleCode(code);

    if (result.success && result.order) {
      addProcessedOrder(result.order);
      processedCodes.push(code);
      console.log(`✓ Successfully processed ${code}`);
    } else {
      addFailedCode(code, result.error || 'Unknown error');
      failedCodes.push(code);
      console.log(`✗ Failed to process ${code}`);
    }
  }

  // Step 3: Remove processed and failed codes from pending
  console.log('\nUpdating pending codes...');
  removePendingCodes([...processedCodes, ...failedCodes]);

  // Step 4: Display summary
  console.log('\n' + '='.repeat(80));
  console.log('BATCH SUMMARY');
  console.log('='.repeat(80));
  console.log(`Successful: ${processedCodes.length}`);
  console.log(`Failed: ${failedCodes.length}`);
  console.log(`Total: ${codes.length}`);

  const stats = getStats();
  console.log('\nOVERALL PROGRESS');
  console.log('='.repeat(80));
  console.log(`Pending: ${stats.pending}`);
  console.log(`Processed: ${stats.processed}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Completion: ${stats.completion.toFixed(2)}%`);
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
