import React, { useMemo, useState } from 'react';
import { Bell, CheckCheck, Trash2, ArrowRight } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { EmptyState } from '../components/ui/EmptyState';
import type { NavModuleId, NotificationItem, NotificationType } from '../types';

interface NotificationsPageProps {
  notifications: NotificationItem[];
  onNavigate: (module: NavModuleId) => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const TYPE_LABEL: Record<NotificationType, string> = {
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
  sale: 'Sale',
  purchase: 'Purchase',
  stock_adjustment: 'Stock Update',
  reminder: 'Reminder',
};

export function NotificationsPage({
  notifications,
  onNavigate,
  onRefresh,
  onToast,
}: NotificationsPageProps) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'alerts'>('all');

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'unread') return !n.isRead;
      if (filter === 'alerts') return n.type === 'low_stock' || n.type === 'out_of_stock';
      return true;
    });
  }, [notifications, filter]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  async function toggleRead(n: NotificationItem) {
    try {
      await apiRequest(`/api/notifications/${n.id}/read`, {
        method: 'PATCH',
        body: JSON.stringify({ isRead: !n.isRead }),
      });
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update notification.');
    }
  }

  async function markAllRead() {
    try {
      await apiRequest('/api/notifications/mark-all-read', { method: 'POST' });
      onToast('success', 'All notifications marked as read.');
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to mark notifications.');
    }
  }

  async function deleteNotification(id: number) {
    try {
      await apiRequest(`/api/notifications/${id}`, { method: 'DELETE' });
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to delete notification.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-lg bg-[#EAEAE4] dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C]">
          {(
            [
              ['all', `All (${notifications.length})`],
              ['unread', `Unread (${unreadCount})`],
              ['alerts', 'Stock Alerts'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                filter === id
                  ? 'bg-[#15191E] text-[#C5F36B] dark:bg-[#C5F36B] dark:text-[#15191E]'
                  : 'text-[#525A63] dark:text-[#89919A]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={markAllRead}
          disabled={unreadCount === 0}
          className="h-9 px-3.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap"
        >
          <CheckCheck className="w-4 h-4" />
          <span>Mark All as Read</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications in this view"
          description="Stock alerts, new sales, purchase updates, and stock adjustments appear here automatically."
        />
      ) : (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
          {filtered.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                n.isRead ? 'opacity-75' : 'bg-[#F5F5F0]/60 dark:bg-[#29323C]/40'
              }`}
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold">
                  <span
                    className={`px-2 py-0.5 rounded-md ${
                      n.type === 'out_of_stock'
                        ? 'bg-[#E56B6F]/15 text-[#B4232A] dark:text-[#E56B6F]'
                        : n.type === 'low_stock'
                        ? 'bg-[#E6B65C]/20 text-[#8F6314] dark:text-[#E6B65C]'
                        : 'bg-[#68B88A]/18 text-[#1F5E3B] dark:text-[#68B88A]'
                    }`}
                  >
                    {TYPE_LABEL[n.type]}
                  </span>
                  {!n.isRead && (
                    <span className="text-[#2E5409] dark:text-[#C5F36B]">Unread</span>
                  )}
                  <span className="text-[#89919A] font-normal">
                    {formatDateTime(n.createdAt)}
                  </span>
                </div>
                <p className="text-sm font-semibold text-[#15191E] dark:text-white">
                  {n.title}
                </p>
                <p className="text-xs text-[#525A63] dark:text-[#89919A]">{n.message}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate(n.relatedModule)}
                  className="h-8 px-2.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Open</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleRead(n)}
                  className="h-8 px-2.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
                >
                  {n.isRead ? 'Mark Unread' : 'Mark Read'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteNotification(n.id)}
                  aria-label={`Delete notification ${n.title}`}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-[#B4232A] dark:text-[#E56B6F] hover:bg-[#E56B6F]/15 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
