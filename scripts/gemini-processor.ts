/**
 * Gemini AI Processor
 * Processes PDFs and images using Google Gemini 1.5 Flash
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { basename } from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ExtractedItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
}

export interface ExtractedData {
  items: ExtractedItem[];
  total_orden?: number;
  legible: boolean;
  error?: string;
}

export interface FileProcessResult {
  filename: string;
  success: boolean;
  data?: ExtractedData;
  error?: string;
}

// ============================================================================
// Gemini Configuration
// ============================================================================

// Use the full model name with version prefix
const GEMINI_MODEL = 'models/gemini-1.5-flash-latest';

const EXTRACTION_PROMPT = `Analiza este documento de orden de compra chilena (Mercado Público).

Extrae la información en formato JSON estricto:
{
  "items": [
    {
      "descripcion": "string",
      "cantidad": number,
      "precio_unitario": number
    }
  ],
  "total_orden": number,
  "legible": true
}

Reglas CRÍTICAS:
- Precios en CLP sin símbolos, puntos ni comas (solo números)
- Ejemplo: 15042016 (no "15.042.016" ni "$15.042.016")
- Si hay múltiples items, lista todos
- Si el documento no es legible, retorna: {"legible": false, "error": "razón específica"}
- La respuesta debe ser SOLO el JSON, sin texto adicional

Responde únicamente con el JSON.`;

// ============================================================================
// Initialize Gemini
// ============================================================================

function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY environment variable is not set');
  }

  return new GoogleGenerativeAI(apiKey);
}

// ============================================================================
// File Processing
// ============================================================================

/**
 * Process a single file (PDF or image) with Gemini
 */
export async function processFile(filePath: string): Promise<FileProcessResult> {
  const filename = basename(filePath);

  try {
    console.log(`  Processing file: ${filename}`);

    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    // Read file as base64
    const fileBuffer = readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    console.log(`  File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);

    // Determine MIME type
    const mimeType = filePath.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')
      ? 'image/jpeg'
      : filePath.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'application/pdf'; // Default to PDF

    console.log(`  MIME type: ${mimeType}`);

    // Create request
    console.log(`  Calling Gemini API...`);
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      { text: EXTRACTION_PROMPT },
    ]);

    const response = await result.response;
    const text = response.text();
    console.log(`  Gemini response received (${text.length} chars)`);

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(`  ✗ No JSON found. Response: ${text.substring(0, 200)}`);
      return {
        filename,
        success: false,
        error: `No JSON found in response. Got: ${text.substring(0, 100)}`,
      };
    }

    const data: ExtractedData = JSON.parse(jsonMatch[0]);
    console.log(`  ✓ Parsed JSON: ${JSON.stringify(data).substring(0, 100)}...`);

    // Validate response
    if (!data.legible) {
      console.log(`  ✗ Document not legible: ${data.error}`);
      return {
        filename,
        success: false,
        error: data.error || 'Document not readable',
      };
    }

    console.log(`  ✓ Successfully extracted ${data.items?.length || 0} items`);
    return {
      filename,
      success: true,
      data,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`  ✗ Error: ${errorMsg}`);
    return {
      filename,
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Process multiple files and return results
 */
export async function processFiles(filePaths: string[]): Promise<FileProcessResult[]> {
  const results: FileProcessResult[] = [];

  for (const filePath of filePaths) {
    const result = await processFile(filePath);
    results.push(result);

    // Add delay to respect rate limits (15 req/min)
    await sleep(4000); // 4 seconds = 15 req/min max
  }

  return results;
}

// ============================================================================
// Comparison Logic
// ============================================================================

/**
 * Compare extracted data from multiple files and determine marca
 */
export function comparAndMark(results: FileProcessResult[]): {
  marca: 'sobreprecio' | 'falta_datos' | 'normal';
  confidence: 'alta' | 'media' | 'baja';
  items: ExtractedItem[];
  filesProcessed: number;
} {
  // Filter successful results
  const successfulResults = results.filter(r => r.success && r.data);

  if (successfulResults.length === 0) {
    return {
      marca: 'falta_datos',
      confidence: 'baja',
      items: [],
      filesProcessed: 0,
    };
  }

  // Extract items arrays
  const itemsArrays = successfulResults.map(r => r.data!.items);

  // Check if all arrays are identical
  const allEqual = itemsArrays.every(items =>
    JSON.stringify(items) === JSON.stringify(itemsArrays[0])
  );

  // Determine marca
  let marca: 'sobreprecio' | 'falta_datos' | 'normal';
  let confidence: 'alta' | 'media' | 'baja';

  if (allEqual && itemsArrays[0].length === 1) {
    // All files agree on exactly 1 item → sobreprecio
    marca = 'sobreprecio';
    confidence = 'alta';
  } else if (!allEqual) {
    // Files disagree → falta_datos
    marca = 'falta_datos';
    confidence = successfulResults.length >= results.length * 0.7 ? 'media' : 'baja';
  } else {
    // All agree but multiple items → normal
    marca = 'normal';
    confidence = 'alta';
  }

  return {
    marca,
    confidence,
    items: itemsArrays[0], // Use first file's items
    filesProcessed: successfulResults.length,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
