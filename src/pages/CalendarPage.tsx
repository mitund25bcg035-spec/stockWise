import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatShortDate } from '../lib/format';
import { Modal } from '../components/ui/Modal';
import type { BusinessSettings, CalendarEvent, CalendarEventType, Purchase, Sale } from '../types';

interface CalendarPageProps {
  events: CalendarEvent[];
  purchases: Purchase[];
  sales: Sale[];
  settings: BusinessSettings;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const TYPE_STYLES: Record<CalendarEventType, { label: string; badge: string }> = {
  reminder: { label: 'Reminder', badge: 'bg-[#29323C]/15 text-[#202832] dark:bg-[#29323C] dark:text-[#E5E8EC]' },
  delivery: { label: 'Delivery', badge: 'bg-[#68B88A]/20 text-[#1F5E3B] dark:text-[#68B88A]' },
  purchase: { label: 'Purchase', badge: 'bg-[#C5F36B]/30 text-[#2E5409] dark:text-[#C5F36B]' },
  sale: { label: 'Sale', badge: 'bg-[#5B8DEF]/20 text-[#1B3A5C] dark:text-[#8FB4FF]' },
  stock_audit: { label: 'Stock Audit', badge: 'bg-[#E6B65C]/25 text-[#7A510A] dark:text-[#E6B65C]' },
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function CalendarPage({
  events,
  purchases,
  sales,
  settings,
  onRefresh,
  onToast,
}: CalendarPageProps) {
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(() => toIsoDate(new Date()));
  const [eventType, setEventType] = useState<CalendarEventType>('reminder');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Merge manual reminders with live Purchase expected deliveries & Sale dates
  const combinedItems = useMemo(() => {
    const list: Array<{
      key: string;
      id?: number;
      title: string;
      date: string;
      type: CalendarEventType;
      notes: string;
      completed: boolean;
      editable: boolean;
      raw?: CalendarEvent;
    }> = events.map((ev) => ({
      key: `ev-${ev.id}`,
      id: ev.id,
      title: ev.title,
      date: ev.eventDate,
      type: ev.eventType,
      notes: ev.notes,
      completed: ev.completed,
      editable: true,
      raw: ev,
    }));

    for (const po of purchases) {
      if (po.expectedDate && po.status !== 'cancelled') {
        list.push({
          key: `po-${po.id}`,
          title: `PO ${po.poNumber} · ${po.supplierName}`,
          date: po.expectedDate.slice(0, 10),
          type: po.status === 'received' ? 'purchase' : 'delivery',
          notes: `Status: ${po.status.replace('_', ' ')}`,
          completed: po.status === 'received',
          editable: false,
        });
      }
    }

    for (const s of sales.slice(0, 18)) {
      list.push({
        key: `sale-${s.id}`,
        title: `Sale ${s.invoiceNumber} · ${s.customerName}`,
        date: s.createdAt.slice(0, 10),
        type: 'sale',
        notes: s.status,
        completed: s.status === 'paid',
        editable: false,
      });
    }

    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [events, purchases, sales]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const calendarCells = useMemo(() => {
    const cells: Array<{ day: number | null; dateStr: string }> = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, dateStr: '' });
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(month + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      cells.push({ day: d, dateStr: `${year}-${mStr}-${dStr}` });
    }
    return cells;
  }, [year, month, firstWeekday, daysInMonth]);

  const weekDays = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return {
        date: d,
        dateStr: toIsoDate(d),
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      };
    });
  }, [cursor]);

  const activeDayStr = toIsoDate(cursor);
  const todayStr = toIsoDate(new Date());

  function stepCursor(dir: -1 | 1) {
    const next = new Date(cursor);
    if (viewMode === 'month') {
      next.setMonth(cursor.getMonth() + dir);
    } else if (viewMode === 'week') {
      next.setDate(cursor.getDate() + dir * 7);
    } else {
      next.setDate(cursor.getDate() + dir);
    }
    setCursor(next);
  }

  function openCreate(presetDate?: string) {
    setEditing(null);
    setTitle('');
    setEventDate(presetDate || activeDayStr);
    setEventType('reminder');
    setNotes('');
    setFormOpen(true);
  }

  function openEdit(ev: CalendarEvent) {
    setEditing(ev);
    setTitle(ev.title);
    setEventDate(ev.eventDate);
    setEventType(ev.eventType);
    setNotes(ev.notes);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !eventDate) {
      onToast('error', 'Title and date are required.');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await apiRequest(`/api/calendar/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: title.trim(), eventDate, eventType, notes: notes.trim() }),
        });
        onToast('success', 'Reminder updated.');
      } else {
        await apiRequest('/api/calendar', {
          method: 'POST',
          body: JSON.stringify({ title: title.trim(), eventDate, eventType, notes: notes.trim() }),
        });
        onToast('success', 'Calendar reminder added.');
      }
      await onRefresh();
      setFormOpen(false);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save event.');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleCompleted(ev: CalendarEvent) {
    try {
      await apiRequest(`/api/calendar/${ev.id}`, {
        method: 'PUT',
        body: JSON.stringify({ completed: !ev.completed }),
      });
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update event.');
    }
  }

  async function handleDelete(id: number) {
    try {
      await apiRequest(`/api/calendar/${id}`, { method: 'DELETE' });
      onToast('success', 'Reminder deleted.');
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to delete event.');
    }
  }

  const headerTitle =
    viewMode === 'month'
      ? cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : viewMode === 'week'
      ? `${weekDays[0].label} – ${weekDays[6].label}`
      : cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Main Calendar View */}
      <div className="xl:col-span-8 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepCursor(-1)}
              aria-label="Previous period"
              className="w-8 h-8 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-base font-bold font-display min-w-[170px] text-center">
              {headerTitle}
            </h2>
            <button
              type="button"
              onClick={() => stepCursor(1)}
              aria-label="Next period"
              className="w-8 h-8 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex p-1 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C]">
              {(
                [
                  ['month', 'Month'],
                  ['week', 'Week'],
                  ['day', 'Day'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap ${
                    viewMode === mode
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
              onClick={() => openCreate()}
              className="h-9 px-3.5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Reminder</span>
            </button>
          </div>
        </div>

        {viewMode === 'month' && (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-[#89919A] mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {calendarCells.map((cell, idx) => {
                if (!cell.day) {
                  return <div key={idx} className="min-h-[84px] rounded-lg bg-[#F5F5F0]/50 dark:bg-[#15191E]/40" />;
                }
                const dayEvents = combinedItems.filter((item) => item.date === cell.dateStr);
                const isToday = cell.dateStr === todayStr;
                return (
                  <div
                    key={cell.dateStr}
                    className={`min-h-[84px] p-1.5 rounded-lg border text-left flex flex-col justify-between ${
                      isToday
                        ? 'border-[#15191E] dark:border-[#C5F36B] bg-[#C5F36B]/15'
                        : 'border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#15191E]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold tabular-nums">{cell.day}</span>
                      <button
                        type="button"
                        onClick={() => openCreate(cell.dateStr)}
                        aria-label={`Add reminder on ${cell.dateStr}`}
                        className="text-[11px] text-[#89919A] hover:text-[#15191E] dark:hover:text-white px-1 cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                    <div className="space-y-1 mt-1">
                      {dayEvents.slice(0, 2).map((item) => (
                        <div
                          key={item.key}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium truncate ${
                            TYPE_STYLES[item.type].badge
                          } ${item.completed ? 'line-through opacity-60' : ''}`}
                          title={item.title}
                        >
                          {item.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <p className="text-[10px] text-[#89919A] px-1">+{dayEvents.length - 2} more</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {viewMode === 'week' && (
          <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
            {weekDays.map((wd) => {
              const dayEvents = combinedItems.filter((item) => item.date === wd.dateStr);
              const isToday = wd.dateStr === todayStr;
              return (
                <div
                  key={wd.dateStr}
                  className={`min-h-[260px] p-2.5 rounded-xl border flex flex-col ${
                    isToday
                      ? 'border-[#15191E] dark:border-[#C5F36B] bg-[#C5F36B]/10'
                      : 'border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0]/50 dark:bg-[#15191E]'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E2E4DF] dark:border-[#29323C]">
                    <span className="text-[11px] font-bold">{wd.label}</span>
                    <button
                      type="button"
                      onClick={() => openCreate(wd.dateStr)}
                      className="text-xs text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {dayEvents.length === 0 ? (
                      <p className="text-[11px] text-[#89919A]">No events</p>
                    ) : (
                      dayEvents.map((item) => (
                        <div
                          key={item.key}
                          className={`p-2 rounded-lg text-[11px] ${TYPE_STYLES[item.type].badge} ${
                            item.completed ? 'line-through opacity-60' : ''
                          }`}
                        >
                          <p className="font-semibold leading-snug">{item.title}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {viewMode === 'day' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
              <p className="text-xs font-semibold">
                Schedule for {formatShortDate(activeDayStr, settings.dateFormat)}
              </p>
              <button
                type="button"
                onClick={() => openCreate(activeDayStr)}
                className="text-xs font-semibold text-[#2E5409] dark:text-[#C5F36B] cursor-pointer"
              >
                + Add for this day
              </button>
            </div>
            {combinedItems.filter((item) => item.date === activeDayStr).length === 0 ? (
              <p className="text-xs text-[#89919A] py-8 text-center">
                No deliveries, invoices, or reminders scheduled for this date.
              </p>
            ) : (
              <div className="space-y-2">
                {combinedItems
                  .filter((item) => item.date === activeDayStr)
                  .map((item) => (
                    <div
                      key={item.key}
                      className="p-3.5 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-between gap-3"
                    >
                      <div>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold mb-1 ${
                            TYPE_STYLES[item.type].badge
                          }`}
                        >
                          {TYPE_STYLES[item.type].label}
                        </span>
                        <p className="text-sm font-semibold">{item.title}</p>
                        {item.notes && <p className="text-xs text-[#89919A]">{item.notes}</p>}
                      </div>
                      {item.editable && item.raw && (
                        <button
                          type="button"
                          onClick={() => toggleCompleted(item.raw!)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] cursor-pointer"
                        >
                          {item.completed ? 'Completed' : 'Mark Complete'}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reminders & Scheduled Operations List */}
      <div className="xl:col-span-4 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
        <h2 className="text-base font-semibold font-display mb-1">Operational Schedule</h2>
        <p className="text-xs text-[#89919A] mb-4">Deliveries, purchases, sales, and reminders</p>

        <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
          {combinedItems.map((item) => (
            <div
              key={item.key}
              className="p-3 rounded-xl border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0]/70 dark:bg-[#15191E] flex items-start justify-between gap-2"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                {item.editable && item.raw && (
                  <button
                    type="button"
                    onClick={() => toggleCompleted(item.raw!)}
                    aria-label={`Toggle completion for ${item.title}`}
                    className="mt-0.5 text-[#2E5409] dark:text-[#C5F36B] cursor-pointer shrink-0"
                  >
                    {item.completed ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </button>
                )}
                <div className="min-w-0">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold mb-1 ${
                      TYPE_STYLES[item.type].badge
                    }`}
                  >
                    {TYPE_STYLES[item.type].label}
                  </span>
                  <p
                    className={`text-xs font-semibold ${
                      item.completed ? 'line-through text-[#89919A]' : ''
                    }`}
                  >
                    {item.title}
                  </p>
                  <p className="text-[11px] text-[#89919A]">
                    {formatShortDate(item.date, settings.dateFormat)}
                    {item.notes ? ` · ${item.notes}` : ''}
                  </p>
                </div>
              </div>

              {item.editable && item.raw && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(item.raw!)}
                    aria-label={`Edit ${item.title}`}
                    className="p-1 text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.raw!.id)}
                    aria-label={`Delete ${item.title}`}
                    className="p-1 text-[#B4232A] dark:text-[#E56B6F] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit Event Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Reminder' : 'Add Business Reminder'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">Title *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Quarterly Stock Audit"
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Date *</label>
              <input
                type="date"
                required
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Category</label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value as CalendarEventType)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              >
                <option value="reminder">Business Reminder</option>
                <option value="delivery">Expected Delivery</option>
                <option value="purchase">Purchase Date</option>
                <option value="stock_audit">Stock Update / Audit</option>
                <option value="sale">Sales Activity</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
            >
              {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Reminder'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
