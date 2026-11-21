import React, { useEffect, useMemo, useState } from 'react';
import {
  Truck,
  Plus,
  Pencil,
  Trash2,
  Eye,
  Search,
  Mail,
  Phone,
  MapPin,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { Modal } from '../components/ui/Modal';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import type { BusinessSettings, Product, Purchase, Supplier, User } from '../types';

interface SuppliersPageProps {
  suppliers: Supplier[];
  products: Product[];
  purchases: Purchase[];
  settings: BusinessSettings;
  user: User;
  initialOpenCreate?: boolean;
  onClearInitialCreate?: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function SuppliersPage({
  suppliers,
  products,
  purchases,
  settings,
  user,
  initialOpenCreate,
  onClearInitialCreate,
  onRefresh,
  onToast,
}: SuppliersPageProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [formOpen, setFormOpen] = useState(Boolean(initialOpenCreate));
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [country, setCountry] = useState('');
  const [outstandingBalance, setOutstandingBalance] = useState('0');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = user.role === 'admin' || user.permissions.canManageContacts;

  useEffect(() => {
    if (initialOpenCreate) {
      openCreate();
    }
  }, [initialOpenCreate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.companyName.toLowerCase().includes(q) ||
        s.contactName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q)
      );
    });
  }, [suppliers, search, statusFilter]);

  const detailProducts = useMemo(
    () => (detailSupplier ? products.filter((p) => p.supplierId === detailSupplier.id) : []),
    [products, detailSupplier]
  );

  const detailPurchases = useMemo(
    () => (detailSupplier ? purchases.filter((po) => po.supplierId === detailSupplier.id) : []),
    [purchases, detailSupplier]
  );

  function openCreate() {
    setEditing(null);
    setCompanyName('');
    setContactName('');
    setEmail('');
    setPhone('');
    setAddress('');
    setCity('');
    setStateRegion('');
    setCountry('');
    setOutstandingBalance('0');
    setNotes('');
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    onClearInitialCreate?.();
  }

  function openEdit(s: Supplier) {
    setEditing(s);
    setCompanyName(s.companyName);
    setContactName(s.contactName);
    setEmail(s.email);
    setPhone(s.phone);
    setAddress(s.address);
    setCity(s.city || '');
    setStateRegion(s.state || '');
    setCountry(s.country || '');
    setOutstandingBalance(String(s.outstandingBalance ?? 0));
    setNotes(s.notes);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      onToast('error', 'Company name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        city: city.trim(),
        state: stateRegion.trim(),
        country: country.trim(),
        outstandingBalance: Math.max(0, Number(outstandingBalance) || 0),
        notes: notes.trim(),
        status: editing?.status ?? 'active',
      };
      if (editing) {
        await apiRequest(`/api/suppliers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('success', `Updated supplier "${payload.companyName}".`);
      } else {
        await apiRequest('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('success', `Added supplier "${payload.companyName}".`);
      }
      await onRefresh();
      closeForm();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save supplier.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleArchive(s: Supplier) {
    try {
      const res = await apiRequest<{ status: 'active' | 'archived' }>(
        `/api/suppliers/${s.id}/archive`,
        { method: 'PATCH' }
      );
      onToast(
        'success',
        res.status === 'archived'
          ? `Archived supplier "${s.companyName}".`
          : `Restored supplier "${s.companyName}".`
      );
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update supplier status.');
    }
  }

  async function handleDelete(s: Supplier) {
    try {
      await apiRequest(`/api/suppliers/${s.id}`, { method: 'DELETE' });
      onToast('success', `Removed supplier "${s.companyName}".`);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to remove supplier.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search suppliers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, contact, city..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>

          <select
            aria-label="Filter suppliers by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="active">Active Suppliers</option>
            <option value="archived">Archived</option>
            <option value="all">All Suppliers</option>
          </select>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="h-10 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Supplier</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No suppliers found"
          description="Add your vendors and wholesale distributors to track supplied SKUs and purchase orders."
          actionLabel={canManage ? 'Add Supplier' : undefined}
          onAction={canManage ? openCreate : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                  <th className="px-4">Company &amp; Contact</th>
                  <th className="px-4">Location &amp; Contact</th>
                  <th className="px-4 text-right">SKUs</th>
                  <th className="px-4 text-right">POs</th>
                  <th className="px-4 text-right">Total Spend</th>
                  <th className="px-4 text-right">Balance</th>
                  <th className="px-4">Status</th>
                  <th className="px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {filtered.map((s) => {
                  const loc = [s.city, s.state, s.country].filter(Boolean).join(', ');
                  return (
                    <tr key={s.id} className="h-14 hover:bg-[#F5F5F0]/60 dark:hover:bg-[#29323C]/50">
                      <td className="px-4">
                        <p className="font-semibold text-[#15191E] dark:text-white">
                          {s.companyName}
                        </p>
                        <p className="text-[11px] text-[#89919A]">{s.contactName || '—'}</p>
                      </td>
                      <td className="px-4">
                        <p className="text-[#15191E] dark:text-[#E5E8EC]">{s.email || '—'}</p>
                        <p className="text-[11px] text-[#89919A]">
                          {loc || s.phone || '—'}
                        </p>
                      </td>
                      <td className="px-4 text-right font-semibold tabular-nums">
                        {s.productCount ?? 0}
                      </td>
                      <td className="px-4 text-right font-semibold tabular-nums">
                        {s.purchaseCount ?? 0}
                      </td>
                      <td className="px-4 text-right font-semibold tabular-nums">
                        {formatCurrency(s.totalSpend ?? 0, settings.currency)}
                      </td>
                      <td className="px-4 text-right font-semibold tabular-nums text-[#8F6314] dark:text-[#E6B65C]">
                        {formatCurrency(s.outstandingBalance ?? 0, settings.currency)}
                      </td>
                      <td className="px-4">
                        <StatusBadge variant={s.status} />
                      </td>
                      <td className="px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailSupplier(s)}
                            aria-label={`View ${s.companyName}`}
                            className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(s)}
                                aria-label={`Edit ${s.companyName}`}
                                className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleArchive(s)}
                                aria-label={
                                  s.status === 'archived'
                                    ? `Restore ${s.companyName}`
                                    : `Archive ${s.companyName}`
                                }
                                title={s.status === 'archived' ? 'Restore supplier' : 'Archive supplier'}
                                className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                              >
                                {s.status === 'archived' ? (
                                  <ArchiveRestore className="w-4 h-4 text-[#28815F] dark:text-[#68B88A]" />
                                ) : (
                                  <Archive className="w-4 h-4 text-[#89919A]" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(s)}
                                aria-label={`Delete ${s.companyName}`}
                                className="p-1.5 rounded-lg text-[#B4232A] dark:text-[#E56B6F] hover:bg-[#E56B6F]/15 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
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

      {/* Supplier Form Modal */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editing ? `Edit Supplier · ${editing.companyName}` : 'Add Supplier'}
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Company Name *</label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Primary Contact</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Outstanding Balance</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={outstandingBalance}
                onChange={(e) => setOutstandingBalance(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Street Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold mb-1">State / Region</label>
                <input
                  type="text"
                  value={stateRegion}
                  onChange={(e) => setStateRegion(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Country</label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
            >
              {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Supplier'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Supplier Profile & History Modal */}
      <Modal
        open={Boolean(detailSupplier)}
        onClose={() => setDetailSupplier(null)}
        title={detailSupplier?.companyName ?? 'Supplier Overview'}
        subtitle={detailSupplier?.contactName ? `Contact: ${detailSupplier.contactName}` : undefined}
        maxWidthClass="max-w-2xl"
      >
        {detailSupplier && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#89919A] shrink-0" />
                <span className="truncate">{detailSupplier.email || 'No email'}</span>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#89919A] shrink-0" />
                <span className="truncate">{detailSupplier.phone || 'No phone'}</span>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#89919A] shrink-0" />
                <span className="truncate">
                  {[detailSupplier.address, detailSupplier.city, detailSupplier.state, detailSupplier.country]
                    .filter(Boolean)
                    .join(', ') || 'No address'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-[#E2E4DF] dark:border-[#29323C]">
                <p className="text-[#89919A]">Total Spend</p>
                <p className="text-base font-bold tabular-nums mt-0.5">
                  {formatCurrency(detailSupplier.totalSpend ?? 0, settings.currency)}
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-[#E2E4DF] dark:border-[#29323C]">
                <p className="text-[#89919A]">Outstanding Balance</p>
                <p className="text-base font-bold tabular-nums mt-0.5 text-[#8F6314] dark:text-[#E6B65C]">
                  {formatCurrency(detailSupplier.outstandingBalance ?? 0, settings.currency)}
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-[#E2E4DF] dark:border-[#29323C]">
                <p className="text-[#89919A]">On-Time Fulfillment</p>
                <p className="text-base font-bold tabular-nums mt-0.5 text-[#28815F] dark:text-[#68B88A]">
                  {detailSupplier.onTimeRate ?? 96}%
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#15191E] dark:text-white mb-2">
                Supplied Products ({detailProducts.length})
              </h3>
              {detailProducts.length === 0 ? (
                <p className="text-[#89919A]">No catalog products assigned to this supplier.</p>
              ) : (
                <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] border border-[#E2E4DF] dark:border-[#29323C] rounded-xl px-3">
                  {detailProducts.map((p) => (
                    <div key={p.id} className="py-2 flex items-center justify-between">
                      <span>
                        <strong className="font-mono">{p.sku}</strong> · {p.name}
                      </span>
                      <span className="tabular-nums font-semibold">
                        {formatCurrency(p.purchasePrice, settings.currency)} ({p.quantity} in stock)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#15191E] dark:text-white mb-2">
                Purchase Order History ({detailPurchases.length})
              </h3>
              {detailPurchases.length === 0 ? (
                <p className="text-[#89919A]">No purchase orders placed with this supplier yet.</p>
              ) : (
                <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] border border-[#E2E4DF] dark:border-[#29323C] rounded-xl px-3">
                  {detailPurchases.map((po) => (
                    <div key={po.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold">{po.poNumber}</span>
                        <span className="text-[#89919A] ml-2">
                          {formatShortDate(po.createdAt, settings.dateFormat)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge variant={po.status} />
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(po.totalAmount, settings.currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
