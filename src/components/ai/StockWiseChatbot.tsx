import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  Copy,
  Database,
  History,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type {
  AiChatResponse,
  AiConversation,
  AiMessage,
  AiStatus,
  BusinessSettings,
  NavModuleId,
  User,
} from '../../types';

interface StockWiseChatbotProps {
  user: User;
  activeBusinessId: number;
  settings: BusinessSettings;
  onNavigate: (module: NavModuleId) => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const SUGGESTED_QUESTIONS = [
  'Give me a daily inventory briefing',
  'Which products are currently low in stock or out of stock?',
  'How is total inventory value calculated in StockWise?',
  'How do I receive a purchase order and update stock?',
  'What were our recent sales and top-selling products?',
  'How do stock movements track additions and deductions?',
  'What happens when a sale is refunded or cancelled?',
  'Which suppliers and customers are active right now?',
];

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  // Safely tokenize bold (**...**), inline code (`...`), and italic (*...*) without HTML injection
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length >= 2) {
      return (
        <code
          key={i}
          className="px-1 py-0.5 rounded bg-[#15191E]/10 dark:bg-[#15191E] font-mono text-[11px]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-[#15191E] dark:text-white">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length >= 2) {
      return (
        <em key={i} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={i}>{tok}</React.Fragment>;
  });
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="my-2 p-2.5 rounded-lg bg-[#15191E] text-[#F5F5F0] text-[11px] font-mono overflow-x-auto"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Markdown Table
    if (
      line.trim().startsWith('|') &&
      i + 1 < lines.length &&
      /^\s*\|[\s:-]+\|/.test(lines[i + 1])
    ) {
      const parseCells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseCells(lines[i]));
        i++;
      }

      blocks.push(
        <div
          key={`tbl-${blocks.length}`}
          className="my-2 overflow-x-auto rounded-lg border border-[#E2E4DF] dark:border-[#29323C]"
        >
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C]">
                {headers.map((h, idx) => (
                  <th key={idx} className="py-1.5 px-2 font-semibold whitespace-nowrap">
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
              {rows.map((r, rIdx) => (
                <tr key={rIdx}>
                  {r.map((cell, cIdx) => (
                    <td key={cIdx} className="py-1.5 px-2 tabular-nums">
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (headingMatch) {
      blocks.push(
        <p
          key={`h-${blocks.length}`}
          className="font-semibold text-[13px] text-[#15191E] dark:text-white mt-2 mb-1"
        >
          {renderInlineMarkdown(headingMatch[2])}
        </p>
      );
      i++;
      continue;
    }

    // Bulleted list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc pl-4 my-1.5 space-y-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="list-decimal pl-4 my-1.5 space-y-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('|') &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="leading-relaxed my-1">
        {renderInlineMarkdown(paraLines.join(' '))}
      </p>
    );
  }

  return <div className="text-xs space-y-1">{blocks}</div>;
}

export function StockWiseChatbot({
  user,
  activeBusinessId,
  settings,
  onNavigate,
  onToast,
}: StockWiseChatbotProps) {
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailMode, setDetailMode] = useState<'concise' | 'detailed'>('concise');

  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadConversationsAndStatus = useCallback(async () => {
    try {
      const [statusRes, convRes] = await Promise.all([
        apiRequest<AiStatus>('/api/ai/status'),
        apiRequest<AiConversation[]>('/api/ai/conversations'),
      ]);
      setAiStatus(statusRes);
      setConversations(convRes);
    } catch {
      // silent background check
    }
  }, []);

  useEffect(() => {
    setActiveConversationId(null);
    setMessages([]);
    setErrorBanner(null);
    loadConversationsAndStatus();
  }, [activeBusinessId, user.id, loadConversationsAndStatus]);

  useEffect(() => {
    if (open) {
      loadConversationsAndStatus();
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open, loadConversationsAndStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function selectConversation(conversationId: string) {
    try {
      const msgs = await apiRequest<AiMessage[]>(
        `/api/ai/conversations/${conversationId}/messages`
      );
      setActiveConversationId(conversationId);
      setMessages(msgs);
      setHistoryOpen(false);
      setErrorBanner(null);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load conversation.');
    }
  }

  function startNewConversation() {
    setActiveConversationId(null);
    setMessages([]);
    setErrorBanner(null);
    setHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  async function handleRenameConversation(id: string) {
    const clean = renameDraft.trim();
    if (!clean) {
      setRenamingId(null);
      return;
    }
    try {
      const updated = await apiRequest<AiConversation>(`/api/ai/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: clean }),
      });
      setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)));
      setRenamingId(null);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to rename conversation.');
    }
  }

  async function handleDeleteConversation(id: string) {
    try {
      await apiRequest(`/api/ai/conversations/${id}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
      onToast('success', 'Conversation removed.');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to delete conversation.');
    }
  }

  async function sendQuestion(rawQuestion: string) {
    const clean = rawQuestion.trim();
    if (!clean || sending) return;

    setSending(true);
    setErrorBanner(null);
    setInputValue('');

    const tempUserMsg: AiMessage = {
      id: `temp-${Date.now()}`,
      conversationId: activeConversationId ?? 'pending',
      userId: user.id,
      role: 'user',
      content: clean,
      metadata: { detailMode },
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await apiRequest<AiChatResponse>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConversationId ?? undefined,
          message: clean,
          detailMode,
        }),
      });

      setActiveConversationId(res.conversation.id);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        res.userMessage,
        res.assistantMessage,
      ]);

      setConversations((prev) => {
        const others = prev.filter((c) => c.id !== res.conversation.id);
        return [res.conversation, ...others];
      });
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'STOCKWISE AI is temporarily unavailable.';
      setErrorBanner(errMsg);
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setInputValue(clean);
    } finally {
      setSending(false);
    }
  }

  function handleRetryAssistant(assistantIndex: number) {
    for (let idx = assistantIndex - 1; idx >= 0; idx--) {
      if (messages[idx]?.role === 'user') {
        sendQuestion(messages[idx].content);
        return;
      }
    }
  }

  async function handleCopyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      onToast('error', 'Clipboard copy is blocked in this browser.');
    }
  }

  return (
    <>
      {/* Floating Launcher Button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open STOCKWISE AI Assistant"
          className="fixed bottom-5 right-5 z-40 no-print h-12 pl-3 pr-4 rounded-2xl bg-[#15191E] hover:bg-[#202832] text-white border border-[#29323C] shadow-xl flex items-center gap-2.5 transition-all cursor-pointer"
        >
          <span className="w-7 h-7 rounded-lg bg-[#C5F36B] text-[#15191E] flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4" />
          </span>
          <span className="text-left">
            <span className="block text-xs font-bold tracking-tight font-display leading-none">
              STOCKWISE AI
            </span>
            <span className="block text-[10px] text-[#89919A] mt-0.5 leading-none">
              Inventory Assistant
            </span>
          </span>
        </button>
      )}

      {/* Chatbot Drawer / Mobile Fullscreen Overlay */}
      {open && (
        <section
          aria-label="STOCKWISE AI Assistant"
          className="fixed inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[440px] sm:max-w-[calc(100vw-2rem)] sm:h-[660px] sm:max-h-[calc(100vh-2.5rem)] z-50 no-print bg-white dark:bg-[#202832] sm:rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-[#15191E] text-white px-4 py-3 border-b border-[#29323C] shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#C5F36B] text-[#15191E] flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xs font-bold tracking-tight font-display truncate">
                    STOCKWISE AI
                  </h2>
                  <p className="text-[11px] text-[#89919A] truncate">
                    Your Intelligent Inventory Assistant
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  aria-label="Toggle conversation history"
                  title="Conversation history"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    historyOpen
                      ? 'bg-[#29323C] text-[#C5F36B]'
                      : 'text-[#89919A] hover:text-white hover:bg-[#202832]'
                  }`}
                >
                  <History className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={startNewConversation}
                  aria-label="New conversation"
                  title="New conversation"
                  className="p-1.5 rounded-lg text-[#89919A] hover:text-white hover:bg-[#202832] transition-colors cursor-pointer"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close STOCKWISE AI"
                  title="Close assistant"
                  className="p-1.5 rounded-lg text-[#89919A] hover:text-white hover:bg-[#202832] transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sub-bar: Workspace Context + Concise / Detailed Switcher */}
            <div className="mt-2.5 pt-2 border-t border-[#29323C] flex items-center justify-between gap-2 text-[11px]">
              <span className="text-[#89919A] truncate">
                Workspace: <strong className="text-white">{settings.companyName}</strong>
              </span>

              <div
                role="group"
                aria-label="Response detail level"
                className="inline-flex rounded-lg bg-[#202832] p-0.5 border border-[#29323C] shrink-0"
              >
                <button
                  type="button"
                  onClick={() => setDetailMode('concise')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                    detailMode === 'concise'
                      ? 'bg-[#C5F36B] text-[#15191E]'
                      : 'text-[#89919A] hover:text-white'
                  }`}
                >
                  Concise
                </button>
                <button
                  type="button"
                  onClick={() => setDetailMode('detailed')}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                    detailMode === 'detailed'
                      ? 'bg-[#C5F36B] text-[#15191E]'
                      : 'text-[#89919A] hover:text-white'
                  }`}
                >
                  Detailed
                </button>
              </div>
            </div>
          </div>

          {/* Body Container */}
          <div className="relative flex-1 flex flex-col min-h-0 bg-[#F5F5F0] dark:bg-[#15191E]">
            {/* History Drawer Overlay */}
            {historyOpen && (
              <div className="absolute inset-0 z-20 bg-white dark:bg-[#202832] flex flex-col">
                <div className="px-4 py-3 border-b border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-between">
                  <p className="text-xs font-bold font-display">Conversation History</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={startNewConversation}
                      className="h-7 px-2.5 rounded-lg bg-[#C5F36B] text-[#15191E] text-[11px] font-semibold cursor-pointer"
                    >
                      New Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(false)}
                      aria-label="Close history"
                      className="p-1 text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {conversations.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[#89919A]">
                      No saved conversations yet for this workspace.
                    </div>
                  ) : (
                    conversations.map((conv) => (
                      <div
                        key={conv.id}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition-colors ${
                          conv.id === activeConversationId
                            ? 'bg-[#F5F5F0] dark:bg-[#15191E] border-[#15191E] dark:border-[#C5F36B]'
                            : 'bg-white dark:bg-[#202832] border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0]/60 dark:hover:bg-[#15191E]/60'
                        }`}
                      >
                        {renamingId === conv.id ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleRenameConversation(conv.id);
                            }}
                            className="flex-1 flex items-center gap-1.5"
                          >
                            <input
                              type="text"
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              className="flex-1 h-7 px-2 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#15191E] text-xs focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="h-7 px-2 rounded-lg bg-[#C5F36B] text-[#15191E] text-[11px] font-semibold cursor-pointer"
                            >
                              Save
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => selectConversation(conv.id)}
                              className="flex-1 text-left min-w-0 cursor-pointer"
                            >
                              <p className="text-xs font-semibold text-[#15191E] dark:text-white truncate">
                                {conv.title}
                              </p>
                              <p className="text-[10px] text-[#89919A] mt-0.5 tabular-nums">
                                Updated {formatTimeShort(conv.updatedAt)}
                              </p>
                            </button>

                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingId(conv.id);
                                  setRenameDraft(conv.title);
                                }}
                                aria-label="Rename conversation"
                                className="p-1.5 rounded-lg text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteConversation(conv.id)}
                                aria-label="Delete conversation"
                                className="p-1.5 rounded-lg text-[#89919A] hover:text-[#E56B6F] cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Missing Gemini Key Notice */}
            {aiStatus && !aiStatus.geminiConfigured && (
              <div className="mx-3 mt-3 p-3 rounded-xl bg-[#E6B65C]/15 border border-[#E6B65C]/40 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#9C7021] dark:text-[#E6B65C] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-semibold text-[#15191E] dark:text-white">
                    Gemini API Key Not Configured
                  </p>
                  <p className="text-[11px] text-[#89919A] mt-0.5 leading-relaxed">
                    Add <span className="font-mono font-semibold">GEMINI_API_KEY</span> in server
                    environment Secrets to activate live RAG answers.
                  </p>
                </div>
              </div>
            )}

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {messages.length === 0 ? (
                <div className="space-y-3 py-1">
                  <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="w-4 h-4 text-[#68B88A] shrink-0" />
                      <p className="text-xs font-bold font-display">
                        Grounded in Live Data &amp; StockWise Docs
                      </p>
                    </div>
                    <p className="text-[11px] text-[#89919A] leading-relaxed">
                      Ask about stock levels, low-stock alerts, purchase orders, sales metrics,
                      operational workflows, or uploaded policies.
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#89919A] mb-1.5 px-0.5">
                      Suggested Prompts
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          disabled={sending}
                          onClick={() => sendQuestion(q)}
                          className="w-full text-left px-3 py-1.5 rounded-xl bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] hover:border-[#89919A] text-xs font-medium text-[#15191E] dark:text-[#F5F5F0] flex items-center justify-between gap-2 transition-colors cursor-pointer leading-snug"
                        >
                          <span>{q}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 text-[#89919A] shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  const sources = msg.metadata?.sources ?? [];
                  const liveSources = sources.filter((s) => s.kind === 'live_data');
                  const docSources = sources.filter((s) => s.kind === 'documentation');
                  const links = msg.metadata?.suggestedLinks ?? [];

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${
                          isUser
                            ? 'bg-[#15191E] text-white'
                            : 'bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-[#15191E] dark:text-[#F5F5F0]'
                        }`}
                      >
                        {isUser ? (
                          <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        ) : (
                          <MarkdownContent content={msg.content} />
                        )}

                        {/* Grounded Citations */}
                        {!isUser && (liveSources.length > 0 || docSources.length > 0) && (
                          <div className="mt-3 pt-2.5 border-t border-[#E2E4DF] dark:border-[#29323C] space-y-2">
                            {liveSources.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#3B8D61] dark:text-[#68B88A] flex items-center gap-1 mb-1">
                                  <Database className="w-3 h-3" />
                                  <span>Live Business Data</span>
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {liveSources.map((s, sIdx) => (
                                    <span
                                      key={sIdx}
                                      title={s.detail}
                                      className="px-2 py-0.5 rounded-md bg-[#68B88A]/12 border border-[#68B88A]/30 text-[10px] font-medium text-[#3B8D61] dark:text-[#68B88A]"
                                    >
                                      {s.title}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {docSources.length > 0 && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-[#89919A] flex items-center gap-1 mb-1">
                                  <BookOpen className="w-3 h-3" />
                                  <span>Documentation Sources</span>
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {docSources.map((s, sIdx) => (
                                    <span
                                      key={sIdx}
                                      title={s.detail}
                                      className="px-2 py-0.5 rounded-md bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-[10px] font-medium text-[#15191E] dark:text-[#F5F5F0]"
                                    >
                                      {s.title}
                                      {s.similarity !== undefined && (
                                        <span className="text-[#89919A] ml-1 tabular-nums">
                                          {(s.similarity * 100).toFixed(0)}%
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Module Quick Links */}
                        {!isUser && links.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {links.map((link) => (
                              <button
                                key={link.module}
                                type="button"
                                onClick={() => {
                                  onNavigate(link.module);
                                  if (window.innerWidth < 640) setOpen(false);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-[#C5F36B]/25 hover:bg-[#C5F36B]/45 border border-[#C5F36B]/60 text-[10px] font-semibold text-[#15191E] dark:text-[#C5F36B] inline-flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <span>{link.label}</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Message Meta & Actions */}
                      <div className="mt-1 px-1 flex items-center gap-2 text-[10px] text-[#89919A] tabular-nums">
                        <span>{formatTimeShort(msg.createdAt)}</span>
                        {!isUser && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopyText(msg.id, msg.content)}
                              className="inline-flex items-center gap-0.5 hover:text-[#15191E] dark:hover:text-white cursor-pointer"
                            >
                              {copiedId === msg.id ? (
                                <>
                                  <Check className="w-3 h-3 text-[#68B88A]" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRetryAssistant(idx)}
                              disabled={sending}
                              className="inline-flex items-center gap-0.5 hover:text-[#15191E] dark:hover:text-white cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Retry</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {sending && (
                <div className="flex items-start">
                  <div className="bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] rounded-2xl px-3.5 py-2.5 text-xs text-[#89919A] flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-[#C5F36B] border-t-transparent animate-spin" />
                    <span>Searching live inventory &amp; knowledge base...</span>
                  </div>
                </div>
              )}

              {errorBanner && (
                <div className="p-3 rounded-xl bg-[#E56B6F]/12 border border-[#E56B6F]/30 text-xs text-[#C44549] dark:text-[#E56B6F] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p>{errorBanner}</p>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendQuestion(inputValue);
              }}
              className="p-3 bg-white dark:bg-[#202832] border-t border-[#E2E4DF] dark:border-[#29323C] shrink-0"
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={2}
                  maxLength={2000}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendQuestion(inputValue);
                    }
                  }}
                  placeholder="Ask STOCKWISE AI about inventory, sales, POs, or manuals..."
                  className="flex-1 resize-none px-3 py-2 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] text-xs text-[#15191E] dark:text-white placeholder:text-[#89919A] focus:outline-none focus:border-[#89919A]"
                />
                <button
                  type="submit"
                  disabled={sending || !inputValue.trim()}
                  aria-label="Send message"
                  className="h-10 w-10 rounded-xl bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#89919A]">
                <span>Enter to send · Shift+Enter for new line</span>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={startNewConversation}
                    className="hover:text-[#15191E] dark:hover:text-white cursor-pointer"
                  >
                    Clear chat
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
