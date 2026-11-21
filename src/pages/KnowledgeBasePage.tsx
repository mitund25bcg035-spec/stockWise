import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenText,
  Database,
  Eye,
  FilePlus2,
  FileUp,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Layers,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Modal } from '../components/ui/Modal';
import type {
  AiChunkPreview,
  AiDocument,
  AiDocumentStatus,
  AiDocumentType,
  AiStatus,
  User,
} from '../types';

interface KnowledgeBasePageProps {
  user: User;
  activeBusinessId: number;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const DOC_TYPE_LABELS: Record<AiDocumentType, string> = {
  manual: 'User Manual',
  guide: 'Operations Guide',
  policy: 'Policy & Rules',
  faq: 'FAQ',
  upload: 'Uploaded File',
  other: 'Reference',
};

function statusBadgeClasses(status: AiDocumentStatus): string {
  switch (status) {
    case 'processed':
      return 'bg-[#68B88A]/15 text-[#3B8D61] dark:text-[#68B88A] border-[#68B88A]/30';
    case 'processing':
      return 'bg-[#7CC6FE]/15 text-[#2274A5] dark:text-[#7CC6FE] border-[#7CC6FE]/30';
    case 'failed':
      return 'bg-[#E56B6F]/15 text-[#C44549] dark:text-[#E56B6F] border-[#E56B6F]/30';
    default:
      return 'bg-[#E6B65C]/15 text-[#9C7021] dark:text-[#E6B65C] border-[#E6B65C]/30';
  }
}

function StatusIcon({ status }: { status: AiDocumentStatus }) {
  if (status === 'processed') return <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />;
  if (status === 'failed') return <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;
  if (status === 'processing') return <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />;
  return <Clock3 className="w-3.5 h-3.5 shrink-0" />;
}

export function KnowledgeBasePage({
  user,
  activeBusinessId,
  onToast,
}: KnowledgeBasePageProps) {
  const isAdmin = user.role === 'admin';
  const [statusInfo, setStatusInfo] = useState<AiStatus | null>(null);
  const [documents, setDocuments] = useState<AiDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | AiDocumentType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AiDocumentStatus>('all');
  const [seeding, setSeeding] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  // Create / Edit Text Document Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<AiDocument | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType] = useState<AiDocumentType>('guide');
  const [formContent, setFormContent] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);

