import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Printer,
  Download,
  Trash2,
  Eye,
  Receipt,
  CreditCard,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { downloadCsv, formatCurrency, formatShortDate } from '../lib/format';
import {
  buildCsvString,
  calculateAvailableStock,
  calculateSaleTotals,
  validateSaleItems,
} from '../utils/calculations';
import { Modal } from '../components/ui/Modal';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import type { BusinessSettings, Customer, Product, Sale, SaleStatus, User } from '../types';

interface SalesPageProps {
  sales: Sale[];
  products: Product[];
  customers: Customer[];
  settings: BusinessSettings;
  user: User;
  initialOpenCreate?: boolean;
  onClearInitialCreate?: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

interface DraftLine {
  productId: number;
  quantity: number;
  unitPrice: number;
}

export function SalesPage({
  sales,
  products,
  customers,
  settings,
  user,
  initialOpenCreate,
  onClearInitialCreate,
  onRefresh,
  onToast,
}: SalesPageProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SaleStatus>('all');
  const [createOpen, setCreateOpen] = useState(Boolean(initialOpenCreate));
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [paymentSale, setPaymentSale] = useState<Sale | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);

  const availableProducts = useMemo(
    () =>
      products.filter(
        (p) => p.status !== 'archived' && calculateAvailableStock(p.quantity, p.reservedQty) > 0
      ),
    [products]
  );

