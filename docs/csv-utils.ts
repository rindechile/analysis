/**
 * CSV parsing utility for the project
 */

import { readFileSync } from 'fs';

export interface Purchase {
  id: string;
  chilecompra_code: string;
  municipality_id: string;
  supplier_rut: string;
  quantity: string;
  unit_total_price: string;
  is_expensive: string;
  price_excess_amount: string;
  price_excess_percentage: string;
  item_id: string;
}

/**
 * Parse a CSV file and return the rows as an array of objects
 */
export function parseCsv(filePath: string): Purchase[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    
    if (lines.length === 0) {
      return [];
    }

    // Parse header
    const header = lines[0].split(',');
    
    // Parse rows
    const rows: Purchase[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const row: any = {};
      
      header.forEach((key, index) => {
        row[key] = values[index] || '';
      });
      
      rows.push(row as Purchase);
    }
    
    return rows;
  } catch (error) {
    console.error('Failed to parse CSV:', error);
    return [];
  }
}