  // Upload File Modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadType, setUploadType] = useState<AiDocumentType>('upload');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inspect Chunks Modal
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectedDoc, setInspectedDoc] = useState<AiDocument | null>(null);
  const [inspectedChunks, setInspectedChunks] = useState<AiChunkPreview[]>([]);

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<AiDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadKnowledgeBase = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [statusRes, docsRes] = await Promise.all([
        apiRequest<AiStatus>('/api/ai/status'),
        apiRequest<AiDocument[]>('/api/ai/documents'),
      ]);
      setStatusInfo(statusRes);
      setDocuments(docsRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load AI Knowledge Base.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, onToast]);

  useEffect(() => {
    loadKnowledgeBase();
  }, [loadKnowledgeBase, activeBusinessId]);

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (typeFilter !== 'all' && doc.documentType !== typeFilter) return false;
      if (statusFilter !== 'all' && doc.status !== statusFilter) return false;
      if (!q) return true;
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.description.toLowerCase().includes(q) ||
        doc.source.toLowerCase().includes(q)
      );
    });
  }, [documents, searchQuery, typeFilter, statusFilter]);

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-10 text-center max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center justify-center mx-auto mb-3">
          <Lock className="w-5 h-5 text-[#89919A]" />
        </div>
        <h2 className="text-base font-bold font-display">Administrator Access Required</h2>
        <p className="text-xs text-[#89919A] mt-1.5">
          Only workspace administrators can upload documentation, trigger Gemini vector embeddings,
          or manage the StockWise AI Knowledge Base.
        </p>
      </div>
    );
  }

  function openCreateModal() {
    setEditingDoc(null);
    setFormTitle('');
    setFormDescription('');
    setFormType('guide');
    setFormContent('');
    setEditorOpen(true);
  }

  async function openEditModal(doc: AiDocument) {
    try {
      const detail = await apiRequest<{ document: AiDocument }>(`/api/ai/documents/${doc.id}`);
      const full = detail.document;
      setEditingDoc(full);
      setFormTitle(full.title);
      setFormDescription(full.description);
      setFormType(full.documentType);
      setFormContent(full.rawContent ?? '');
      setEditorOpen(true);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load document contents.');
    }
  }

  async function handleSaveDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim()) {
      onToast('error', 'Document title and content are required.');
      return;
    }
    setSavingDoc(true);
    try {
      if (editingDoc) {
        const res = await apiRequest<{ ingestion: { status: string; errorMessage?: string } }>(
          `/api/ai/documents/${editingDoc.id}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              title: formTitle.trim(),
              description: formDescription.trim(),
              documentType: formType,
              rawContent: formContent.trim(),
            }),
          }
        );
        if (res.ingestion.status === 'failed') {
          onToast('error', res.ingestion.errorMessage || 'Document saved, but embedding failed.');
        } else {
          onToast('success', 'Knowledge document updated.');
        }
      } else {
        const res = await apiRequest<{ ingestion: { status: string; errorMessage?: string } }>(
          '/api/ai/documents',
          {
            method: 'POST',
            body: JSON.stringify({
              title: formTitle.trim(),
              description: formDescription.trim(),
              documentType: formType,
              rawContent: formContent.trim(),
            }),
          }
        );
        if (res.ingestion.status === 'failed') {
          onToast('error', res.ingestion.errorMessage || 'Document created, but embedding failed.');
        } else {
          onToast('success', 'Knowledge document added to repository.');
        }
      }
      setEditorOpen(false);
      await loadKnowledgeBase();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save knowledge document.');
    } finally {
      setSavingDoc(false);
    }
  }

  function handleSelectFile(file: File | null) {
    if (!file) {
      setUploadFile(null);
      return;
    }
    const lower = file.name.toLowerCase();
    const valid = ['.txt', '.md', '.markdown', '.pdf', '.docx'].some((ext) => lower.endsWith(ext));
    if (!valid) {
      onToast('error', 'Supported formats: .txt, .md, .pdf, or .docx');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onToast('error', 'File exceeds the 5 MB size limit.');
      return;
    }
    setUploadFile(file);
    if (!uploadTitle.trim()) {
      setUploadTitle(file.name.replace(/\.[^.]+$/, ''));
    }
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) {
      onToast('error', 'Select a .txt, .md, .pdf, or .docx file to upload.');
      return;
    }
    setUploading(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Failed to read selected file.'));
        reader.readAsDataURL(uploadFile);
      });

      const res = await apiRequest<{ ingestion: { status: string; errorMessage?: string } }>(
        '/api/ai/documents/upload',
        {
          method: 'POST',
          body: JSON.stringify({
            filename: uploadFile.name,
            mimeType: uploadFile.type,
            base64Data,
            title: uploadTitle.trim() || undefined,
            description: uploadDescription.trim(),
            documentType: uploadType,
          }),
        }
      );

      if (res.ingestion.status === 'failed') {
        onToast('error', res.ingestion.errorMessage || 'File extracted, but embedding failed.');
      } else {
        onToast('success', `Uploaded "${uploadFile.name}" successfully.`);
      }
      setUploadOpen(false);
      setUploadFile(null);
      setUploadTitle('');
      setUploadDescription('');
      await loadKnowledgeBase();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to upload document.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSeedSampleDocs() {
    setSeeding(true);
    try {
      const res = await apiRequest<{
        createdCount: number;
        existingCount: number;
        processedCount: number;
        failedCount: number;
        geminiConfigured: boolean;
      }>('/api/ai/documents/seed', { method: 'POST' });

      if (!res.geminiConfigured) {
        onToast(
          'success',
          `Verified ${res.createdCount + res.existingCount} sample docs. Add GEMINI_API_KEY in server Secrets to generate embeddings.`
        );
      } else if (res.failedCount > 0) {
        onToast(
          'error',
          `Seeded docs, but ${res.failedCount} failed vector ingestion. Check job status in table.`
        );
      } else {
        onToast(
          'success',
          `Sample documentation synchronized (${res.createdCount} new, ${res.processedCount} embedded).`
        );
      }
      await loadKnowledgeBase();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to seed sample documents.');
    } finally {
      setSeeding(false);
    }
  }

  async function handleReprocess(doc: AiDocument) {
    setReprocessingId(doc.id);
    try {
      const res = await apiRequest<{ ingestion: { status: string; chunkCount: number; errorMessage?: string } }>(
        `/api/ai/documents/${doc.id}/reprocess`,
        { method: 'POST' }
      );
      if (res.ingestion.status === 'failed') {
        onToast('error', res.ingestion.errorMessage || 'Reprocessing failed.');
      } else {
        onToast('success', `Indexed ${res.ingestion.chunkCount} vector chunks for "${doc.title}".`);
      }
      await loadKnowledgeBase();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to reprocess document.');
    } finally {
      setReprocessingId(null);
    }
  }

  async function handleInspect(doc: AiDocument) {
    setInspectOpen(true);
    setInspectLoading(true);
    setInspectedDoc(doc);
    setInspectedChunks([]);
    try {
      const res = await apiRequest<{ document: AiDocument; chunks: AiChunkPreview[] }>(
        `/api/ai/documents/${doc.id}`
      );
      setInspectedDoc(res.document);
      setInspectedChunks(res.chunks);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to inspect document.');
    } finally {
      setInspectLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/ai/documents/${deleteTarget.id}`, { method: 'DELETE' });
      onToast('success', `Deleted "${deleteTarget.title}" from Knowledge Base.`);
      setDeleteTarget(null);
      await loadKnowledgeBase();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to delete document.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight font-display">
            AI Knowledge Base &amp; RAG Index
          </h2>
          <p className="text-xs text-[#89919A] mt-0.5">
            Upload operational manuals, policies, and guides indexed by Gemini embeddings for
            STOCKWISE AI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSeedSampleDocs}
            disabled={seeding}
            className="h-9 px-3.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#202832] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#89919A]" />
            <span>{seeding ? 'Syncing Docs...' : 'Sync Sample Docs'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setUploadFile(null);
              setUploadTitle('');
              setUploadDescription('');
              setUploadType('upload');
              setUploadOpen(true);
            }}
            className="h-9 px-3.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#202832] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>Upload File</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="h-9 px-3.5 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>New Document</span>
          </button>
        </div>
      </div>

      {/* Engine Status Banner */}
      {statusInfo && (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#15191E] dark:bg-[#29323C] text-[#C5F36B] flex items-center justify-center shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-[#15191E] dark:text-white">
                  RAG Pipeline Diagnostics
                </p>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                    statusInfo.geminiConfigured
                      ? 'bg-[#68B88A]/15 text-[#3B8D61] dark:text-[#68B88A] border-[#68B88A]/30'
                      : 'bg-[#E6B65C]/15 text-[#9C7021] dark:text-[#E6B65C] border-[#E6B65C]/30'
                  }`}
                >
                  {statusInfo.geminiConfigured
                    ? 'Gemini API Key Configured'
                    : 'GEMINI_API_KEY Missing in Server Env'}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F5F5F0] dark:bg-[#15191E] text-[#89919A] border border-[#E2E4DF] dark:border-[#29323C]">
                  {statusInfo.supabaseConfigured
                    ? 'Supabase PostgreSQL + pgvector'
                    : 'Local SQLite Vector Store'}
                </span>
              </div>
              <p className="text-[11px] text-[#89919A] mt-1">
                Chat Model: <span className="font-mono text-[#15191E] dark:text-white">{statusInfo.chatModel}</span> ·
                Embeddings:{' '}
                <span className="font-mono text-[#15191E] dark:text-white">
                  {statusInfo.embeddingModel} ({statusInfo.embeddingDimensions}d)
                </span>
              </p>
            </div>
          </div>

          {!statusInfo.geminiConfigured && (
            <p className="text-[11px] text-[#9C7021] dark:text-[#E6B65C] max-w-sm">
              Documents are saved safely, and embeddings will generate as soon as{' '}
              <span className="font-mono font-semibold">GEMINI_API_KEY</span> is configured in
              server environment secrets.
            </p>
          )}
        </div>
      )}

      {/* Summary KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
            Knowledge Docs
          </p>
          <p className="text-2xl font-bold font-display tabular-nums mt-1">
            {statusInfo?.documentCount ?? documents.length}
          </p>
        </div>
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
            Processed &amp; Ready
          </p>
          <p className="text-2xl font-bold font-display tabular-nums mt-1 text-[#3B8D61] dark:text-[#68B88A]">
            {statusInfo?.processedDocumentCount ??
              documents.filter((d) => d.status === 'processed').length}
          </p>
        </div>
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
            Vector Chunks
          </p>
          <p className="text-2xl font-bold font-display tabular-nums mt-1">
            {statusInfo?.chunkCount ??
              documents.reduce((sum, d) => sum + (d.chunkCount || 0), 0)}
          </p>
        </div>
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
            Pending / Failed
          </p>
          <p className="text-2xl font-bold font-display tabular-nums mt-1">
            {documents.filter((d) => d.status === 'pending' || d.status === 'failed').length}
          </p>
        </div>
      </div>

      {/* Filters & Document Table */}
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
        <div className="p-4 border-b border-[#E2E4DF] dark:border-[#29323C] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search knowledge documents by title, description, or source..."
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs focus:outline-none focus:border-[#89919A]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by document type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | AiDocumentType)}
              className="h-9 px-3 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs font-medium focus:outline-none cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="manual">User Manual</option>
              <option value="guide">Operations Guide</option>
              <option value="policy">Policy &amp; Rules</option>
              <option value="faq">FAQ</option>
              <option value="upload">Uploaded File</option>
              <option value="other">Reference</option>
            </select>

            <select
              aria-label="Filter by ingestion status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AiDocumentStatus)}
              className="h-9 px-3 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs font-medium focus:outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="processed">Processed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A] bg-[#F5F5F0]/60 dark:bg-[#15191E]/60">
                <th className="py-3 px-4">Document</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Chunks</th>
                <th className="py-3 px-4">Updated</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
              {loading && documents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#89919A]">
                    Loading knowledge documents...
                  </td>
                </tr>
              ) : filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#89919A]">
                    No knowledge documents match the current filters.
                  </td>
                </tr>
              ) : (
                filteredDocuments.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-[#F5F5F0]/60 dark:hover:bg-[#15191E]/50 transition-colors"
                  >
                    <td className="py-3.5 px-4 max-w-md">
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center shrink-0 mt-0.5">
                          <BookOpenText className="w-4 h-4 text-[#89919A]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#15191E] dark:text-white truncate">
                            {doc.title}
                          </p>
                          <p className="text-[11px] text-[#89919A] line-clamp-1 mt-0.5">
                            {doc.description || doc.source}
                          </p>
                          {doc.status === 'failed' && doc.latestJobError && (
                            <p className="text-[11px] text-[#E56B6F] mt-1 line-clamp-1">
                              {doc.latestJobError}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-medium text-[#15191E] dark:text-[#F5F5F0]">
                        {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold capitalize ${statusBadgeClasses(
                          doc.status
                        )}`}
                      >
                        <StatusIcon status={doc.status} />
                        <span>{doc.status}</span>
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right font-semibold tabular-nums whitespace-nowrap">
                      {doc.chunkCount}
                    </td>

                    <td className="py-3.5 px-4 text-[#89919A] whitespace-nowrap tabular-nums">
                      {formatDateTime(doc.updatedAt)}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleInspect(doc)}
                          aria-label={`Inspect ${doc.title}`}
                          title="Inspect extracted text & chunks"
                          className="p-1.5 rounded-lg text-[#89919A] hover:text-[#15191E] dark:hover:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditModal(doc)}
                          aria-label={`Edit ${doc.title}`}
                          title="Edit document"
                          className="p-1.5 rounded-lg text-[#89919A] hover:text-[#15191E] dark:hover:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleReprocess(doc)}
                          disabled={reprocessingId === doc.id}
                          aria-label={`Reprocess ${doc.title}`}
                          title="Re-chunk & generate Gemini embeddings"
                          className="p-1.5 rounded-lg text-[#89919A] hover:text-[#15191E] dark:hover:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              reprocessingId === doc.id ? 'animate-spin' : ''
                            }`}
                          />
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(doc)}
                          aria-label={`Delete ${doc.title}`}
                          title="Delete document"
                          className="p-1.5 rounded-lg text-[#89919A] hover:text-[#E56B6F] hover:bg-[#E56B6F]/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Document Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingDoc ? 'Edit Knowledge Document' : 'Create Knowledge Document'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSaveDocument} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1.5">Document Title</label>
              <input
                type="text"
                required
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g., Warehouse Cycle Count Standard Operating Procedure"
                className="w-full h-10 px-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs focus:outline-none focus:border-[#89919A]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5">Document Type</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as AiDocumentType)}
                className="w-full h-10 px-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs focus:outline-none cursor-pointer"
              >
                <option value="guide">Operations Guide</option>
                <option value="manual">User Manual</option>
                <option value="policy">Policy &amp; Rules</option>
                <option value="faq">FAQ</option>
                <option value="other">Reference</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5">Short Description</label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Summary shown in Knowledge Base list and citations"
              className="w-full h-10 px-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs focus:outline-none focus:border-[#89919A]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5">
              Markdown / Plain Text Content
            </label>
            <textarea
              required
              rows={11}
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Write or paste documentation, workflows, or policy guidelines..."
              className="w-full p-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs font-mono leading-relaxed focus:outline-none focus:border-[#89919A]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="h-9 px-4 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDoc}
              className="h-9 px-4 rounded-xl bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {savingDoc ? 'Saving & Indexing...' : editingDoc ? 'Save Changes' : 'Create & Index'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Upload File Modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload Knowledge Base File"
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-[#E2E4DF] dark:border-[#29323C] hover:border-[#89919A] rounded-2xl p-6 text-center cursor-pointer bg-[#F5F5F0]/60 dark:bg-[#15191E]/60 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.pdf,.docx"
              className="hidden"
              onChange={(e) => handleSelectFile(e.target.files?.[0] ?? null)}
            />
            <FileUp className="w-7 h-7 mx-auto text-[#89919A] mb-2" />
            {uploadFile ? (
              <div>
                <p className="text-xs font-semibold text-[#15191E] dark:text-white">
                  {uploadFile.name}
                </p>
                <p className="text-[11px] text-[#89919A] mt-0.5 tabular-nums">
                  {(uploadFile.size / 1024).toFixed(1)} KB · Click to replace file
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-semibold text-[#15191E] dark:text-white">
                  Choose a document to extract &amp; embed
                </p>
                <p className="text-[11px] text-[#89919A] mt-1">
                  Supports .txt, .md, .pdf, and .docx up to 5 MB
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1.5">Display Title</label>
              <input
                type="text"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="Auto-filled from filename"
                className="w-full h-10 px-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs focus:outline-none focus:border-[#89919A]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5">Document Type</label>
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value as AiDocumentType)}
                className="w-full h-10 px-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs focus:outline-none cursor-pointer"
              >
                <option value="upload">Uploaded File</option>
                <option value="manual">User Manual</option>
                <option value="guide">Operations Guide</option>
                <option value="policy">Policy &amp; Rules</option>
                <option value="faq">FAQ</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5">Description (Optional)</label>
            <input
              type="text"
              value={uploadDescription}
              onChange={(e) => setUploadDescription(e.target.value)}
              placeholder="Brief note about what this document covers"
              className="w-full h-10 px-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs focus:outline-none focus:border-[#89919A]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setUploadOpen(false)}
              className="h-9 px-4 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !uploadFile}
              className="h-9 px-4 rounded-xl bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {uploading ? 'Extracting & Embedding...' : 'Upload & Index'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Inspect Chunks Modal */}
      <Modal
        open={inspectOpen}
        onClose={() => setInspectOpen(false)}
        title={inspectedDoc ? `Inspect: ${inspectedDoc.title}` : 'Document Chunks'}
        maxWidthClass="max-w-3xl"
      >
        {inspectLoading ? (
          <div className="py-10 text-center text-xs text-[#89919A]">
            Loading chunks and extraction metadata...
          </div>
        ) : inspectedDoc ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold capitalize ${statusBadgeClasses(
                  inspectedDoc.status
                )}`}
              >
                <StatusIcon status={inspectedDoc.status} />
                <span>{inspectedDoc.status}</span>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#F5F5F0] dark:bg-[#15191E] text-[11px] text-[#89919A]">
                Source: {inspectedDoc.source}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#F5F5F0] dark:bg-[#15191E] text-[11px] text-[#89919A] tabular-nums">
                {inspectedChunks.length} indexed chunks
              </span>
            </div>

            {inspectedDoc.latestJobError && (
              <div className="p-3 rounded-xl bg-[#E56B6F]/10 border border-[#E56B6F]/30 text-xs text-[#C44549] dark:text-[#E56B6F]">
                <strong>Last Ingestion Error:</strong> {inspectedDoc.latestJobError}
              </div>
            )}

            {inspectedChunks.length > 0 ? (
              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {inspectedChunks.map((ch) => (
                  <div
                    key={ch.id}
                    className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C]"
                  >
                    <div className="flex items-center justify-between text-[11px] text-[#89919A] mb-1.5">
                      <span className="font-semibold text-[#15191E] dark:text-white inline-flex items-center gap-1">
                        <Layers className="w-3 h-3 text-[#89919A]" />
                        Chunk #{ch.chunkIndex + 1}
                      </span>
                      <span className="font-mono tabular-nums">
                        {ch.content.length} chars · {ch.embeddingModel || 'vector'}
                      </span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap leading-relaxed text-[#15191E] dark:text-[#F5F5F0]">
                      {ch.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C]">
                <p className="text-xs font-semibold mb-1.5">
                  No vector chunks generated yet (raw text preview):
                </p>
                <p className="text-xs whitespace-pre-wrap max-h-64 overflow-y-auto text-[#89919A] leading-relaxed">
                  {inspectedDoc.rawContent || 'Empty document.'}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Knowledge Document"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-[#89919A] leading-relaxed">
            Remove <strong className="text-[#15191E] dark:text-white">{deleteTarget?.title}</strong>{' '}
            and all associated vector chunks from STOCKWISE AI? This cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="h-9 px-4 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="h-9 px-4 rounded-xl bg-[#E56B6F] hover:bg-[#D55A5E] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {deleting ? 'Deleting...' : 'Delete Document'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