  const [customerId, setCustomerId] = useState<string>('');
  const [walkInName, setWalkInName] = useState('Walk-in Customer');
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'bank_transfer' | 'cash' | 'invoice'>('card');
  const [initialStatus, setInitialStatus] = useState<'paid' | 'pending' | 'partial'>('paid');
  const [initialPaidAmount, setInitialPaidAmount] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    availableProducts[0]
      ? [{ productId: availableProducts[0].id, quantity: 1, unitPrice: availableProducts[0].sellingPrice }]
      : []
  );
  const [submitting, setSubmitting] = useState(false);

  const canCreate = user.role === 'admin' || user.permissions.canCreateSales;

  useEffect(() => {
    if (initialOpenCreate) {
      openNewSale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenCreate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.invoiceNumber.toLowerCase().includes(q) ||
        s.customerName.toLowerCase().includes(q)
      );
    });
  }, [sales, search, statusFilter]);

  const totals = useMemo(
    () => calculateSaleTotals(lines, discountType, Number(discountValue) || 0, settings.taxRate),
    [lines, discountType, discountValue, settings.taxRate]
  );

  function openNewSale() {
    setCustomerId(customers[0] ? String(customers[0].id) : '');
    setWalkInName('Walk-in Customer');
    setPaymentMethod('card');
    setInitialStatus('paid');
    setInitialPaidAmount('');
    setDiscountType('percent');
    setDiscountValue('0');
    setNotes('');
    setLines(
      availableProducts[0]
        ? [{ productId: availableProducts[0].id, quantity: 1, unitPrice: availableProducts[0].sellingPrice }]
        : []
    );
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    onClearInitialCreate?.();
  }

  function addLine() {
    const first = availableProducts[0];
    if (!first) return;
    setLines((prev) => [...prev, { productId: first.id, quantity: 1, unitPrice: first.sellingPrice }]);
  }

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        if (patch.productId !== undefined) {
          const prod = products.find((p) => p.id === patch.productId);
          if (prod) next.unitPrice = prod.sellingPrice;
        }
        return next;
      })
    );
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleCreateSale(e: React.FormEvent) {
    e.preventDefault();
    const stockMap: Record<number, { name: string; quantity: number; reservedQty?: number }> = {};
    for (const p of products) {
      stockMap[p.id] = { name: p.name, quantity: p.quantity, reservedQty: p.reservedQty };
    }

    const validation = validateSaleItems(lines, stockMap);
    if (!validation.valid) {
      onToast('error', validation.error || 'Invalid invoice line items.');
      return;
    }

    const computedPaid =
      initialStatus === 'paid'
        ? totals.totalAmount
        : initialStatus === 'partial'
        ? Math.max(0, Math.min(totals.totalAmount, Number(initialPaidAmount) || 0))
        : 0;

    setSubmitting(true);
    try {
      const res = await apiRequest<{ id: number; invoiceNumber: string }>('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          customerId: customerId ? Number(customerId) : null,
          customerName: customerId ? undefined : walkInName.trim() || 'Walk-in Customer',
          discountType,
          discountValue: Number(discountValue) || 0,
          taxRate: settings.taxRate,
          paymentMethod,
          status: initialStatus,
          amountPaid: computedPaid,
          notes: notes.trim(),
          items: lines,
        }),
      });
      onToast('success', `Invoice ${res.invoiceNumber} created and stock updated.`);
      await onRefresh();
      closeCreate();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to create sale.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(
    sale: Sale,
    nextStatus: 'paid' | 'pending' | 'refunded' | 'cancelled'
  ) {
    try {
      await apiRequest(`/api/sales/${sale.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      onToast('success', `Invoice ${sale.invoiceNumber} marked as ${nextStatus}.`);
      if (selectedSale?.id === sale.id) setSelectedSale(null);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update status.');
    }
  }

  function openRecordPayment(sale: Sale) {
    const remaining = Math.max(0, Math.round((sale.totalAmount - sale.amountPaid) * 100) / 100);
    setPaymentSale(sale);
    setPaymentAmount(String(remaining));
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paymentSale) return;
    const amt = Number(paymentAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      onToast('error', 'Enter a valid payment amount greater than zero.');
      return;
    }
    setRecordingPayment(true);
    try {
      const res = await apiRequest<{ ok: boolean; amountPaid: number; status: SaleStatus }>(
        `/api/sales/${paymentSale.id}/payment`,
        {
          method: 'PATCH',
          body: JSON.stringify({ amount: amt }),
        }
      );
      onToast(
        'success',
        `Payment recorded on ${paymentSale.invoiceNumber} (${res.status}).`
      );
      setPaymentSale(null);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setRecordingPayment(false);
    }
  }

  function handleExportCsv() {
    const csv = buildCsvString(
      ['Invoice', 'Date', 'Customer', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Payment', 'Status'],
      filtered.map((s) => [
        s.invoiceNumber,
        s.createdAt.slice(0, 10),
        s.customerName,
        s.subtotal,
        s.discountAmount,
        s.taxAmount,
        s.totalAmount,
        s.amountPaid ?? 0,
        s.paymentMethod,
        s.status,
      ])
    );
    downloadCsv(`stockwise-sales-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    onToast('success', 'Sales ledger exported to CSV.');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search invoices"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice # or customer..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>

          <select
            aria-label="Filter sales status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
            <option value="refunded">Refunded</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="h-10 px-3.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>Print</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="h-10 px-3.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>

          {canCreate && (
            <button
              type="button"
              onClick={openNewSale}
              className="h-10 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>New Sale Invoice</span>
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No sales invoices found"
          description="Create your first customer invoice to record revenue and automatically deduct inventory."
          actionLabel={canCreate ? 'New Sale Invoice' : undefined}
          onAction={canCreate ? openNewSale : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                  <th className="px-4">Invoice #</th>
                  <th className="px-4">Date</th>
                  <th className="px-4">Customer</th>
                  <th className="px-4 text-right">Items</th>
                  <th className="px-4 text-right">Total</th>
                  <th className="px-4 text-right">Paid / Due</th>
                  <th className="px-4">Status</th>
                  <th className="px-4 text-right no-print">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {filtered.map((s) => {
                  const balanceDue = Math.max(0, Math.round((s.totalAmount - (s.amountPaid ?? 0)) * 100) / 100);
                  const canPayOrCancel = s.status !== 'refunded' && s.status !== 'cancelled';
                  return (
                    <tr key={s.id} className="h-14 hover:bg-[#F5F5F0]/60 dark:hover:bg-[#29323C]/50">
                      <td className="px-4 font-mono font-semibold text-[#15191E] dark:text-white">
                        {s.invoiceNumber}
                      </td>
                      <td className="px-4 text-[#89919A]">
                        {formatShortDate(s.createdAt, settings.dateFormat)}
                      </td>
                      <td className="px-4 font-medium">{s.customerName}</td>
                      <td className="px-4 text-right tabular-nums">
                        {(s.items ?? []).reduce((sum, i) => sum + i.quantity, 0)}
                      </td>
                      <td className="px-4 text-right font-bold tabular-nums text-[#15191E] dark:text-white">
                        {formatCurrency(s.totalAmount, settings.currency)}
                      </td>
                      <td className="px-4 text-right tabular-nums">
                        <p className="font-semibold text-[#28815F] dark:text-[#68B88A]">
                          {formatCurrency(s.amountPaid ?? 0, settings.currency)}
                        </p>
                        {balanceDue > 0 && canPayOrCancel && (
                          <p className="text-[11px] text-[#8F6314] dark:text-[#E6B65C]">
                            Due {formatCurrency(balanceDue, settings.currency)}
                          </p>
                        )}
                      </td>
                      <td className="px-4">
                        <StatusBadge variant={s.status} />
                      </td>
                      <td className="px-4 text-right no-print">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedSale(s)}
                            aria-label={`Inspect invoice ${s.invoiceNumber}`}
                            className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canCreate && (s.status === 'pending' || s.status === 'partial') && (
                            <button
                              type="button"
                              onClick={() => openRecordPayment(s)}
                              className="px-2 py-1 rounded-md bg-[#C5F36B]/30 text-[#2E5409] dark:text-[#C5F36B] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              <span>Pay</span>
                            </button>
                          )}
                          {canCreate && canPayOrCancel && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStatusChange(s, 'refunded')}
                                className="px-2 py-1 rounded-md bg-[#E56B6F]/15 text-[#B4232A] dark:text-[#E56B6F] font-semibold cursor-pointer whitespace-nowrap"
                              >
                                Refund
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStatusChange(s, 'cancelled')}
                                aria-label={`Cancel ${s.invoiceNumber}`}
                                title="Cancel invoice & restore stock"
                                className="p-1 rounded-md text-[#89919A] hover:text-[#B4232A] dark:hover:text-[#E56B6F] cursor-pointer"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Sale Invoice Modal */}
      <Modal
        open={createOpen}
        onClose={closeCreate}
        title="Create Sale Invoice"
        subtitle="Quantities are validated against available inventory and deducted immediately on confirmation."
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleCreateSale} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Customer</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              >
                <option value="">Walk-in Customer</option>
                {customers
                  .filter((c) => c.status !== 'archived')
                  .map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name} {c.company ? `(${c.company})` : ''}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => {
                  const nextMethod = e.target.value as typeof paymentMethod;
                  setPaymentMethod(nextMethod);
                  if (nextMethod === 'invoice') setInitialStatus('pending');
                }}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              >
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="invoice">Net-30 Invoice</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Payment Status</label>
              <select
                value={initialStatus}
                onChange={(e) => {
                  const nextSt = e.target.value as 'paid' | 'pending' | 'partial';
                  setInitialStatus(nextSt);
                  if (nextSt === 'partial' && !initialPaidAmount) {
                    setInitialPaidAmount(String(Math.round((totals.totalAmount / 2) * 100) / 100));
                  }
                }}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              >
                <option value="paid">Paid in Full</option>
                <option value="partial">Partial Payment</option>
                <option value="pending">Pending (Unpaid)</option>
              </select>
            </div>

            {!customerId && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1">Walk-in Label</label>
                <input
                  type="text"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
                />
              </div>
            )}

            {initialStatus === 'partial' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold mb-1">Initial Amount Paid</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={totals.totalAmount}
                  value={initialPaidAmount}
                  onChange={(e) => setInitialPaidAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                />
              </div>
            )}
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#89919A]">
                Invoice Items
              </h3>
              <button
                type="button"
                onClick={addLine}
                disabled={availableProducts.length === 0}
                className="px-2.5 py-1 rounded-md bg-[#15191E] text-[#C5F36B] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Line</span>
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((line, idx) => {
                const selectedProd = products.find((p) => p.id === line.productId);
                const avail = selectedProd
                  ? calculateAvailableStock(selectedProd.quantity, selectedProd.reservedQty)
                  : 1;
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C]"
                  >
                    <div className="col-span-12 sm:col-span-5">
                      <select
                        aria-label={`Product line ${idx + 1}`}
                        value={line.productId}
                        onChange={(e) => updateLine(idx, { productId: Number(e.target.value) })}
                        className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
                      >
                        {availableProducts.map((p) => {
                          const pAvail = calculateAvailableStock(p.quantity, p.reservedQty);
                          return (
                            <option key={p.id} value={p.id}>
                              {p.sku} — {p.name} ({pAvail} avail.)
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <input
                        type="number"
                        aria-label={`Quantity line ${idx + 1}`}
                        min={1}
                        max={avail}
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                        className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <input
                        type="number"
                        aria-label={`Price line ${idx + 1}`}
                        step="0.01"
                        min={0}
                        value={line.unitPrice}
                        onChange={(e) => updateLine(idx, { unitPrice: Math.max(0, Number(e.target.value)) })}
                        className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-2 text-right font-semibold text-xs tabular-nums">
                      {formatCurrency(line.quantity * line.unitPrice, settings.currency)}
                    </div>
                    <div className="col-span-1 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        aria-label={`Remove line ${idx + 1}`}
                        className="p-1 text-[#B4232A] dark:text-[#E56B6F] hover:bg-[#E56B6F]/15 rounded cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Discount & Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E2E4DF] dark:border-[#29323C]">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold mb-1">Discount Type</label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}
                    className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
                  >
                    <option value="percent">Percent (%)</option>
                    <option value="fixed">Fixed Amount</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Discount Value</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Invoice Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional shipping or PO reference..."
                  className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#89919A]">Subtotal</span>
                <span className="tabular-nums font-medium">
                  {formatCurrency(totals.subtotal, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#89919A]">Discount</span>
                <span className="tabular-nums font-medium text-[#B4232A] dark:text-[#E56B6F]">
                  -{formatCurrency(totals.discountAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#89919A]">Tax ({settings.taxRate}%)</span>
                <span className="tabular-nums font-medium">
                  {formatCurrency(totals.taxAmount, settings.currency)}
                </span>
              </div>
              <div className="pt-2 border-t border-[#E2E4DF] dark:border-[#29323C] flex justify-between text-sm font-bold">
                <span>Grand Total</span>
                <span className="tabular-nums">
                  {formatCurrency(totals.totalAmount, settings.currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeCreate}
              className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || lines.length === 0}
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Confirming...' : 'Confirm & Issue Invoice'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Payment Modal */}
      <Modal
        open={Boolean(paymentSale)}
        onClose={() => setPaymentSale(null)}
        title={paymentSale ? `Record Payment · ${paymentSale.invoiceNumber}` : 'Record Payment'}
        subtitle={paymentSale ? `Customer: ${paymentSale.customerName}` : undefined}
      >
        {paymentSale && (
          <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#89919A]">Invoice Total</span>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(paymentSale.totalAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#89919A]">Paid So Far</span>
                <span className="font-semibold tabular-nums text-[#28815F] dark:text-[#68B88A]">
                  {formatCurrency(paymentSale.amountPaid ?? 0, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-[#E2E4DF] dark:border-[#29323C] font-bold">
                <span>Remaining Balance</span>
                <span className="tabular-nums">
                  {formatCurrency(
                    Math.max(0, paymentSale.totalAmount - (paymentSale.amountPaid ?? 0)),
                    settings.currency
                  )}
                </span>
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">Payment Amount *</label>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                max={Math.max(0.01, paymentSale.totalAmount - (paymentSale.amountPaid ?? 0))}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPaymentSale(null)}
                className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={recordingPayment}
                className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
              >
                {recordingPayment ? 'Recording...' : 'Apply Payment'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Printable Invoice View Modal */}
      <Modal
        open={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
        title={selectedSale ? `Invoice ${selectedSale.invoiceNumber}` : 'Invoice'}
        maxWidthClass="max-w-2xl"
      >
        {selectedSale && (
          <div className="space-y-5 text-xs">
            <div className="flex items-start justify-between border-b border-[#E2E4DF] dark:border-[#29323C] pb-4">
              <div>
                <p className="text-base font-bold font-display text-[#15191E] dark:text-white">
                  {settings.companyName}
                </p>
                <p className="text-[#89919A]">{settings.address}</p>
                <p className="text-[#89919A]">
                  {settings.email} · {settings.phone}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono font-bold text-sm">{selectedSale.invoiceNumber}</p>
                <p className="text-[#89919A]">
                  {formatShortDate(selectedSale.createdAt, settings.dateFormat)}
                </p>
                <div className="mt-1">
                  <StatusBadge variant={selectedSale.status} />
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <div>
                <p className="text-[#89919A] uppercase text-[10px] font-bold">Billed To</p>
                <p className="font-semibold text-sm mt-0.5">{selectedSale.customerName}</p>
                {selectedSale.customerEmail && (
                  <p className="text-[#89919A]">{selectedSale.customerEmail}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[#89919A] uppercase text-[10px] font-bold">Payment</p>
                <p className="font-semibold capitalize mt-0.5">
                  {selectedSale.paymentMethod.replace('_', ' ')}
                </p>
              </div>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] uppercase text-[#89919A]">
                  <th className="py-2">Item</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
                {(selectedSale.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td className="py-2.5">
                      <p className="font-medium">{item.productName}</p>
                      <p className="text-[11px] font-mono text-[#89919A]">{item.sku}</p>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {formatCurrency(item.unitPrice, settings.currency)}
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">
                      {formatCurrency(item.lineTotal, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto max-w-xs space-y-1.5 pt-3 border-t border-[#E2E4DF] dark:border-[#29323C]">
              <div className="flex justify-between">
                <span className="text-[#89919A]">Subtotal</span>
                <span className="tabular-nums">
                  {formatCurrency(selectedSale.subtotal, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#89919A]">Discount</span>
                <span className="tabular-nums">
                  -{formatCurrency(selectedSale.discountAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#89919A]">Tax ({selectedSale.taxRate}%)</span>
                <span className="tabular-nums">
                  {formatCurrency(selectedSale.taxAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[#E2E4DF] dark:border-[#29323C]">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatCurrency(selectedSale.totalAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-[#28815F] dark:text-[#68B88A]">
                <span>Amount Paid</span>
                <span className="tabular-nums font-semibold">
                  {formatCurrency(selectedSale.amountPaid ?? 0, settings.currency)}
                </span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="h-9 px-4 rounded-lg bg-[#15191E] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Print Invoice</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
