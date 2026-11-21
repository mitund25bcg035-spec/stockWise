-- StockWise AI RAG + Vector Search Migration (PostgreSQL + pgvector)
-- Safe, idempotent migration: preserves all existing tables and data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. ai_documents
CREATE TABLE IF NOT EXISTS public.ai_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT 'guide'
    CHECK (document_type IN ('manual', 'guide', 'policy', 'faq', 'upload', 'other')),
  source TEXT NOT NULL DEFAULT 'sample_documentation',
  storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique source key per business for idempotent seeding & updates
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_documents_business_source_key
  ON public.ai_documents (business_id, (metadata->>'sourceKey'))
  WHERE (metadata ? 'sourceKey');

CREATE INDEX IF NOT EXISTS idx_ai_documents_business_status
  ON public.ai_documents (business_id, status, updated_at DESC);

-- 2. ai_document_chunks (768 dimensions matching gemini-embedding-2 outputDimensionality=768)
CREATE TABLE IF NOT EXISTS public.ai_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.ai_documents(id) ON DELETE CASCADE,
  business_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL CHECK (char_length(trim(content)) > 0),
  embedding VECTOR(768) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_chunks_business_doc
  ON public.ai_document_chunks (business_id, document_id);

CREATE INDEX IF NOT EXISTS idx_ai_chunks_embedding_hnsw
  ON public.ai_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. ai_conversations
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  business_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_biz
  ON public.ai_conversations (user_id, business_id, updated_at DESC);

-- 4. ai_messages
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv_created
  ON public.ai_messages (conversation_id, created_at ASC);

-- 5. ai_ingestion_jobs
CREATE TABLE IF NOT EXISTS public.ai_ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.ai_documents(id) ON DELETE CASCADE,
  business_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  processed_chunks INTEGER NOT NULL DEFAULT 0 CHECK (processed_chunks >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_doc_created
  ON public.ai_ingestion_jobs (document_id, created_at DESC);

-- Automatic updated_at trigger
CREATE OR REPLACE FUNCTION public.stockwise_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_documents_updated_at ON public.ai_documents;
CREATE TRIGGER trg_ai_documents_updated_at
  BEFORE UPDATE ON public.ai_documents
  FOR EACH ROW EXECUTE FUNCTION public.stockwise_set_updated_at();

DROP TRIGGER IF EXISTS trg_ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER trg_ai_conversations_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.stockwise_set_updated_at();

-- Secure Vector Similarity Search RPC (business-isolated, processed docs only)
CREATE OR REPLACE FUNCTION public.match_ai_documents(
  query_embedding VECTOR(768),
  filter_business_id UUID,
  similarity_threshold FLOAT DEFAULT 0.45,
  match_count INTEGER DEFAULT 6
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  document_title TEXT,
  document_type TEXT,
  source TEXT,
  chunk_index INTEGER,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    c.document_id,
    d.title AS document_title,
    d.document_type,
    d.source,
    c.chunk_index,
    c.content,
    c.metadata,
    (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
  FROM public.ai_document_chunks c
  INNER JOIN public.ai_documents d ON d.id = c.document_id
  WHERE c.business_id = filter_business_id
    AND d.business_id = filter_business_id
    AND d.status = 'processed'
    AND (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding ASC
  LIMIT GREATEST(1, LEAST(match_count, 20));
$$;

-- Row Level Security (strict user + business isolation)
ALTER TABLE public.ai_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_ingestion_jobs ENABLE ROW LEVEL SECURITY;

-- Business-scoped read policies for authenticated users matching JWT business_id claim
DROP POLICY IF EXISTS "ai_documents_business_read" ON public.ai_documents;
CREATE POLICY "ai_documents_business_read" ON public.ai_documents
  FOR SELECT TO authenticated
  USING (business_id::text = COALESCE(auth.jwt() ->> 'business_id', ''));

DROP POLICY IF EXISTS "ai_chunks_business_read" ON public.ai_document_chunks;
CREATE POLICY "ai_chunks_business_read" ON public.ai_document_chunks
  FOR SELECT TO authenticated
  USING (business_id::text = COALESCE(auth.jwt() ->> 'business_id', ''));

DROP POLICY IF EXISTS "ai_jobs_business_read" ON public.ai_ingestion_jobs;
CREATE POLICY "ai_jobs_business_read" ON public.ai_ingestion_jobs
  FOR SELECT TO authenticated
  USING (business_id::text = COALESCE(auth.jwt() ->> 'business_id', ''));

-- Strict per-user ownership policies for conversations & messages
DROP POLICY IF EXISTS "ai_conversations_owner_all" ON public.ai_conversations;
CREATE POLICY "ai_conversations_owner_all" ON public.ai_conversations
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND business_id::text = COALESCE(auth.jwt() ->> 'business_id', '')
  )
  WITH CHECK (
    user_id = auth.uid()
    AND business_id::text = COALESCE(auth.jwt() ->> 'business_id', '')
  );

DROP POLICY IF EXISTS "ai_messages_owner_all" ON public.ai_messages;
CREATE POLICY "ai_messages_owner_all" ON public.ai_messages
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations conv
      WHERE conv.id = ai_messages.conversation_id
        AND conv.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations conv
      WHERE conv.id = ai_messages.conversation_id
        AND conv.user_id = auth.uid()
    )
  );

-- Private Supabase Storage bucket for original uploaded documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'stockwise-documents',
  'stockwise-documents',
  false,
  5242880,
  ARRAY[
    'text/plain',
    'text/markdown',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;
