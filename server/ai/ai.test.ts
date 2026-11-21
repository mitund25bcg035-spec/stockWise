import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../db.ts';
import {
  EMBEDDING_DIMENSIONS,
  GeminiServiceError,
  generateEmbeddingsBatch,
  generateGeminiGroundedAnswer,
  type GeminiClientLike,
} from './gemini.ts';
import {
  chunkText,
  cleanExtractedText,
  cosineSimilarity,
  extractTextFromDocumentBuffer,
  validateDocumentUpload,
} from './chunker.ts';
import { SAMPLE_KNOWLEDGE_DOCUMENTS } from './knowledgeSeed.ts';
import { fetchAuthorizedLiveContext } from './liveData.ts';
import {
  createOrUpdateDocumentRecord,
  deleteConversation,
  deleteDocumentRecord,
  ingestDocument,
  listMessagesForConversation,
  searchRelevantChunks,
} from './store.ts';
import {
  buildGroundedSystemInstruction,
  buildGroundedUserPrompt,
  checkChatRateLimit,
  resetRateLimiterForTests,
  runStockWiseRagChat,
} from './ragPipeline.ts';

function makeTopicVector(text: string): number[] {
  const lower = text.toLowerCase();
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  // Orthogonal dimensions for deterministic semantic simulation
  if (lower.includes('refund') || lower.includes('cancel') || lower.includes('invoice')) vec[0] += 1;
  if (lower.includes('purchase') || lower.includes('receive') || lower.includes('supplier')) vec[1] += 1;
  if (lower.includes('valuation') || lower.includes('inventory') || lower.includes('stock')) vec[2] += 1;
  if (lower.includes('astronomy') || lower.includes('galaxies') || lower.includes('mars')) vec[3] += 1;
  if (vec[0] === 0 && vec[1] === 0 && vec[2] === 0 && vec[3] === 0) {
    vec[4] = 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vec.map((v) => v / norm) : vec;
}

function createMockGeminiClient(replyText = '**Grounded Answer**: StockWise valuation multiplies on-hand quantity by unit purchase cost.'): GeminiClientLike {
  return {
    models: {
      generateContent: async () => ({ text: replyText }),
      embedContent: async (params: unknown) => {
        const p = params as { contents: string[] };
        return {
          embeddings: p.contents.map((txt) => ({ values: makeTopicVector(txt) })),
        };
      },
    },
  };
}

test('chunker: validates file extensions, empty files, and 5 MB limit', () => {
  assert.equal(validateDocumentUpload({ filename: 'manual.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }).ok, true);
  assert.equal(validateDocumentUpload({ filename: 'guide.md', mimeType: 'text/markdown', sizeBytes: 500 }).ok, true);
  assert.equal(validateDocumentUpload({ filename: 'policy.docx', sizeBytes: 2048 }).ok, true);

  const badExt = validateDocumentUpload({ filename: 'script.exe', sizeBytes: 100 });
  assert.equal(badExt.ok, false);

  const empty = validateDocumentUpload({ filename: 'empty.txt', sizeBytes: 0 });
  assert.equal(empty.ok, false);

  const huge = validateDocumentUpload({ filename: 'huge.pdf', sizeBytes: 6 * 1024 * 1024 });
  assert.equal(huge.ok, false);
});

test('chunker: cleans text, extracts markdown buffer, and builds overlapping chunks', async () => {
  const raw = 'First paragraph about StockWise.\r\n\r\n\u0000' + 'Sentence one explains FIFO valuation. '.repeat(35);
  const extracted = await extractTextFromDocumentBuffer(Buffer.from(raw, 'utf8'), '.md');
  assert.ok(!extracted.includes('\u0000'));
  assert.ok(!extracted.includes('\r'));

  const chunks = chunkText(extracted, { targetChars: 350, maxChars: 500, overlapChars: 80 });
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[1].index, 1);
  assert.ok(chunks[0].contentHash.length === 64);
});

test('chunker: cosineSimilarity handles identical, orthogonal, and opposite vectors', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0]) - 0) < 1e-6);
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [-1, 0, 0]) + 1) < 1e-6);
});

