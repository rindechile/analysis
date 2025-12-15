#!/usr/bin/env node
/**
 * Utility functions for scraping Mercado Público documents
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface Checkpoint {
  processedCodes: string[];
  failedCodes: Array<{
    code: string;
    error: string;
    timestamp: string;
    attempts: number;
  }>;
  lastProcessedTimestamp: string;
  totalProcessed: number;
  totalFailed: number;
}

export interface DownloadResult {
  code: string;
  success: boolean;
  pdfCount: number;
  error?: string;
  directory?: string;
}

// ============================================================================
// Checkpoint Management
// ============================================================================

const CHECKPOINT_FILE = join(__dirname, 'checkpoint.json');

/**
 * Load checkpoint from disk or create a new one
 */
export function loadCheckpoint(): Checkpoint {
  if (!existsSync(CHECKPOINT_FILE)) {
    return {
      processedCodes: [],
      failedCodes: [],
      lastProcessedTimestamp: new Date().toISOString(),
      totalProcessed: 0,
      totalFailed: 0,
    };
  }

  try {
    const content = readFileSync(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.warn('⚠️  Failed to load checkpoint, starting fresh:', error);
    return {
      processedCodes: [],
      failedCodes: [],
      lastProcessedTimestamp: new Date().toISOString(),
      totalProcessed: 0,
      totalFailed: 0,
    };
  }
}

/**
 * Save checkpoint to disk
 */
export function saveCheckpoint(checkpoint: Checkpoint): void {
  try {
    writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), 'utf-8');
  } catch (error) {
    console.error('❌ Failed to save checkpoint:', error);
  }
}

/**
 * Mark a code as processed in the checkpoint
 */
export function markProcessed(checkpoint: Checkpoint, code: string): void {
  if (!checkpoint.processedCodes.includes(code)) {
    checkpoint.processedCodes.push(code);
    checkpoint.totalProcessed++;
    checkpoint.lastProcessedTimestamp = new Date().toISOString();
  }
}

/**
 * Mark a code as failed in the checkpoint
 */
export function markFailed(
  checkpoint: Checkpoint,
  code: string,
  error: string,
  attempts: number = 1
): void {
  const existingIndex = checkpoint.failedCodes.findIndex((f) => f.code === code);
  
  if (existingIndex !== -1) {
    checkpoint.failedCodes[existingIndex] = {
      code,
      error,
      timestamp: new Date().toISOString(),
      attempts: checkpoint.failedCodes[existingIndex].attempts + attempts,
    };
  } else {
    checkpoint.failedCodes.push({
      code,
      error,
      timestamp: new Date().toISOString(),
      attempts,
    });
    checkpoint.totalFailed++;
  }
}

/**
 * Check if a code has already been processed
 */
export function isProcessed(checkpoint: Checkpoint, code: string): boolean {
  return checkpoint.processedCodes.includes(code);
}

/**
 * Get codes that should be retried (failed with < 3 attempts)
 */
export function getRetryableCodes(checkpoint: Checkpoint): string[] {
  return checkpoint.failedCodes
    .filter((f) => f.attempts < 3)
    .map((f) => f.code);
}

// ============================================================================
// Delay Utilities
// ============================================================================

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random delay between min and max milliseconds
 */
export function randomDelay(minMs: number = 1000, maxMs: number = 3000): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Sleep for a random duration (human-like behavior)
 */
export async function randomSleep(minMs: number = 1000, maxMs: number = 3000): Promise<void> {
  const delay = randomDelay(minMs, maxMs);
  await sleep(delay);
}

/**
 * Exponential backoff delay for retries
 */
export function exponentialBackoff(attempt: number, baseDelayMs: number = 1000): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt), 30000); // Max 30 seconds
}

// ============================================================================
// File System Utilities
// ============================================================================

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get the download directory for a specific chilecompra code
 */
export function getCodeDirectory(code: string): string {
  const downloadsDir = join(__dirname, 'downloads');
  ensureDirectory(downloadsDir);
  
  const codeDir = join(downloadsDir, code);
  ensureDirectory(codeDir);
  
  return codeDir;
}

/**
 * Sanitize filename to be filesystem-safe
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .trim();
}

/**
 * Generate a fallback filename with index
 */
export function getFallbackFilename(code: string, index: number): string {
  return `${code}_${index.toString().padStart(2, '0')}.pdf`;
}

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Log with emoji prefix for visual clarity
 */
export function logInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

export function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

export function logError(message: string): void {
  console.error(`❌ ${message}`);
}

export function logWarning(message: string): void {
  console.warn(`⚠️  ${message}`);
}

export function logDownload(message: string): void {
  console.log(`📥 ${message}`);
}

export function logSkip(message: string): void {
  console.log(`⏭️  ${message}`);
}

/**
 * Log progress statistics
 */
export function logProgress(
  current: number,
  total: number,
  succeeded: number,
  failed: number
): void {
  const percentage = ((current / total) * 100).toFixed(1);
  console.log(
    `\n📊 Progress: ${current}/${total} (${percentage}%) | ✅ ${succeeded} | ❌ ${failed}`
  );
}

/**
 * Log final summary
 */
export function logSummary(checkpoint: Checkpoint, totalCodes: number): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SCRAPING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total codes: ${totalCodes}`);
  console.log(`✅ Successfully processed: ${checkpoint.totalProcessed}`);
  console.log(`❌ Failed: ${checkpoint.totalFailed}`);
  console.log(`⏭️  Skipped (already processed): ${checkpoint.processedCodes.length - checkpoint.totalProcessed}`);
  
  if (checkpoint.failedCodes.length > 0) {
    console.log('\n❌ Failed codes:');
    checkpoint.failedCodes.forEach((f) => {
      console.log(`   - ${f.code}: ${f.error} (${f.attempts} attempts)`);
    });
  }
  
  console.log('='.repeat(60) + '\n');
}

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate chilecompra code format
 */
export function isValidCode(code: string): boolean {
  const regex = /^\d{3,7}-\d{1,4}-[A-Z]{2}25$/;
  return regex.test(code);
}

/**
 * Extract unique codes from CSV data
 */
export function extractUniqueCodes(rows: string[][]): string[] {
  const codeSet = new Set<string>();
  
  for (const row of rows) {
    if (row.length > 1) {
      const code = row[1].trim(); // Column index 1 is chilecompra_code
      if (code && isValidCode(code)) {
        codeSet.add(code);
      }
    }
  }
  
  return Array.from(codeSet).sort();
}
