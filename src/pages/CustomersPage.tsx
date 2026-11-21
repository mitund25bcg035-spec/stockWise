import React, { useMemo, useState } from 'react';
import {
  Users,
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
import type { BusinessSettings, Customer, Sale, User } from '../types';

interface CustomersPageProps {
  customers: Customer[];
  sales: Sale[];
  settings: BusinessSettings;
  user: User;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function CustomersPage({
  customers,
  sales,
  settings,
  user,
  onRefresh,
  onToast,
}: CustomersPageProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canManage = user.role === 'admin' || user.permissions.canManageContacts;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q)
      );
    });
  }, [customers, search, statusFilter]);

  const customerSales = useMemo(
    () => (detailCustomer ? sales.filter((s) => s.customerId === detailCustomer.id) : []),
    [sales, detailCustomer]
  );

  function openCreate() {
    setEditing(null);
    setName('');
    setCompany('');
    setEmail('');
    setPhone('');
    setAddress('');
    setCity('');
    setNotes('');
    setFormOpen(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setName(c.name);
    setCompany(c.company);
    setEmail(c.email);
    setPhone(c.phone);
    setAddress(c.address);
    setCity(c.city || '');
    setNotes(c.notes);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      onToast('error', 'Customer name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        company: company.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        city: city.trim(),
        notes: notes.trim(),
        status: editing?.status ?? 'active',
      };
      if (editing) {
        await apiRequest(`/api/customers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('success', `Updated customer "${payload.name}".`);
      } else {
        await apiRequest('/api/customers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('success', `Added customer "${payload.name}".`);
      }
      await onRefresh();
      setFormOpen(false);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save customer.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleArchive(c: Customer) {
    try {
      const res = await apiRequest<{ status: 'active' | 'archived' }>(
        `/api/customers/${c.id}/archive`,
        { method: 'PATCH' }
      );
      onToast(
        'success',
        res.status === 'archived'
          ? `Archived customer "${c.name}".`
          : `Restored customer "${c.name}".`
      );
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update customer status.');
    }
  }

  async function handleDelete(c: Customer) {
    try {
      await apiRequest(`/api/customers/${c.id}`, { method: 'DELETE' });
      onToast('success', `Removed customer "${c.name}".`);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to remove customer.');
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
              aria-label="Search customers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, company, city..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>

          <select
            aria-label="Filter customers by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="active">Active Customers</option>
            <option value="archived">Archived</option>
            <option value="all">All Customers</option>
          </select>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="h-10 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Customer</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No customers found"
          description="Add B2B and retail customer accounts to track order history and total revenue."
          actionLabel={canManage ? 'Add Customer' : undefined}
          onAction={canManage ? openCreate : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                  <th className="px-4">Customer</th>
                  <th className="px-4">Contact &amp; City</th>
                  <th className="px-4 text-right">Orders</th>
                  <th className="px-4 text-right">Total Purchases</th>
                  <th className="px-4">Last Order</th>
                  <th className="px-4">Status</th>
                  <th className="px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {filtered.map((c) => (
                  <tr key={c.id} className="h-14 hover:bg-[#F5F5F0]/60 dark:hover:bg-[#29323C]/50">
                    <td className="px-4">
                      <p className="font-semibold text-[#15191E] dark:text-white">{c.name}</p>
                      <p className="text-[11px] text-[#89919A]">{c.company || 'Individual'}</p>
                    </td>
                    <td className="px-4">
                      <p className="text-[#15191E] dark:text-[#E5E8EC]">{c.email || '—'}</p>
                      <p className="text-[11px] text-[#89919A]">
                        {[c.city, c.phone].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </td>
                    <td className="px-4 text-right font-semibold tabular-nums">
                      {c.orderCount ?? 0}
                    </td>
                    <td className="px-4 text-right font-bold tabular-nums text-[#15191E] dark:text-white">
                      {formatCurrency(c.totalPurchases ?? 0, settings.currency)}
                    </td>
                    <td className="px-4 text-[#89919A]">
                      {formatShortDate(c.lastOrderDate, settings.dateFormat)}
                    </td>
                    <td className="px-4">
                      <StatusBadge variant={c.status} />
                    </td>
                    <td className="px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetailCustomer(c)}
                          aria-label={`View ${c.name}`}
                          className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(c)}
                              aria-label={`Edit ${c.name}`}
                              className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleArchive(c)}
                              aria-label={
                                c.status === 'archived'
                                  ? `Restore ${c.name}`
                                  : `Archive ${c.name}`
                              }
                              title={c.status === 'archived' ? 'Restore customer' : 'Archive customer'}
                              className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                            >
                              {c.status === 'archived' ? (
                                <ArchiveRestore className="w-4 h-4 text-[#28815F] dark:text-[#68B88A]" />
                              ) : (
                                <Archive className="w-4 h-4 text-[#89919A]" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(c)}
                              aria-label={`Delete ${c.name}`}
                              className="p-1.5 rounded-lg text-[#B4232A] dark:text-[#E56B6F] hover:bg-[#E56B6F]/15 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Customer Form Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit Customer · ${editing.name}` : 'Add Customer'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Company</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
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
              <label className="block text-xs font-semibold mb-1">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Street Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Account Notes</label>
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
              {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Customer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Customer Profile Modal */}
      <Modal
        open={Boolean(detailCustomer)}
        onClose={() => setDetailCustomer(null)}
        title={detailCustomer?.name ?? 'Customer Profile'}
        subtitle={detailCustomer?.company || 'Retail Customer'}
        maxWidthClass="max-w-2xl"
      >
        {detailCustomer && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#89919A] shrink-0" />
                <span className="truncate">{detailCustomer.email || 'No email'}</span>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#89919A] shrink-0" />
                <span className="truncate">{detailCustomer.phone || 'No phone'}</span>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#89919A] shrink-0" />
                <span className="truncate">
                  {[detailCustomer.address, detailCustomer.city].filter(Boolean).join(', ') ||
                    'No address'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl border border-[#E2E4DF] dark:border-[#29323C]">
                <p className="text-[#89919A]">Total Orders</p>
                <p className="text-xl font-bold tabular-nums mt-0.5">
                  {detailCustomer.orderCount ?? 0}
                </p>
              </div>
              <div className="p-4 rounded-xl border border-[#E2E4DF] dark:border-[#29323C]">
                <p className="text-[#89919A]">Lifetime Spend</p>
                <p className="text-xl font-bold tabular-nums mt-0.5">
                  {formatCurrency(detailCustomer.totalPurchases ?? 0, settings.currency)}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#15191E] dark:text-white mb-2">
                Purchase History ({customerSales.length})
              </h3>
              {customerSales.length === 0 ? (
                <p className="text-[#89919A]">No invoices recorded for this customer yet.</p>
              ) : (
                <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] border border-[#E2E4DF] dark:border-[#29323C] rounded-xl px-3">
                  {customerSales.map((s) => (
                    <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono font-semibold">{s.invoiceNumber}</span>
                        <span className="text-[#89919A] ml-2">
                          {formatShortDate(s.createdAt, settings.dateFormat)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge variant={s.status} />
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(s.totalAmount, settings.currency)}
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
