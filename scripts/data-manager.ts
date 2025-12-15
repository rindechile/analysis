/**
 * Data Manager for GitHub Actions workflow
 * Manages pending.json, processed.json, and failed.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'data');
const PENDING_FILE = join(DATA_DIR, 'pending.json');
const PROCESSED_FILE = join(DATA_DIR, 'processed.json');
const FAILED_FILE = join(DATA_DIR, 'failed.json');

// ============================================================================
// Type Definitions
// ============================================================================

export interface PendingData {
  codes: string[];
  lastUpdated: string;
  totalPending: number;
}

export interface ProcessedOrder {
  code: string;
  marca: 'sobreprecio' | 'falta_datos' | 'normal';
  items: Array<{
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
  }>;
  total_orden?: number;
  processedAt: string;
  confidence: 'alta' | 'media' | 'baja';
  filesProcessed: number;
}

export interface ProcessedData {
  orders: ProcessedOrder[];
  totalProcessed: number;
  lastUpdated: string;
}

export interface FailedCode {
  code: string;
  error: string;
  attempts: number;
  lastAttempt: string;
}

export interface FailedData {
  codes: FailedCode[];
  totalFailed: number;
  lastUpdated: string;
}

// ============================================================================
// Pending Codes Management
// ============================================================================

export function loadPending(): PendingData {
  if (!existsSync(PENDING_FILE)) {
    return {
      codes: [],
      lastUpdated: new Date().toISOString(),
      totalPending: 0,
    };
  }

  const content = readFileSync(PENDING_FILE, 'utf-8');
  return JSON.parse(content);
}

export function savePending(data: PendingData): void {
  data.lastUpdated = new Date().toISOString();
  data.totalPending = data.codes.length;
  writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getPendingBatch(batchSize: number): string[] {
  const pending = loadPending();
  return pending.codes.slice(0, batchSize);
}

export function removePendingCode(code: string): void {
  const pending = loadPending();
  pending.codes = pending.codes.filter(c => c !== code);
  savePending(pending);
}

export function removePendingCodes(codes: string[]): void {
  const pending = loadPending();
  const codeSet = new Set(codes);
  pending.codes = pending.codes.filter(c => !codeSet.has(c));
  savePending(pending);
}

// ============================================================================
// Processed Orders Management
// ============================================================================

export function loadProcessed(): ProcessedData {
  if (!existsSync(PROCESSED_FILE)) {
    return {
      orders: [],
      totalProcessed: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  const content = readFileSync(PROCESSED_FILE, 'utf-8');
  return JSON.parse(content);
}

export function saveProcessed(data: ProcessedData): void {
  data.lastUpdated = new Date().toISOString();
  data.totalProcessed = data.orders.length;
  writeFileSync(PROCESSED_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function addProcessedOrder(order: ProcessedOrder): void {
  const processed = loadProcessed();

  // Check if already exists (avoid duplicates)
  const exists = processed.orders.some(o => o.code === order.code);
  if (!exists) {
    processed.orders.push(order);
    saveProcessed(processed);
  }
}

export function addProcessedOrders(orders: ProcessedOrder[]): void {
  const processed = loadProcessed();
  const existingCodes = new Set(processed.orders.map(o => o.code));

  const newOrders = orders.filter(o => !existingCodes.has(o.code));
  processed.orders.push(...newOrders);
  saveProcessed(processed);
}

// ============================================================================
// Failed Codes Management
// ============================================================================

export function loadFailed(): FailedData {
  if (!existsSync(FAILED_FILE)) {
    return {
      codes: [],
      totalFailed: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  const content = readFileSync(FAILED_FILE, 'utf-8');
  return JSON.parse(content);
}

export function saveFailed(data: FailedData): void {
  data.lastUpdated = new Date().toISOString();
  data.totalFailed = data.codes.length;
  writeFileSync(FAILED_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function addFailedCode(code: string, error: string): void {
  const failed = loadFailed();

  // Check if already exists
  const existing = failed.codes.find(f => f.code === code);
  if (existing) {
    existing.attempts += 1;
    existing.error = error;
    existing.lastAttempt = new Date().toISOString();
  } else {
    failed.codes.push({
      code,
      error,
      attempts: 1,
      lastAttempt: new Date().toISOString(),
    });
  }

  saveFailed(failed);
}

export function getRetryableFailed(maxAttempts: number = 3): string[] {
  const failed = loadFailed();
  return failed.codes
    .filter(f => f.attempts < maxAttempts)
    .map(f => f.code);
}

// ============================================================================
// Statistics
// ============================================================================

export function getStats() {
  const pending = loadPending();
  const processed = loadProcessed();
  const failed = loadFailed();

  return {
    pending: pending.totalPending,
    processed: processed.totalProcessed,
    failed: failed.totalFailed,
    total: pending.totalPending + processed.totalProcessed + failed.totalFailed,
    completion: processed.totalProcessed / (pending.totalPending + processed.totalProcessed + failed.totalFailed) * 100,
  };
}
