import React from 'react';
import type { StockStatus } from '../../utils/calculations';

interface StatusBadgeProps {
  variant:
    | StockStatus
    | 'paid'
    | 'pending'
    | 'partial'
    | 'refunded'
    | 'draft'
    | 'ordered'
    | 'partially_received'
    | 'received'
    | 'cancelled'
    | 'active'
    | 'archived'
    | 'admin'
    | 'staff';
  label?: string;
}

const VARIANT_STYLES: Record<
  StatusBadgeProps['variant'],
  { bg: string; defaultLabel: string }
> = {
  in_stock: {
    bg: 'bg-[#68B88A]/18 text-[#1C6B43] dark:bg-[#68B88A]/20 dark:text-[#68B88A]',
    defaultLabel: 'In Stock',
  },
  low_stock: {
    bg: 'bg-[#E6B65C]/25 text-[#7A5106] dark:bg-[#E6B65C]/20 dark:text-[#E6B65C]',
    defaultLabel: 'Low Stock',
  },
  out_of_stock: {
    bg: 'bg-[#E56B6F]/20 text-[#962226] dark:bg-[#E56B6F]/25 dark:text-[#E56B6F]',
    defaultLabel: 'Out of Stock',
  },
  paid: {
    bg: 'bg-[#68B88A]/18 text-[#1C6B43] dark:bg-[#68B88A]/20 dark:text-[#68B88A]',
    defaultLabel: 'Paid',
  },
  received: {
    bg: 'bg-[#68B88A]/18 text-[#1C6B43] dark:bg-[#68B88A]/20 dark:text-[#68B88A]',
    defaultLabel: 'Received',
  },
  partially_received: {
    bg: 'bg-[#E6B65C]/25 text-[#7A5106] dark:bg-[#E6B65C]/20 dark:text-[#E6B65C]',
    defaultLabel: 'Partial Receipt',
  },
  ordered: {
    bg: 'bg-[#C9C2E6]/35 text-[#362C5C] dark:bg-[#6F63A8]/25 dark:text-[#D7D1F3]',
    defaultLabel: 'Ordered',
  },
  partial: {
    bg: 'bg-[#E6B65C]/25 text-[#7A5106] dark:bg-[#E6B65C]/20 dark:text-[#E6B65C]',
    defaultLabel: 'Partial',
  },
  pending: {
    bg: 'bg-[#E6B65C]/25 text-[#7A5106] dark:bg-[#E6B65C]/20 dark:text-[#E6B65C]',
    defaultLabel: 'Pending',
  },
  draft: {
    bg: 'bg-[#E2E8E4]/80 text-[#434846] dark:bg-[#29323C] dark:text-[#89919A]',
    defaultLabel: 'Draft',
  },
  cancelled: {
    bg: 'bg-[#E56B6F]/20 text-[#962226] dark:bg-[#E56B6F]/25 dark:text-[#E56B6F]',
    defaultLabel: 'Cancelled',
  },
  refunded: {
    bg: 'bg-[#E56B6F]/20 text-[#962226] dark:bg-[#E56B6F]/25 dark:text-[#E56B6F]',
    defaultLabel: 'Refunded',
  },
  active: {
    bg: 'bg-[#68B88A]/18 text-[#1C6B43] dark:bg-[#68B88A]/20 dark:text-[#68B88A]',
    defaultLabel: 'Active',
  },
  archived: {
    bg: 'bg-[#E2E8E4]/80 text-[#434846] dark:bg-[#29323C] dark:text-[#89919A]',
    defaultLabel: 'Archived',
  },
  admin: {
    bg: 'bg-[#15191E] text-[#C5F36B] dark:bg-[#C5F36B]/15 dark:text-[#C5F36B]',
    defaultLabel: 'Admin',
  },
  staff: {
    bg: 'bg-[#E2E8E4]/80 text-[#17211E] dark:bg-[#29323C] dark:text-[#F5F5F0]',
    defaultLabel: 'Staff',
  },
};

export function StatusBadge({ variant, label }: StatusBadgeProps) {
  const cfg = VARIANT_STYLES[variant];
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-md text-[11px] font-semibold tracking-wide whitespace-nowrap shrink-0 ${cfg.bg}`}
    >
      {label ?? cfg.defaultLabel}
    </span>
  );
}