test('gemini: handles missing key, invalid key without retry, and 429 retry recovery', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = '';
    await assert.rejects(
      () =>
        generateGeminiGroundedAnswer({
          systemInstruction: 'test',
          userPrompt: 'hello',
        }),
      (err: unknown) => err instanceof GeminiServiceError && err.code === 'MISSING_KEY' && err.statusCode === 503
    );

    let invalidCalls = 0;
    const invalidClient: GeminiClientLike = {
      models: {
        generateContent: async () => {
          invalidCalls++;
          const e = new Error('API_KEY_INVALID') as Error & { status?: number };
          e.status = 400;
          throw e;
        },
        embedContent: async () => ({ embeddings: [] }),
      },
    };
    await assert.rejects(
      () =>
        generateGeminiGroundedAnswer(
          { systemInstruction: 'test', userPrompt: 'hello' },
          { client: invalidClient, sleep: async () => undefined }
        ),
      (err: unknown) => err instanceof GeminiServiceError && err.code === 'INVALID_KEY'
    );
    assert.equal(invalidCalls, 1);

    let rateCalls = 0;
    const retryClient: GeminiClientLike = {
      models: {
        generateContent: async () => {
          rateCalls++;
          if (rateCalls < 2) {
            const e = new Error('RESOURCE_EXHAUSTED') as Error & { status?: number };
            e.status = 429;
            throw e;
          }
          return { text: 'Recovered after rate limit backoff.' };
        },
        embedContent: async () => ({ embeddings: [] }),
      },
    };
    const recovered = await generateGeminiGroundedAnswer(
      { systemInstruction: 'test', userPrompt: 'hello' },
      { client: retryClient, sleep: async () => undefined }
    );
    assert.equal(rateCalls, 2);
    assert.equal(recovered.text, 'Recovered after rate limit backoff.');
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test('gemini: generateEmbeddingsBatch batches by 20 and validates 768 dimensions', async () => {
  const inputs = Array.from({ length: 23 }, (_, idx) => `inventory item ${idx}`);
  let batchCalls = 0;
  const mockClient: GeminiClientLike = {
    models: {
      generateContent: async () => ({ text: 'ok' }),
      embedContent: async (params: unknown) => {
        batchCalls++;
        const p = params as { contents: string[] };
        return {
          embeddings: p.contents.map((txt) => ({ values: makeTopicVector(txt) })),
        };
      },
    },
  };
  const res = await generateEmbeddingsBatch(inputs, { client: mockClient });
  assert.equal(batchCalls, 2);
  assert.equal(res.embeddings.length, 23);
  assert.equal(res.embeddings[0].length, EMBEDDING_DIMENSIONS);
});

test('knowledgeSeed: contains 8 core guides including 32 Q&As in FAQ', () => {
  assert.equal(SAMPLE_KNOWLEDGE_DOCUMENTS.length, 8);
  const faq = SAMPLE_KNOWLEDGE_DOCUMENTS.find((d) => d.documentType === 'faq');
  assert.ok(faq);
  const questionMatches = faq.content.match(/\n\d+\.\s+Q:/g) ?? [];
  assert.ok(questionMatches.length >= 32, `Expected >= 32 FAQ entries, found ${questionMatches.length}`);
});

test('ragPipeline: prompt injection boundary & rate limiter behavior', () => {
  const sys = buildGroundedSystemInstruction('concise');
  assert.ok(sys.includes('untrusted reference text'));
  assert.ok(sys.includes('Live Business Data'));

  const prompt = buildGroundedUserPrompt({
    question: 'What is our stock valuation rule?',
    liveContextText: 'Authorized workspace inventory valuation: USD 12,400.00',
    retrievedChunks: [],
  });
  assert.ok(prompt.includes('<live_business_data>'));
  assert.ok(prompt.includes('<documentation_excerpts>'));

  resetRateLimiterForTests();
  const baseNow = 1_000_000;
  for (let i = 0; i < 20; i++) {
    assert.equal(checkChatRateLimit(777, baseNow + i * 10).allowed, true);
  }
  const blocked = checkChatRateLimit(777, baseNow + 500);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  resetRateLimiterForTests();
});

test('end-to-end mocked RAG pipeline: ingestion, retrieval threshold, business isolation, live data & history', async () => {
  const testBizA = 99991;
  const testBizB = 99992;
  const testUserEmail = `ragtest-${Date.now()}@example.com`;
  let testUserId = 0;
  let docAId = '';
  let docBId = '';
  let convId = '';

  const mockClient = createMockGeminiClient(
    '**Live Business Data**: Currently 1 product (`TEST-SKU-1`, 4 units, below min stock 10).\n\n**Documentation**: Inventory value uses on-hand quantity multiplied by purchase price.'
  );

  try {
    db.prepare(
      `INSERT OR REPLACE INTO businesses (id, name, currency, tax_rate) VALUES (?, 'Test Biz A', 'USD', 8.5)`
    ).run(testBizA);
    db.prepare(
      `INSERT OR REPLACE INTO businesses (id, name, currency, tax_rate) VALUES (?, 'Test Biz B', 'EUR', 10)`
    ).run(testBizB);

    const userInsert = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, permissions, active)
         VALUES ('RAG Tester', ?, 'hash', 'admin', '{}', 1)`
      )
      .run(testUserEmail);
    testUserId = Number(userInsert.lastInsertRowid);

    db.prepare(
      `INSERT INTO products (business_id, name, sku, purchase_price, selling_price, quantity, min_stock, status)
       VALUES (?, 'Isolation Probe Sensor', 'TEST-SKU-1', 25, 60, 4, 10, 'active')`
    ).run(testBizA);

    const docA = await createOrUpdateDocumentRecord({
      businessId: testBizA,
      title: 'Test Biz A Valuation & Refund Policy',
      description: 'Test guide for valuation and refunds',
      documentType: 'policy',
      source: 'test_seed',
      rawContent: cleanExtractedText(
        'Inventory valuation multiplies on-hand stock quantity by unit purchase price. Refunds restore stock.'
      ),
    });
    docAId = docA.id;

    const ingA = await ingestDocument(testBizA, docAId, { client: mockClient });
    assert.equal(ingA.status, 'processed');
    assert.ok(ingA.chunkCount >= 1);

    // Repeat ingestion with unchanged hash skips Gemini embedding calls cleanly
    const ingSkip = await ingestDocument(testBizA, docAId, { client: mockClient });
    assert.equal(ingSkip.status, 'skipped');

    // Business B document should remain isolated from Business A searches
    const docB = await createOrUpdateDocumentRecord({
      businessId: testBizB,
      title: 'Secret Biz B Purchase Manual',
      description: 'Private doc for Biz B',
      documentType: 'manual',
      source: 'test_seed',
      rawContent: 'Purchase order receiving workflow strictly for Business B.',
    });
    docBId = docB.id;
    await ingestDocument(testBizB, docBId, { client: mockClient });

    // 1. Live business isolation check
    const liveA = fetchAuthorizedLiveContext(testBizA, 'Which products are low in stock?');
    assert.ok(liveA.contextText.includes('TEST-SKU-1'));

    const liveB = fetchAuthorizedLiveContext(testBizB, 'Which products are low in stock?');
    assert.ok(!liveB.contextText.includes('TEST-SKU-1'));

    // 2. Vector retrieval isolation & similarity threshold filtering
    const irrelevantHits = await searchRelevantChunks({
      businessId: testBizA,
      queryEmbedding: makeTopicVector('astronomy galaxies mars'),
      similarityThreshold: 0.35,
      topK: 5,
    });
    assert.equal(irrelevantHits.length, 0);

    const relevantHitsA = await searchRelevantChunks({
      businessId: testBizA,
      queryEmbedding: makeTopicVector('inventory valuation rule'),
      similarityThreshold: 0.35,
      topK: 5,
    });
    assert.equal(relevantHitsA.length, 1);
    assert.equal(relevantHitsA[0].documentId, docAId);

    // 3. Full RAG chat execution + conversation persistence
    const chatRes = await runStockWiseRagChat(
      {
        userId: testUserId,
        businessId: testBizA,
        message: 'Which products are low in stock and how is inventory valuation calculated?',
        detailMode: 'concise',
      },
      { geminiClient: mockClient }
    );
    convId = chatRes.conversation.id;
    assert.ok(chatRes.assistantMessage.content.includes('TEST-SKU-1'));
    assert.ok(chatRes.sources.some((s) => s.kind === 'live_data'));
    assert.ok(chatRes.sources.some((s) => s.kind === 'documentation' && s.title.includes('Test Biz A')));
    assert.ok(chatRes.suggestedLinks.some((l) => l.module === 'inventory'));

    // Business B cannot read Business A's conversation
    assert.equal(listMessagesForConversation(convId, testUserId, testBizB), null);
    const msgsA = listMessagesForConversation(convId, testUserId, testBizA);
    assert.equal(msgsA?.length, 2);

    // Unused crypto import guard check
    assert.ok(crypto.randomUUID().length > 10);
  } finally {
    if (convId) {
      await deleteConversation(convId, testUserId, testBizA).catch(() => undefined);
    }
    if (docAId) await deleteDocumentRecord(testBizA, docAId).catch(() => undefined);
    if (docBId) await deleteDocumentRecord(testBizB, docBId).catch(() => undefined);
    if (testUserId) {
      db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    }
    db.prepare('DELETE FROM products WHERE business_id IN (?, ?)').run(testBizA, testBizB);
    db.prepare('DELETE FROM businesses WHERE id IN (?, ?)').run(testBizA, testBizB);
  }
});
