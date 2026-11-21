import React from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error';
  message: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm z-50 flex flex-col gap-2 pointer-events-none no-print"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg text-sm transition-all ${
            t.type === 'success'
              ? 'bg-[#14211D] text-[#F2F4F0] border-[#28815F]'
              : 'bg-[#FFF5F5] dark:bg-[#2C1A1D] text-[#8F1D22] dark:text-[#FFB3B5] border-[#E56B6F]'
          }`}
        >
          {t.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[#C7E78B] shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-[#E56B6F] shrink-0 mt-0.5" />
          )}
          <span className="flex-1 text-xs font-medium leading-relaxed">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="opacity-70 hover:opacity-100 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
