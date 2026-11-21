import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-2xl border border-dashed border-[#E2E4DF] dark:border-[#29323C] bg-white/70 dark:bg-[#202832]/60">
      <div className="w-11 h-11 rounded-xl bg-[#F5F5F0] dark:bg-[#29323C] border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center text-[#15191E] dark:text-[#C5F36B] mb-3">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-[#15191E] dark:text-white font-display">
        {title}
      </h3>
      <p className="text-xs text-[#89919A] max-w-sm mt-1 leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 px-4 py-2 rounded-lg text-xs font-semibold bg-[#C5F36B] text-[#15191E] hover:bg-[#B7E959] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
