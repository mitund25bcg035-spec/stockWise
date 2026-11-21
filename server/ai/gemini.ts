import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export const EMBEDDING_DIMENSIONS = 768;

export type GeminiErrorCode =
  | 'MISSING_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'UNAVAILABLE'
  | 'BAD_RESPONSE';

export class GeminiServiceError extends Error {
  code: GeminiErrorCode;
  statusCode: number;

  constructor(message: string, code: GeminiErrorCode, statusCode = 503) {
    super(message);
    this.name = 'GeminiServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function getConfiguredChatModel(): string {
  const raw = (process.env.GEMINI_CHAT_MODEL || '').trim();
  return raw || 'gemini-4-hydrogen';
}

export function getConfiguredEmbeddingModel(): string {
  const raw = (process.env.GEMINI_EMBEDDING_MODEL || '').trim();
  return raw || 'gemini-embedding-2';
}

function getCleanGeminiApiKey(): string {
  const raw = (process.env.GEMINI_API_KEY || '').trim();
  if (!raw || raw === 'MY_GEMINI_API_KEY' || raw === 'YOUR_GEMINI_API_KEY') {
    return '';
  }
  return raw;
}

export function isGeminiConfigured(): boolean {
  return getCleanGeminiApiKey().length > 0;
}

export interface GeminiClientLike {
  models: {
    generateContent: (params: unknown) => Promise<{ text?: string }>;
    embedContent: (params: unknown) => Promise<{
      embeddings?: Array<{ values?: number[] }>;
    }>;
  };
}

function createDefaultGeminiClient(): GeminiClientLike {
  const apiKey = getCleanGeminiApiKey();
  if (!apiKey) {
    throw new GeminiServiceError(
      'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets (or your deployment environment variables) to enable StockWise AI.',
      'MISSING_KEY',
      503
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  }) as unknown as GeminiClientLike;
}

export function classifyGeminiError(err: unknown): GeminiServiceError {
  if (err instanceof GeminiServiceError) return err;

  const message = err instanceof Error ? err.message : String(err ?? 'Unknown Gemini error');
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;

  const lower = message.toLowerCase();
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('api key not valid')
  ) {
    return new GeminiServiceError(
      'The configured GEMINI_API_KEY was rejected by Google Gemini API. Verify your API key in Settings > Secrets.',
      'INVALID_KEY',
      502
    );
  }

  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('rate limit') || lower.includes('quota')) {
    return new GeminiServiceError(
      'Gemini API rate limit or quota reached. Please wait a moment and retry.',
      'RATE_LIMITED',
      429
    );
  }

  if (status === 404 || lower.includes('not_found') || lower.includes('not found')) {
    return new GeminiServiceError(
      `Configured Gemini model was not found (${message}). Check GEMINI_CHAT_MODEL / GEMINI_EMBEDDING_MODEL.`,
      'MODEL_NOT_FOUND',
      502
    );
  }

  return new GeminiServiceError(
    `Gemini service is temporarily unavailable: ${message}`,
    'UNAVAILABLE',
    503
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastErr: GeminiServiceError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const classified = classifyGeminiError(err);
      lastErr = classified;

      const retryable = classified.code === 'RATE_LIMITED' || classified.code === 'UNAVAILABLE';
      if (!retryable || attempt === maxAttempts) {
        throw classified;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastErr ?? new GeminiServiceError('Gemini request failed.', 'UNAVAILABLE', 503);
}

export interface ChatHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export async function generateGeminiGroundedAnswer(
  params: {
    systemInstruction: string;
    history?: ChatHistoryTurn[];
    userPrompt: string;
    detailMode?: 'concise' | 'detailed';
  },
  deps?: {
    client?: GeminiClientLike;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<{ text: string; model: string }> {
  const client = deps?.client ?? createDefaultGeminiClient();
  const model = getConfiguredChatModel();

  const contents = [
    ...(params.history ?? []).map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
    {
      role: 'user' as const,
      parts: [{ text: params.userPrompt }],
    },
  ];

  const response = await withRetry(
    () =>
      client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: params.systemInstruction,
          thinkingConfig: {
            thinkingLevel:
              params.detailMode === 'detailed' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
          },
        },
      }),
    { sleep: deps?.sleep }
  );

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new GeminiServiceError(
      'Gemini returned an empty response. Please try rephrasing your question.',
      'BAD_RESPONSE',
      502
    );
  }

  return { text, model };
}

export async function generateEmbeddingsBatch(
  texts: string[],
  deps?: {
    client?: GeminiClientLike;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<{ embeddings: number[][]; model: string }> {
  if (texts.length === 0) {
    return { embeddings: [], model: getConfiguredEmbeddingModel() };
  }

  const client = deps?.client ?? createDefaultGeminiClient();
  const model = getConfiguredEmbeddingModel();
  const batchSize = 20;
  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await withRetry(
      () =>
        client.models.embedContent({
          model,
          contents: batch,
          config: {
            outputDimensionality: EMBEDDING_DIMENSIONS,
          },
        }),
      { sleep: deps?.sleep }
    );

    const vectors = (result.embeddings ?? []).map((item) => item.values ?? []);
    if (vectors.length !== batch.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
      throw new GeminiServiceError(
        `Embedding model returned unexpected vector dimensions (expected ${EMBEDDING_DIMENSIONS}).`,
        'BAD_RESPONSE',
        502
      );
    }

    allVectors.push(...vectors);
  }

  return { embeddings: allVectors, model };
}

export async function generateQueryEmbedding(
  query: string,
  deps?: {
    client?: GeminiClientLike;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<{ vector: number[]; model: string }> {
  const { embeddings, model } = await generateEmbeddingsBatch([query], deps);
  return { vector: embeddings[0], model };
}
