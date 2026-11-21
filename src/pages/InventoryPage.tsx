import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  Search,
  AlertTriangle,
  RotateCcw,
  PackageX,
  ArrowRightLeft,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrency, formatDateTime } from '../lib/format';
import {
  calculateAvailableStock,
  calculateInventoryValuation,
  getStockStatus,
} from '../utils/calculations';
import { Modal } from '../components/ui/Modal';
import { StatusBadge } from '../components/ui/StatusBadge';
import type { BusinessSettings, Product, StockMovement, User } from '../types';

type AdjustType = 'stock_in' | 'stock_out' | 'adjustment' | 'return' | 'damaged' | 'transfer';

interface InventoryPageProps {
  products: Product[];
  movements: StockMovement[];
  settings: BusinessSettings;
  user: User;
  initialOpenAdjust?: boolean;
  onClearInitialAdjust?: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function InventoryPage({
  products,
  movements,
  settings,
  user,
  initialOpenAdjust,
  onClearInitialAdjust,
  onRefresh,
  onToast,
}: InventoryPageProps) {
  const [tab, setTab] = useState<'stock' | 'movements' | 'alerts'>('stock');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(Boolean(initialOpenAdjust));
  const [txType, setTxType] = useState<AdjustType>('stock_in');
  const [productId, setProductId] = useState<string>(products[0] ? String(products[0].id) : '');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canAdjust = user.role === 'admin' || user.permissions.canAdjustInventory;
  const activeProducts = useMemo(
    () => products.filter((p) => p.status !== 'archived'),
    [products]
  );
  const valuation = useMemo(() => calculateInventoryValuation(activeProducts), [activeProducts]);

  useEffect(() => {
    if (initialOpenAdjust) {
      openTransactionModal('stock_in');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenAdjust]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeProducts.filter((p) => {
      if (tab === 'alerts' && getStockStatus(p.quantity, p.minStock) === 'in_stock') return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    });
  }, [activeProducts, search, tab]);

  const filteredMovements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return movements;
    return movements.filter(
      (m) =>
        (m.productName ?? '').toLowerCase().includes(q) ||
        (m.productSku ?? '').toLowerCase().includes(q) ||
        m.reason.toLowerCase().includes(q) ||
        m.referenceCode.toLowerCase().includes(q)
    );
  }, [movements, search]);

  function openTransactionModal(type: AdjustType, presetProductId?: number) {
    setTxType(type);
    setProductId(
      presetProductId ? String(presetProductId) : activeProducts[0] ? String(activeProducts[0].id) : ''
    );
    setQuantity(type === 'adjustment' ? '1' : '5');
    setReason('');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    onClearInitialAdjust?.();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pid = Number(productId);
    const qty = Math.trunc(Number(quantity));
    if (!pid) {
      onToast('error', 'Select a product.');
      return;
    }
    if (!reason.trim()) {
      onToast('error', 'Enter a reason for this stock movement.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('/api/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({
          productId: pid,
          type: txType,
          quantity: qty,
          reason: reason.trim(),
        }),
      });
      onToast('success', 'Inventory updated and movement logged.');
      await onRefresh();
      closeModal();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Stock adjustment failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Valuation Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#89919A]">
            Cost Valuation
          </p>
          <p className="mt-1 text-2xl font-bold font-display tabular-nums">
            {formatCurrency(valuation.totalCostValue, settings.currency)}
          </p>
        </div>
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#89919A]">
            Retail Valuation
          </p>
          <p className="mt-1 text-2xl font-bold font-display tabular-nums">
            {formatCurrency(valuation.totalRetailValue, settings.currency)}
          </p>
        </div>
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#89919A]">
            Units On Hand
          </p>
          <p className="mt-1 text-2xl font-bold font-display tabular-nums">
            {valuation.totalUnits.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex p-1 rounded-lg bg-[#E9E9E2] dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C]">
            {(
              [
                ['stock', 'Current Stock'],
                ['alerts', 'Low & Empty Alerts'],
                ['movements', 'Movement Ledger'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  tab === id
                    ? 'bg-[#15191E] text-[#C5F36B] dark:bg-[#C5F36B] dark:text-[#15191E]'
                    : 'text-[#5C646D] dark:text-[#89919A]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Filter inventory"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU, product, reason..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>
        </div>

        {canAdjust && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openTransactionModal('stock_in')}
              className="h-9 px-3 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowDownToLine className="w-3.5 h-3.5" />
              <span>Stock In</span>
            </button>
            <button
              type="button"
              onClick={() => openTransactionModal('stock_out')}
              className="h-9 px-3 rounded-lg bg-[#15191E] hover:bg-[#202832] dark:bg-[#29323C] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" />
              <span>Stock Out</span>
            </button>
            <button
              type="button"
              onClick={() => openTransactionModal('return')}
              className="h-9 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Return</span>
            </button>
            <button
              type="button"
              onClick={() => openTransactionModal('damaged')}
              className="h-9 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <PackageX className="w-3.5 h-3.5" />
              <span>Damaged</span>
            </button>
            <button
              type="button"
              onClick={() => openTransactionModal('transfer')}
              className="h-9 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer</span>
            </button>
            <button
              type="button"
              onClick={() => openTransactionModal('adjustment')}
              className="h-9 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Adjustment</span>
            </button>
          </div>
        )}
      </div>

      {/* Table Content */}
      {tab === 'movements' ? (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                  <th className="px-4">Date</th>
                  <th className="px-4">Product</th>
                  <th className="px-4">Type</th>
                  <th className="px-4 text-right">Delta</th>
                  <th className="px-4 text-right">Before → After</th>
                  <th className="px-4">Reason &amp; Reference</th>
                  <th className="px-4">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {filteredMovements.map((m) => (
                  <tr key={m.id} className="h-12 hover:bg-[#F9F9F6] dark:hover:bg-[#29323C]/50">
                    <td className="px-4 text-[#89919A] whitespace-nowrap">
                      {formatDateTime(m.createdAt)}
                    </td>
                    <td className="px-4">
                      <p className="font-semibold">{m.productName}</p>
                      <p className="text-[11px] font-mono text-[#89919A]">{m.productSku}</p>
                    </td>
                    <td className="px-4 capitalize text-[#5C646D] dark:text-[#89919A]">
                      {m.type.replace('_', ' ')}
                    </td>
                    <td
                      className={`px-4 text-right font-bold tabular-nums ${
                        m.quantityDelta >= 0 ? 'text-[#68B88A]' : 'text-[#E56B6F]'
                      }`}
                    >
                      {m.quantityDelta >= 0 ? '+' : ''}
                      {m.quantityDelta}
                    </td>
                    <td className="px-4 text-right tabular-nums text-[#89919A]">
                      {m.previousQty} → <strong className="text-[#15191E] dark:text-white">{m.newQty}</strong>
                    </td>
                    <td className="px-4">
                      <span>{m.reason}</span>
                      {m.referenceCode && (
                        <span className="ml-2 font-mono text-[11px] text-[#89919A]">
                          ({m.referenceCode})
                        </span>
                      )}
                    </td>
                    <td className="px-4 text-[#89919A]">{m.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                  <th className="px-4">SKU</th>
                  <th className="px-4">Product</th>
                  <th className="px-4 text-right">On Hand</th>
                  <th className="px-4 text-right">Reserved</th>
                  <th className="px-4 text-right">Available</th>
                  <th className="px-4 text-right">Min Stock</th>
                  <th className="px-4 text-right">Stock Value</th>
                  <th className="px-4">Status</th>
                  {canAdjust && <th className="px-4 text-right">Quick Adjust</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-[#89919A]">
                      {tab === 'alerts'
                        ? 'No low-stock or out-of-stock products right now.'
                        : 'No inventory records found.'}
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => {
                    const available = calculateAvailableStock(p.quantity, p.reservedQty);
                    return (
                      <tr key={p.id} className="h-12 hover:bg-[#F9F9F6] dark:hover:bg-[#29323C]/50">
                        <td className="px-4 font-mono text-[#89919A]">{p.sku}</td>
                        <td className="px-4 font-semibold">{p.name}</td>
                        <td className="px-4 text-right font-bold tabular-nums">{p.quantity}</td>
                        <td className="px-4 text-right tabular-nums text-[#89919A]">
                          {p.reservedQty ?? 0}
                        </td>
                        <td className="px-4 text-right font-semibold tabular-nums">{available}</td>
                        <td className="px-4 text-right tabular-nums text-[#89919A]">{p.minStock}</td>
                        <td className="px-4 text-right tabular-nums">
                          {formatCurrency(p.quantity * p.purchasePrice, settings.currency)}
                        </td>
                        <td className="px-4">
                          <StatusBadge variant={getStockStatus(p.quantity, p.minStock)} />
                        </td>
                        {canAdjust && (
                          <td className="px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openTransactionModal('stock_in', p.id)}
                                className="px-2.5 py-1 rounded-md bg-[#68B88A]/20 text-[#1C6B43] dark:text-[#68B88A] font-semibold cursor-pointer"
                              >
                                + In
                              </button>
                              <button
                                type="button"
                                onClick={() => openTransactionModal('stock_out', p.id)}
                                className="px-2.5 py-1 rounded-md bg-[#E56B6F]/20 text-[#962226] dark:text-[#E56B6F] font-semibold cursor-pointer"
                              >
                                - Out
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Transaction Modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="Record Stock Transaction"
        subtitle="All movements update SKU balances atomically and record an audit trail."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['stock_in', 'Stock In'],
                ['stock_out', 'Stock Out'],
                ['adjustment', 'Adjust (+/-)'],
                ['return', 'Return (+)'],
                ['damaged', 'Damaged (-)'],
                ['transfer', 'Transfer (-)'],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTxType(t)}
                className={`h-9 rounded-lg text-xs font-semibold border cursor-pointer ${
                  txType === t
                    ? 'bg-[#15191E] text-[#C5F36B] border-[#15191E] dark:bg-[#C5F36B] dark:text-[#15191E]'
                    : 'border-[#E2E4DF] dark:border-[#29323C] text-[#5C646D] dark:text-[#89919A]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Product *</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            >
              {activeProducts.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.sku} — {p.name} (On hand: {p.quantity})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">
              {txType === 'adjustment' ? 'Quantity Delta (e.g. +5 or -3) *' : 'Quantity *'}
            </label>
            <input
              type="number"
              step="1"
              min={txType === 'adjustment' ? undefined : '1'}
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Reason / Audit Note *</label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                txType === 'stock_in'
                  ? 'e.g., Supplier batch restock'
                  : txType === 'damaged'
                  ? 'e.g., Crushed carton during warehouse inspection'
                  : txType === 'return'
                  ? 'e.g., Customer return restocked to shelf'
                  : txType === 'transfer'
                  ? 'e.g., Transferred to East Coast fulfillment hub'
                  : 'e.g., Physical cycle count reconciliation'
              }
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            />
          </div>

          <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center gap-2 text-xs text-[#89919A]">
            <AlertTriangle className="w-4 h-4 text-[#E6B65C] shrink-0" />
            <span>Negative stock balances and deductions below reserved stock are automatically blocked.</span>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold cursor-pointer"
            >
              {submitting ? 'Updating...' : 'Apply Stock Transaction'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
