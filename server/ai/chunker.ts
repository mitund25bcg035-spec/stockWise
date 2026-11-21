import crypto from 'node:crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export const SUPPORTED_DOC_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.pdf', '.docx']);

export const SUPPORTED_DOC_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream', // some browsers send generic octet-stream for .md
]);

export function getFileExtension(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx) : '';
}

export function validateDocumentUpload(input: {
  filename: string;
  mimeType?: string;
  sizeBytes: number;
}): { ok: true; extension: string } | { ok: false; error: string } {
  const ext = getFileExtension(input.filename);
  if (!SUPPORTED_DOC_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: 'Unsupported file type. Upload .txt, .md, .pdf, or .docx documents.',
    };
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, error: 'Uploaded document is empty.' };
  }
  if (input.sizeBytes > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: 'Document exceeds the 5 MB file size limit.',
    };
  }
  if (input.mimeType && !SUPPORTED_DOC_MIME_TYPES.has(input.mimeType.toLowerCase())) {
    return {
      ok: false,
      error: `MIME type "${input.mimeType}" is not permitted for knowledge base documents.`,
    };
  }
  return { ok: true, extension: ext };
}

export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function extractTextFromDocumentBuffer(
  buffer: Buffer,
  extension: string
): Promise<string> {
  const ext = extension.toLowerCase();
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    return cleanExtractedText(buffer.toString('utf8'));
  }
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return cleanExtractedText(result.text ?? '');
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return cleanExtractedText(result.value ?? '');
  }
  throw new Error(`Unsupported document extension: ${ext}`);
}

export function hashContent(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface TextChunk {
  index: number;
  content: string;
  contentHash: string;
  charCount: number;
}

/**
 * Splits cleaned document text into semantically coherent overlapping chunks
 * without breaking sentences or markdown sections unnecessarily.
 */
export function chunkText(
  rawText: string,
  options: {
    targetChars?: number;
    maxChars?: number;
    overlapChars?: number;
  } = {}
): TextChunk[] {
  const cleaned = cleanExtractedText(rawText);
  if (!cleaned) return [];

  const targetChars = Math.max(200, options.targetChars ?? 850);
  const maxChars = Math.max(targetChars, options.maxChars ?? 1200);
  const overlapChars = Math.max(0, Math.min(Math.floor(targetChars / 2), options.overlapChars ?? 140));

  // Break into paragraphs first, then split oversized paragraphs by sentence boundaries
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const units: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      units.push(para);
      continue;
    }

    const sentences = para.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [para];
    let buffer = '';
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s) continue;
      if (s.length > maxChars) {
        if (buffer) {
          units.push(buffer.trim());
          buffer = '';
        }
        // Hard slice only when a single sentence exceeds maxChars
        for (let i = 0; i < s.length; i += targetChars) {
          units.push(s.slice(i, i + targetChars).trim());
        }
        continue;
      }

      if ((buffer ? buffer.length + 1 + s.length : s.length) > targetChars) {
        if (buffer) units.push(buffer.trim());
        buffer = s;
      } else {
        buffer = buffer ? `${buffer} ${s}` : s;
      }
    }
    if (buffer.trim()) {
      units.push(buffer.trim());
    }
  }

  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= targetChars || (!current && candidate.length <= maxChars)) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      // Carry trailing sentences/words up to overlapChars so context carries across chunk boundaries
      const overlap = extractTrailingOverlap(current, overlapChars);
      current = overlap ? `${overlap}\n\n${unit}` : unit;
      if (current.length > maxChars) {
        current = unit;
      }
    } else {
      chunks.push(unit);
      current = '';
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.map((content, index) => ({
    index,
    content,
    contentHash: hashContent(content),
    charCount: content.length,
  }));
}

function extractTrailingOverlap(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return '';
  const tail = text.slice(text.length - overlapChars);
  const boundaryIdx = tail.search(/[.!?]\s+|\n+/);
  if (boundaryIdx >= 0 && boundaryIdx < tail.length - 20) {
    return tail.slice(boundaryIdx + 1).trim();
  }
  const spaceIdx = tail.indexOf(' ');
  return spaceIdx >= 0 ? tail.slice(spaceIdx + 1).trim() : tail.trim();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
