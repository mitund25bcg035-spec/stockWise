import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db.ts';
import {
  chunkText,
  cleanExtractedText,
  cosineSimilarity,
  hashContent,
} from './chunker.ts';
import {
  generateEmbeddingsBatch,
  getConfiguredEmbeddingModel,
  isGeminiConfigured,
  type GeminiClientLike,
} from './gemini.ts';
import { SAMPLE_KNOWLEDGE_DOCUMENTS } from './knowledgeSeed.ts';

export type DocumentType = 'manual' | 'guide' | 'policy' | 'faq' | 'upload' | 'other';
export type DocumentStatus = 'pending' | 'processing' | 'processed' | 'failed';

export interface AiDocumentRecord {
  id: string;
  businessId: number;
  title: string;
  description: string;
  documentType: DocumentType;
  source: string;
  sourceKey: string;
  storagePath: string;
  status: DocumentStatus;
  chunkCount: number;
  latestJobStatus: string | null;
  latestJobError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rawContent?: string;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  source: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface AiConversationRecord {
  id: string;
  userId: number;
  businessId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessageRecord {
  id: string;
  conversationId: string;
  userId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const SUPABASE_BUCKET = 'stockwise-documents';

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_URL.trim().length > 0 &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim().length > 0
  );
}

let cachedSupabase: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!cachedSupabase) {
    cachedSupabase = createClient(
      process.env.SUPABASE_URL!.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return cachedSupabase;
}

// Deterministic UUID mapping so local integer business/user IDs work cleanly with Supabase UUID columns
export function toDeterministicUuid(namespace: 'biz' | 'usr', numericId: number): string {
  const hash = crypto.createHash('sha256').update(`stockwise:${namespace}:${numericId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

export async function uploadRawFileToStorage(params: {
  businessId: number;
  documentId: string;
  filename: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  const sb = getSupabaseAdmin();
  const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `${params.businessId}/${params.documentId}/${safeName}`;
  if (!sb) {
    return `local-upload://${objectPath}`;
  }
  const { error } = await sb.storage.from(SUPABASE_BUCKET).upload(objectPath, params.buffer, {
    contentType: params.contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }
  return objectPath;
}

export async function deleteStorageObject(storagePath: string): Promise<void> {
  if (!storagePath || storagePath.startsWith('local-upload://')) return;
  const sb = getSupabaseAdmin();
  if (!sb) return;
  await sb.storage.from(SUPABASE_BUCKET).remove([storagePath]).catch(() => undefined);
}

export function listDocuments(businessId: number, search = ''): AiDocumentRecord[] {
  const q = search.trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM ai_document_chunks c WHERE c.document_id = d.id) as chunk_count,
              (SELECT j.status FROM ai_ingestion_jobs j WHERE j.document_id = d.id ORDER BY j.created_at DESC LIMIT 1) as latest_job_status,
              (SELECT j.error_message FROM ai_ingestion_jobs j WHERE j.document_id = d.id ORDER BY j.created_at DESC LIMIT 1) as latest_job_error
       FROM ai_documents d
       WHERE d.business_id = ?
       ORDER BY d.updated_at DESC, d.created_at DESC`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  return rows
    .filter((r) => {
      if (!q) return true;
      return (
        String(r.title).toLowerCase().includes(q) ||
        String(r.description).toLowerCase().includes(q) ||
        String(r.source).toLowerCase().includes(q) ||
        String(r.document_type).toLowerCase().includes(q)
      );
    })
    .map((r) => ({
      id: String(r.id),
      businessId: Number(r.business_id),
      title: String(r.title),
      description: String(r.description ?? ''),
      documentType: String(r.document_type) as DocumentType,
      source: String(r.source ?? ''),
      sourceKey: String(r.source_key ?? ''),
      storagePath: String(r.storage_path ?? ''),
      status: String(r.status) as DocumentStatus,
      chunkCount: Number(r.chunk_count ?? 0),
      latestJobStatus: r.latest_job_status ? String(r.latest_job_status) : null,
      latestJobError: r.latest_job_error ? String(r.latest_job_error) : null,
      metadata: safeParseJson(String(r.metadata ?? '{}')),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
}

export function getDocumentById(businessId: number, documentId: string): AiDocumentRecord | null {
  const row = db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM ai_document_chunks c WHERE c.document_id = d.id) as chunk_count,
              (SELECT j.status FROM ai_ingestion_jobs j WHERE j.document_id = d.id ORDER BY j.created_at DESC LIMIT 1) as latest_job_status,
              (SELECT j.error_message FROM ai_ingestion_jobs j WHERE j.document_id = d.id ORDER BY j.created_at DESC LIMIT 1) as latest_job_error
       FROM ai_documents d
       WHERE d.id = ? AND d.business_id = ?`
    )
    .get(documentId, businessId) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    id: String(row.id),
    businessId: Number(row.business_id),
    title: String(row.title),
    description: String(row.description ?? ''),
    documentType: String(row.document_type) as DocumentType,
    source: String(row.source ?? ''),
    sourceKey: String(row.source_key ?? ''),
    storagePath: String(row.storage_path ?? ''),
    status: String(row.status) as DocumentStatus,
    chunkCount: Number(row.chunk_count ?? 0),
    latestJobStatus: row.latest_job_status ? String(row.latest_job_status) : null,
    latestJobError: row.latest_job_error ? String(row.latest_job_error) : null,
    metadata: safeParseJson(String(row.metadata ?? '{}')),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    rawContent: String(row.raw_content ?? ''),
  };
}

