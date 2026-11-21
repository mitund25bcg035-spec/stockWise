import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  ClipboardCheck,
  Eye,
  Trash2,
  ClipboardList,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { calculatePurchaseTotalsWithTaxDiscount } from '../utils/calculations';
import { Modal } from '../components/ui/Modal';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import type { BusinessSettings, Product, Purchase, PurchaseStatus, Supplier, User } from '../types';

interface PurchasesPageProps {
  purchases: Purchase[];
  suppliers: Supplier[];
  products: Product[];
  settings: BusinessSettings;
  user: User;
  initialOpenCreate?: boolean;
  onClearInitialCreate?: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

interface DraftPOLine {
  productId: number;
  quantity: number;
  unitCost: number;
}

export function PurchasesPage({
  purchases,
  suppliers,
  products,
  settings,
  user,
  initialOpenCreate,
  onClearInitialCreate,
  onRefresh,
  onToast,
}: PurchasesPageProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PurchaseStatus>('all');
  const [createOpen, setCreateOpen] = useState(Boolean(initialOpenCreate));
  const [selectedPo, setSelectedPo] = useState<Purchase | null>(null);
  const [receivePo, setReceivePo] = useState<Purchase | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<number, number>>({});
  const [receiving, setReceiving] = useState(false);

  const activeSuppliers = useMemo(
    () => suppliers.filter((s) => s.status !== 'archived'),
    [suppliers]
  );

  const [supplierId, setSupplierId] = useState<string>(
    activeSuppliers[0] ? String(activeSuppliers[0].id) : ''
  );
  const [status, setStatus] = useState<'draft' | 'pending' | 'ordered' | 'received'>('ordered');
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().slice(0, 10);
  });
  const [discountAmount, setDiscountAmount] = useState('0');
  const [taxRate, setTaxRate] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftPOLine[]>(() =>
    products[0] ? [{ productId: products[0].id, quantity: 10, unitCost: products[0].purchasePrice }] : []
  );
  const [submitting, setSubmitting] = useState(false);

  const canManage = user.role === 'admin' || user.permissions.canManagePurchases;

  useEffect(() => {
    if (initialOpenCreate) {
      openCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenCreate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchases.filter((po) => {
      if (statusFilter !== 'all' && po.status !== statusFilter) return false;
      if (!q) return true;
      return po.poNumber.toLowerCase().includes(q) || po.supplierName.toLowerCase().includes(q);
    });
  }, [purchases, search, statusFilter]);

  const poTotals = useMemo(
    () =>
      calculatePurchaseTotalsWithTaxDiscount(
        lines,
        Number(discountAmount) || 0,
        Number(taxRate) || 0
      ),
    [lines, discountAmount, taxRate]
  );

  function openCreate() {
    setSupplierId(activeSuppliers[0] ? String(activeSuppliers[0].id) : '');
    setStatus('ordered');
    setDiscountAmount('0');
    setTaxRate('0');
    setNotes('');
    setLines(
      products[0] ? [{ productId: products[0].id, quantity: 10, unitCost: products[0].purchasePrice }] : []
    );
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    onClearInitialCreate?.();
  }

  function addLine() {
    const p = products[0];
    if (!p) return;
    setLines((prev) => [...prev, { productId: p.id, quantity: 10, unitCost: p.purchasePrice }]);
  }

  function updateLine(idx: number, patch: Partial<DraftPOLine>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        if (patch.productId !== undefined) {
          const p = products.find((item) => item.id === patch.productId);
          if (p) next.unitCost = p.purchasePrice;
        }
        return next;
      })
    );
  }

  async function handleCreatePO(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) {
      onToast('error', 'Select a supplier.');
      return;
    }
    if (lines.length === 0) {
      onToast('error', 'Add at least one product to the purchase order.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ id: number; poNumber: string }>('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: Number(supplierId),
          status,
          expectedDate: expectedDate || null,
          discountAmount: Number(discountAmount) || 0,
          taxRate: Number(taxRate) || 0,
          notes: notes.trim(),
          items: lines,
        }),
      });
      onToast(
        'success',
        status === 'received'
          ? `Purchase ${res.poNumber} received and stock added.`
          : `Purchase order ${res.poNumber} created.`
      );
      await onRefresh();
      closeCreate();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to create purchase order.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusUpdate(po: Purchase, nextStatus: PurchaseStatus) {
    try {
      await apiRequest(`/api/purchases/${po.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      onToast(
        'success',
        nextStatus === 'received'
          ? `${po.poNumber} marked Received — inventory quantities updated.`
          : `${po.poNumber} updated to ${nextStatus.replace('_', ' ')}.`
      );
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update purchase order.');
    }
  }

  function openReceiveModal(po: Purchase) {
    const initial: Record<number, number> = {};
    for (const item of po.items ?? []) {
      const remaining = Math.max(0, item.quantity - (item.receivedQty ?? 0));
      initial[item.id] = remaining;
    }
    setReceiveQtys(initial);
    setReceivePo(po);
  }

  async function handleReceiveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!receivePo) return;
    const payloadItems = (receivePo.items ?? [])
      .map((item) => ({
        purchaseItemId: item.id,
        receiveQty: Math.max(0, Math.trunc(receiveQtys[item.id] ?? 0)),
      }))
      .filter((it) => it.receiveQty > 0);

    if (payloadItems.length === 0) {
      onToast('error', 'Enter at least 1 unit to receive.');
      return;
    }

    setReceiving(true);
    try {
      const res = await apiRequest<{ ok: boolean; status: PurchaseStatus }>(
        `/api/purchases/${receivePo.id}/receive`,
        {
          method: 'POST',
          body: JSON.stringify({ items: payloadItems }),
        }
      );
      onToast(
        'success',
        res.status === 'received'
          ? `${receivePo.poNumber} fully received into inventory.`
          : `${receivePo.poNumber} partially received — remaining items stay open.`
      );
      setReceivePo(null);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to receive purchase items.');
    } finally {
      setReceiving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search purchase orders"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PO # or supplier..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>

          <select
            aria-label="Filter purchase status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending Approval</option>
            <option value="ordered">Ordered</option>
            <option value="partially_received">Partially Received</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="h-10 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create Purchase Order</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No purchase orders found"
          description="Create purchase orders to replenish stock from your suppliers. Inventory updates as shipments are received."
          actionLabel={canManage ? 'Create Purchase Order' : undefined}
          onAction={canManage ? openCreate : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                  <th className="px-4">PO Number</th>
                  <th className="px-4">Supplier</th>
                  <th className="px-4">Expected Date</th>
                  <th className="px-4 text-right">Received</th>
                  <th className="px-4 text-right">Total Cost</th>
                  <th className="px-4">Status</th>
                  <th className="px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {filtered.map((po) => {
                  const orderedUnits = (po.items ?? []).reduce((s, i) => s + i.quantity, 0);
                  const receivedUnits = (po.items ?? []).reduce(
                    (s, i) => s + (i.receivedQty ?? (po.status === 'received' ? i.quantity : 0)),
                    0
                  );
                  const canReceive =
                    po.status !== 'received' && po.status !== 'cancelled' && (po.items?.length ?? 0) > 0;
                  return (
                    <tr key={po.id} className="h-14 hover:bg-[#F5F5F0]/60 dark:hover:bg-[#29323C]/50">
                      <td className="px-4 font-mono font-semibold text-[#15191E] dark:text-white">
                        {po.poNumber}
                      </td>
                      <td className="px-4 font-medium">{po.supplierName}</td>
                      <td className="px-4 text-[#89919A]">
                        {formatShortDate(po.expectedDate, settings.dateFormat)}
                      </td>
                      <td className="px-4 text-right tabular-nums text-[#89919A]">
                        {receivedUnits} / {orderedUnits}
                      </td>
                      <td className="px-4 text-right font-bold tabular-nums">
                        {formatCurrency(po.totalAmount, settings.currency)}
                      </td>
                      <td className="px-4">
                        <StatusBadge variant={po.status} />
                      </td>
                      <td className="px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedPo(po)}
                            aria-label={`Inspect ${po.poNumber}`}
                            className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canManage && (po.status === 'draft' || po.status === 'pending') && (
                            <button
                              type="button"
                              onClick={() => handleStatusUpdate(po, 'ordered')}
                              className="px-2.5 py-1 rounded-md bg-[#202832] text-white dark:bg-[#29323C] font-semibold cursor-pointer whitespace-nowrap"
                            >
                              Place Order
                            </button>
                          )}
                          {canManage && canReceive && (
                            <button
                              type="button"
                              onClick={() => openReceiveModal(po)}
                              className="px-2.5 py-1 rounded-md bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              <span>Receive Goods</span>
                            </button>
                          )}
                          {canManage &&
                            po.status !== 'received' &&
                            po.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleStatusUpdate(po, 'cancelled')}
                                aria-label={`Cancel ${po.poNumber}`}
                                title="Cancel purchase order"
                                className="p-1 rounded-md text-[#89919A] hover:text-[#B4232A] dark:hover:text-[#E56B6F] cursor-pointer"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
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

      {/* Create Purchase Order Modal */}
      <Modal
        open={createOpen}
        onClose={closeCreate}
        title="Create Purchase Order"
        subtitle="Inventory quantities increment as items are received."
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleCreatePO} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Supplier *</label>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              >
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Initial Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              >
                <option value="draft">Draft</option>
                <option value="pending">Pending Approval</option>
                <option value="ordered">Ordered (In Transit)</option>
                <option value="received">Received Immediately</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Expected Delivery Date</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#89919A]">
                Order Line Items
              </h3>
              <button
                type="button"
                onClick={addLine}
                className="px-2.5 py-1 rounded-md bg-[#15191E] text-[#C5F36B] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add SKU</span>
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C]"
                >
                  <div className="col-span-12 sm:col-span-5">
                    <select
                      value={line.productId}
                      onChange={(e) => updateLine(idx, { productId: Number(e.target.value) })}
                      className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateLine(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                      className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={line.unitCost}
                      onChange={(e) => updateLine(idx, { unitCost: Math.max(0, Number(e.target.value)) })}
                      className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-right text-xs font-semibold tabular-nums">
                    {formatCurrency(line.quantity * line.unitCost, settings.currency)}
                  </div>
                  <div className="col-span-1 text-right">
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="Remove line"
                      className="p-1 text-[#B4232A] dark:text-[#E56B6F] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#E2E4DF] dark:border-[#29323C]">
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold mb-1">Vendor Discount</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Import / Tax (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="50"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs tabular-nums"
                  />
                </div>
              </div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Receiving bay or vendor notes..."
                className="w-full h-9 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              />
            </div>

            <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#89919A]">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(poTotals.subtotal, settings.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#89919A]">Discount</span>
                <span className="tabular-nums">-{formatCurrency(poTotals.discountAmount, settings.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#89919A]">Tax ({Number(taxRate) || 0}%)</span>
                <span className="tabular-nums">{formatCurrency(poTotals.taxAmount, settings.currency)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-[#E2E4DF] dark:border-[#29323C]">
                <span>Order Total</span>
                <span className="tabular-nums">{formatCurrency(poTotals.totalAmount, settings.currency)}</span>
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
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
            >
              {submitting ? 'Saving...' : 'Save Purchase Order'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Partial / Full Receive Goods Modal */}
      <Modal
        open={Boolean(receivePo)}
        onClose={() => setReceivePo(null)}
        title={receivePo ? `Receive Shipment · ${receivePo.poNumber}` : 'Receive Goods'}
        subtitle={
          receivePo
            ? `${receivePo.supplierName} — enter units arriving in this delivery.`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {receivePo && (
          <form onSubmit={handleReceiveSubmit} className="space-y-4 text-xs">
            <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] border border-[#E2E4DF] dark:border-[#29323C] rounded-xl overflow-hidden">
              {(receivePo.items ?? []).map((item) => {
                const already = item.receivedQty ?? 0;
                const remaining = Math.max(0, item.quantity - already);
                return (
                  <div
                    key={item.id}
                    className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#15191E]"
                  >
                    <div>
                      <p className="font-semibold text-[#15191E] dark:text-white">
                        {item.productName}
                      </p>
                      <p className="font-mono text-[#89919A]">
                        {item.sku} · Ordered {item.quantity} · Already Received {already} · Remaining{' '}
                        <strong>{remaining}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="text-[#89919A]">Receive Now:</label>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        disabled={remaining === 0}
                        value={receiveQtys[item.id] ?? 0}
                        onChange={(e) =>
                          setReceiveQtys((prev) => ({
                            ...prev,
                            [item.id]: Math.max(0, Math.min(remaining, Math.trunc(Number(e.target.value)))),
                          }))
                        }
                        className="w-24 h-9 px-2.5 rounded-lg bg-[#F5F5F0] dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold tabular-nums"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReceivePo(null)}
                className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={receiving}
                className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
              >
                {receiving ? 'Updating Stock...' : 'Confirm Receipt & Add Stock'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* PO Detail Modal */}
      <Modal
        open={Boolean(selectedPo)}
        onClose={() => setSelectedPo(null)}
        title={selectedPo ? `Purchase Order ${selectedPo.poNumber}` : 'Purchase Order'}
        subtitle={selectedPo?.supplierName}
      >
        {selectedPo && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <StatusBadge variant={selectedPo.status} />
              <span className="text-[#89919A]">
                Expected {formatShortDate(selectedPo.expectedDate, settings.dateFormat)}
              </span>
            </div>

            <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] border border-[#E2E4DF] dark:border-[#29323C] rounded-xl px-3">
              {(selectedPo.items ?? []).map((item) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{item.productName}</p>
                    <p className="font-mono text-[#89919A]">
                      {item.sku} · Received {item.receivedQty ?? (selectedPo.status === 'received' ? item.quantity : 0)} / {item.quantity}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p>
                      {item.quantity} × {formatCurrency(item.unitCost, settings.currency)}
                    </p>
                    <p className="font-bold">
                      {formatCurrency(item.lineTotal, settings.currency)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1 pt-2 border-t border-[#E2E4DF] dark:border-[#29323C]">
              <div className="flex justify-between text-[#89919A]">
                <span>Subtotal</span>
                <span className="tabular-nums">
                  {formatCurrency(selectedPo.subtotal ?? selectedPo.totalAmount, settings.currency)}
                </span>
              </div>
              {(selectedPo.discountAmount ?? 0) > 0 && (
                <div className="flex justify-between text-[#89919A]">
                  <span>Discount</span>
                  <span className="tabular-nums">
                    -{formatCurrency(selectedPo.discountAmount, settings.currency)}
                  </span>
                </div>
              )}
              {(selectedPo.taxAmount ?? 0) > 0 && (
                <div className="flex justify-between text-[#89919A]">
                  <span>Tax ({selectedPo.taxRate}%)</span>
                  <span className="tabular-nums">
                    {formatCurrency(selectedPo.taxAmount, settings.currency)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1.5 font-bold text-sm">
                <span>Total Purchase Cost</span>
                <span className="tabular-nums">
                  {formatCurrency(selectedPo.totalAmount, settings.currency)}
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