export function getDocumentChunks(businessId: number, documentId: string) {
  const rows = db
    .prepare(
      `SELECT id, chunk_index, content, embedding_model, metadata, created_at
       FROM ai_document_chunks
       WHERE business_id = ? AND document_id = ?
       ORDER BY chunk_index ASC`
    )
    .all(businessId, documentId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    chunkIndex: Number(r.chunk_index),
    content: String(r.content),
    embeddingModel: String(r.embedding_model ?? ''),
    metadata: safeParseJson(String(r.metadata ?? '{}')),
    createdAt: String(r.created_at),
  }));
}

export async function createOrUpdateDocumentRecord(params: {
  businessId: number;
  id?: string;
  title: string;
  description: string;
  documentType: DocumentType;
  source: string;
  sourceKey?: string;
  storagePath?: string;
  rawContent: string;
  metadata?: Record<string, unknown>;
}): Promise<AiDocumentRecord> {
  const cleaned = cleanExtractedText(params.rawContent);
  const contentHash = hashContent(cleaned);
  const docId = params.id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT id, content_hash, status FROM ai_documents WHERE id = ? AND business_id = ?')
    .get(docId, params.businessId) as { id?: string; content_hash?: string; status?: string } | undefined;

  if (existing?.id) {
    const contentChanged = existing.content_hash !== contentHash;
    db.prepare(
      `UPDATE ai_documents
       SET title = ?, description = ?, document_type = ?, source = ?, storage_path = COALESCE(NULLIF(?, ''), storage_path),
           raw_content = ?, content_hash = ?, status = ?, metadata = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`
    ).run(
      params.title,
      params.description,
      params.documentType,
      params.source,
      params.storagePath ?? '',
      cleaned,
      contentHash,
      contentChanged ? 'pending' : existing.status ?? 'pending',
      JSON.stringify(params.metadata ?? {}),
      now,
      docId,
      params.businessId
    );
  } else {
    db.prepare(
      `INSERT INTO ai_documents
        (id, business_id, title, description, document_type, source, source_key, storage_path, raw_content, content_hash, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(
      docId,
      params.businessId,
      params.title,
      params.description,
      params.documentType,
      params.source,
      params.sourceKey ?? '',
      params.storagePath ?? '',
      cleaned,
      contentHash,
      JSON.stringify({ ...(params.metadata ?? {}), sourceKey: params.sourceKey ?? undefined }),
      now,
      now
    );
  }

  // Mirror to Supabase PostgreSQL if configured
  const sb = getSupabaseAdmin();
  if (sb) {
    const bizUuid = toDeterministicUuid('biz', params.businessId);
    await sb.from('ai_documents').upsert({
      id: docId,
      business_id: bizUuid,
      title: params.title,
      description: params.description,
      document_type: params.documentType,
      source: params.source,
      storage_path: params.storagePath ?? null,
      status: 'pending',
      metadata: {
        ...(params.metadata ?? {}),
        sourceKey: params.sourceKey || undefined,
        contentHash,
      },
      updated_at: now,
    });
  }

  return getDocumentById(params.businessId, docId)!;
}

export async function ingestDocument(
  businessId: number,
  documentId: string,
  options: {
    force?: boolean;
    client?: GeminiClientLike;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<{ status: 'processed' | 'skipped' | 'failed'; chunkCount: number; errorMessage?: string }> {
  const doc = getDocumentById(businessId, documentId);
  if (!doc) {
    throw new Error('Document not found.');
  }

  const rawText = cleanExtractedText(doc.rawContent ?? '');
  if (!rawText) {
    throw new Error('Document has no extractable text.');
  }

  const embeddingModel = getConfiguredEmbeddingModel();
  const contentHash = hashContent(rawText);

  // Skip regenerating embeddings when document is already processed with unchanged content and model
  if (!options.force && doc.status === 'processed' && doc.chunkCount > 0) {
    const existingChunk = db
      .prepare('SELECT embedding_model FROM ai_document_chunks WHERE document_id = ? LIMIT 1')
      .get(documentId) as { embedding_model?: string } | undefined;
    const storedHashRow = db
      .prepare('SELECT content_hash FROM ai_documents WHERE id = ?')
      .get(documentId) as { content_hash?: string } | undefined;
    if (
      storedHashRow?.content_hash === contentHash &&
      existingChunk?.embedding_model === embeddingModel
    ) {
      return { status: 'skipped', chunkCount: doc.chunkCount };
    }
  }

  const jobId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_ingestion_jobs (id, document_id, business_id, status, error_message, processed_chunks, created_at)
     VALUES (?, ?, ?, 'processing', '', 0, ?)`
  ).run(jobId, documentId, businessId, startedAt);

  db.prepare("UPDATE ai_documents SET status = 'processing', updated_at = ? WHERE id = ?").run(
    startedAt,
    documentId
  );

  const sb = getSupabaseAdmin();
  const bizUuid = toDeterministicUuid('biz', businessId);
  if (sb) {
    await sb.from('ai_ingestion_jobs').insert({
      id: jobId,
      document_id: documentId,
      business_id: bizUuid,
      status: 'processing',
      processed_chunks: 0,
      created_at: startedAt,
    });
    await sb.from('ai_documents').update({ status: 'processing', updated_at: startedAt }).eq('id', documentId);
  }

  try {
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      throw new Error('Chunking produced 0 text chunks.');
    }

    // Reuse existing embeddings for any identical chunk hashes when available
    const existingChunkRows = db
      .prepare(
        'SELECT content_hash, embedding, embedding_model FROM ai_document_chunks WHERE document_id = ?'
      )
      .all(documentId) as Array<{ content_hash: string; embedding: string; embedding_model: string }>;

    const reusableMap = new Map<string, number[]>();
    for (const row of existingChunkRows) {
      if (row.embedding_model === embeddingModel && row.embedding) {
        try {
          const vec = JSON.parse(row.embedding) as number[];
          if (Array.isArray(vec) && vec.length > 0) {
            reusableMap.set(row.content_hash, vec);
          }
        } catch {
          // ignore malformed cached vector
        }
      }
    }

    const toEmbedIndexes: number[] = [];
    const toEmbedTexts: string[] = [];
    const chunkVectors: Array<number[] | null> = chunks.map((chunk, idx) => {
      const cached = !options.force ? reusableMap.get(chunk.contentHash) : undefined;
      if (cached) return cached;
      toEmbedIndexes.push(idx);
      toEmbedTexts.push(`${doc.title}\n\n${chunk.content}`);
      return null;
    });

    if (toEmbedTexts.length > 0) {
      const { embeddings } = await generateEmbeddingsBatch(toEmbedTexts, {
        client: options.client,
        sleep: options.sleep,
      });
      toEmbedIndexes.forEach((chunkIdx, i) => {
        chunkVectors[chunkIdx] = embeddings[i];
      });
    }

    const completedAt = new Date().toISOString();

    // Atomically replace chunks in SQLite
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM ai_document_chunks WHERE document_id = ?').run(documentId);
      const insertChunk = db.prepare(
        `INSERT INTO ai_document_chunks
          (id, document_id, business_id, chunk_index, content, content_hash, embedding, embedding_model, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const supabaseChunksPayload: Array<Record<string, unknown>> = [];
      for (let i = 0; i < chunks.length; i++) {
        const ch = chunks[i];
        const vec = chunkVectors[i] ?? [];
        const chunkId = crypto.randomUUID();
        const meta = {
          documentTitle: doc.title,
          documentType: doc.documentType,
          source: doc.source,
          charCount: ch.charCount,
          embeddingModel,
        };
        insertChunk.run(
          chunkId,
          documentId,
          businessId,
          ch.index,
          ch.content,
          ch.contentHash,
          JSON.stringify(vec),
          embeddingModel,
          JSON.stringify(meta),
          completedAt
        );
        supabaseChunksPayload.push({
          id: chunkId,
          document_id: documentId,
          business_id: bizUuid,
          chunk_index: ch.index,
          content: ch.content,
          embedding: `[${vec.join(',')}]`,
          metadata: meta,
          created_at: completedAt,
        });
      }

      db.prepare(
        "UPDATE ai_documents SET status = 'processed', content_hash = ?, updated_at = ? WHERE id = ?"
      ).run(contentHash, completedAt, documentId);

      db.prepare(
        `UPDATE ai_ingestion_jobs
         SET status = 'completed', processed_chunks = ?, completed_at = ?
         WHERE id = ?`
      ).run(chunks.length, completedAt, jobId);

      db.exec('COMMIT');

      if (sb) {
        await sb.from('ai_document_chunks').delete().eq('document_id', documentId);
        const { error: chunkErr } = await sb.from('ai_document_chunks').insert(supabaseChunksPayload);
        if (chunkErr) throw new Error(`Supabase chunk insert error: ${chunkErr.message}`);
        await sb
          .from('ai_documents')
          .update({ status: 'processed', updated_at: completedAt })
          .eq('id', documentId);
        await sb
          .from('ai_ingestion_jobs')
          .update({ status: 'completed', processed_chunks: chunks.length, completed_at: completedAt })
          .eq('id', jobId);
      }
    } catch (innerErr) {
      db.exec('ROLLBACK');
      throw innerErr;
    }

    return { status: 'processed', chunkCount: chunks.length };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Document ingestion failed.';
    const failedAt = new Date().toISOString();

    db.prepare("UPDATE ai_documents SET status = 'failed', updated_at = ? WHERE id = ?").run(
      failedAt,
      documentId
    );
    db.prepare(
      `UPDATE ai_ingestion_jobs
       SET status = 'failed', error_message = ?, completed_at = ?
       WHERE id = ?`
    ).run(errMsg, failedAt, jobId);

    if (sb) {
      await sb.from('ai_documents').update({ status: 'failed', updated_at: failedAt }).eq('id', documentId);
      await sb
        .from('ai_ingestion_jobs')
        .update({ status: 'failed', error_message: errMsg, completed_at: failedAt })
        .eq('id', jobId);
    }

    return { status: 'failed', chunkCount: 0, errorMessage: errMsg };
  }
}

export async function deleteDocumentRecord(businessId: number, documentId: string): Promise<boolean> {
  const existing = getDocumentById(businessId, documentId);
  if (!existing) return false;

  await deleteStorageObject(existing.storagePath);
  db.prepare('DELETE FROM ai_documents WHERE id = ? AND business_id = ?').run(documentId, businessId);

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from('ai_documents').delete().eq('id', documentId).eq('business_id', toDeterministicUuid('biz', businessId));
  }
  return true;
}

export async function searchRelevantChunks(params: {
  businessId: number;
  queryEmbedding: number[];
  similarityThreshold?: number;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const threshold = params.similarityThreshold ?? 0.35;
  const topK = Math.max(1, Math.min(20, params.topK ?? 6));

  const sb = getSupabaseAdmin();
  if (sb) {
    const bizUuid = toDeterministicUuid('biz', params.businessId);
    const { data, error } = await sb.rpc('match_ai_documents', {
      query_embedding: `[${params.queryEmbedding.join(',')}]`,
      filter_business_id: bizUuid,
      similarity_threshold: threshold,
      match_count: topK,
    });
    if (!error && Array.isArray(data)) {
      return data.map((row: Record<string, unknown>) => ({
        chunkId: String(row.chunk_id),
        documentId: String(row.document_id),
        documentTitle: String(row.document_title),
        documentType: String(row.document_type),
        source: String(row.source),
        chunkIndex: Number(row.chunk_index),
        content: String(row.content),
        similarity: Number(row.similarity),
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      }));
    }
  }

  // Local SQLite vector search scoped strictly to authorized businessId & processed docs
  const rows = db
    .prepare(
      `SELECT c.id as chunk_id, c.document_id, c.chunk_index, c.content, c.embedding, c.metadata,
              d.title as document_title, d.document_type, d.source
       FROM ai_document_chunks c
       JOIN ai_documents d ON d.id = c.document_id
       WHERE c.business_id = ?
         AND d.business_id = ?
         AND d.status = 'processed'`
    )
    .all(params.businessId, params.businessId) as Array<Record<string, unknown>>;

  const scored: RetrievedChunk[] = [];
  for (const r of rows) {
    let vec: number[] = [];
    try {
      vec = JSON.parse(String(r.embedding ?? '[]')) as number[];
    } catch {
      vec = [];
    }
    if (!Array.isArray(vec) || vec.length === 0) continue;
    const similarity = cosineSimilarity(params.queryEmbedding, vec);
    if (similarity >= threshold) {
      scored.push({
        chunkId: String(r.chunk_id),
        documentId: String(r.document_id),
        documentTitle: String(r.document_title),
        documentType: String(r.document_type),
        source: String(r.source),
        chunkIndex: Number(r.chunk_index),
        content: String(r.content),
        similarity,
        metadata: safeParseJson(String(r.metadata ?? '{}')),
      });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

/**
 * Repeatable, idempotent sample documentation seed for a business workspace.
 * Never creates duplicate rows on repeated runs, and runs ingestion when Gemini is configured.
 */
export async function seedSampleKnowledgeBase(
  businessId: number,
  options: { embedImmediately?: boolean } = {}
): Promise<{
  createdCount: number;
  existingCount: number;
  processedCount: number;
  failedCount: number;
  geminiConfigured: boolean;
}> {
  let createdCount = 0;
  let existingCount = 0;
  let processedCount = 0;
  let failedCount = 0;
  const shouldEmbed = options.embedImmediately ?? isGeminiConfigured();

  const docIdsToIngest: string[] = [];

  for (const sample of SAMPLE_KNOWLEDGE_DOCUMENTS) {
    const existing = db
      .prepare('SELECT id, status FROM ai_documents WHERE business_id = ? AND source_key = ?')
      .get(businessId, sample.sourceKey) as { id?: string; status?: string } | undefined;

    if (existing?.id) {
      existingCount++;
      if (existing.status !== 'processed' && shouldEmbed) {
        docIdsToIngest.push(existing.id);
      }
      continue;
    }

    const created = await createOrUpdateDocumentRecord({
      businessId,
      title: sample.title,
      description: sample.description,
      documentType: sample.documentType,
      source: 'sample_documentation',
      sourceKey: sample.sourceKey,
      rawContent: sample.content,
      metadata: {
        isSampleDocumentation: true,
        sourceKey: sample.sourceKey,
      },
    });
    createdCount++;
    if (shouldEmbed) {
      docIdsToIngest.push(created.id);
    }
  }

  for (const docId of docIdsToIngest) {
    const res = await ingestDocument(businessId, docId);
    if (res.status === 'processed' || res.status === 'skipped') processedCount++;
    else failedCount++;
  }

  return {
    createdCount,
    existingCount,
    processedCount,
    failedCount,
    geminiConfigured: isGeminiConfigured(),
  };
}

// ==================== CONVERSATIONS & MESSAGES ====================
export function listConversations(userId: number, businessId: number): AiConversationRecord[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, business_id, title, created_at, updated_at
       FROM ai_conversations
       WHERE user_id = ? AND business_id = ?
       ORDER BY updated_at DESC`
    )
    .all(userId, businessId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    userId: Number(r.user_id),
    businessId: Number(r.business_id),
    title: String(r.title),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export async function createConversation(
  userId: number,
  businessId: number,
  title = 'New Conversation'
): Promise<AiConversationRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cleanTitle = title.trim().slice(0, 120) || 'New Conversation';

  db.prepare(
    `INSERT INTO ai_conversations (id, user_id, business_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, businessId, cleanTitle, now, now);

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from('ai_conversations').insert({
      id,
      user_id: toDeterministicUuid('usr', userId),
      business_id: toDeterministicUuid('biz', businessId),
      title: cleanTitle,
      created_at: now,
      updated_at: now,
    });
  }

  return {
    id,
    userId,
    businessId,
    title: cleanTitle,
    createdAt: now,
    updatedAt: now,
  };
}

export function getConversationForUser(
  conversationId: string,
  userId: number,
  businessId: number
): AiConversationRecord | null {
  const r = db
    .prepare(
      `SELECT id, user_id, business_id, title, created_at, updated_at
       FROM ai_conversations
       WHERE id = ? AND user_id = ? AND business_id = ?`
    )
    .get(conversationId, userId, businessId) as Record<string, unknown> | undefined;

  if (!r) return null;
  return {
    id: String(r.id),
    userId: Number(r.user_id),
    businessId: Number(r.business_id),
    title: String(r.title),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function renameConversation(
  conversationId: string,
  userId: number,
  businessId: number,
  title: string
): Promise<AiConversationRecord | null> {
  const existing = getConversationForUser(conversationId, userId, businessId);
  if (!existing) return null;
  const cleanTitle = title.trim().slice(0, 120);
  if (!cleanTitle) return existing;
  const now = new Date().toISOString();

  db.prepare('UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    cleanTitle,
    now,
    conversationId,
    userId
  );

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb
      .from('ai_conversations')
      .update({ title: cleanTitle, updated_at: now })
      .eq('id', conversationId)
      .eq('user_id', toDeterministicUuid('usr', userId));
  }

  return { ...existing, title: cleanTitle, updatedAt: now };
}

export async function deleteConversation(
  conversationId: string,
  userId: number,
  businessId: number
): Promise<boolean> {
  const existing = getConversationForUser(conversationId, userId, businessId);
  if (!existing) return false;
  db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ? AND business_id = ?').run(
    conversationId,
    userId,
    businessId
  );
  const sb = getSupabaseAdmin();
  if (sb) {
    await sb
      .from('ai_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', toDeterministicUuid('usr', userId));
  }
  return true;
}

export function listMessagesForConversation(
  conversationId: string,
  userId: number,
  businessId: number
): AiMessageRecord[] | null {
  const conv = getConversationForUser(conversationId, userId, businessId);
  if (!conv) return null;

  const rows = db
    .prepare(
      `SELECT id, conversation_id, user_id, role, content, metadata, created_at
       FROM ai_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(conversationId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    conversationId: String(r.conversation_id),
    userId: Number(r.user_id),
    role: String(r.role) as 'user' | 'assistant' | 'system',
    content: String(r.content),
    metadata: safeParseJson(String(r.metadata ?? '{}')),
    createdAt: String(r.created_at),
  }));
}

export async function appendConversationMessage(params: {
  conversationId: string;
  userId: number;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<AiMessageRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const meta = params.metadata ?? {};

  db.prepare(
    `INSERT INTO ai_messages (id, conversation_id, user_id, role, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, params.conversationId, params.userId, params.role, params.content, JSON.stringify(meta), now);

  db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(now, params.conversationId);

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from('ai_messages').insert({
      id,
      conversation_id: params.conversationId,
      user_id: toDeterministicUuid('usr', params.userId),
      role: params.role,
      content: params.content,
      metadata: meta,
      created_at: now,
    });
    await sb.from('ai_conversations').update({ updated_at: now }).eq('id', params.conversationId);
  }

  return {
    id,
    conversationId: params.conversationId,
    userId: params.userId,
    role: params.role,
    content: params.content,
    metadata: meta,
    createdAt: now,
  };
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
