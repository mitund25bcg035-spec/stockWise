import React, { useMemo, useState } from 'react';
import { FolderTree, Plus, Pencil, Trash2, Search, ArrowRightLeft } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import type { BusinessSettings, Category, Product, User } from '../types';

interface CategoriesPageProps {
  categories: Category[];
  products: Product[];
  settings: BusinessSettings;
  user: User;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const COLOR_SWATCHES = ['#C5F36B', '#68B88A', '#E6B65C', '#5B8DEF', '#E56B6F', '#89919A'];

export function CategoriesPage({
  categories,
  products,
  settings,
  user,
  onRefresh,
  onToast,
}: CategoriesPageProps) {
  const [search, setSearch] = useState('');
  const [countFilter, setCountFilter] = useState<'all' | 'populated' | 'empty'>('all');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#C5F36B');
  const [submitting, setSubmitting] = useState(false);

  // Reassign & Delete modal state (triggered when category has assigned products / HTTP 409)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('none');
  const [deleting, setDeleting] = useState(false);

  const canEdit = user.role === 'admin' || user.permissions.canEditProducts;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return categories.filter((c) => {
      const count = c.productCount ?? 0;
      if (countFilter === 'populated' && count === 0) return false;
      if (countFilter === 'empty' && count > 0) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
    });
  }, [categories, search, countFilter]);

  const categoryProducts = useMemo(() => {
    if (!selectedCategory) return [];
    return products.filter((p) => p.categoryId === selectedCategory.id);
  }, [products, selectedCategory]);

  function openCreate() {
    setEditing(null);
    setName('');
    setDescription('');
    setColor('#C5F36B');
    setFormOpen(true);
  }

  function openEdit(c: Category) {
    setEditing(c);
    setName(c.name);
    setDescription(c.description);
    setColor(c.color || '#C5F36B');
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      onToast('error', 'Category name is required.');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await apiRequest(`/api/categories/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: name.trim(), description: description.trim(), color }),
        });
        onToast('success', `Updated category "${name.trim()}".`);
      } else {
        await apiRequest('/api/categories', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), description: description.trim(), color }),
        });
        onToast('success', `Created category "${name.trim()}".`);
      }
      await onRefresh();
      setFormOpen(false);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save category.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(c: Category) {
    try {
      await apiRequest(`/api/categories/${c.id}`, { method: 'DELETE' });
      onToast('success', `Deleted category "${c.name}".`);
      if (selectedCategory?.id === c.id) setSelectedCategory(null);
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete category.';
      if ((c.productCount ?? 0) > 0 || msg.toLowerCase().includes('reassign')) {
        const other = categories.find((item) => item.id !== c.id);
        setReassignTo(other ? String(other.id) : 'none');
        setDeleteTarget(c);
        onToast('error', msg);
      } else {
        onToast('error', msg);
      }
    }
  }

  async function handleConfirmReassignDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(
        `/api/categories/${deleteTarget.id}?reassignTo=${encodeURIComponent(reassignTo)}`,
        { method: 'DELETE' }
      );
      onToast('success', `Reassigned products and deleted "${deleteTarget.name}".`);
      if (selectedCategory?.id === deleteTarget.id) setSelectedCategory(null);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to delete category.');
    } finally {
      setDeleting(false);
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
              aria-label="Search categories"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter categories..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>

          <div className="inline-flex p-1 rounded-lg bg-[#EAEAE4] dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C]">
            {(
              [
                ['all', 'All'],
                ['populated', 'With Products'],
                ['empty', 'Empty'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCountFilter(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  countFilter === k
                    ? 'bg-[#15191E] text-[#C5F36B] dark:bg-[#C5F36B] dark:text-[#15191E]'
                    : 'text-[#525A63] dark:text-[#89919A]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={openCreate}
            className="h-10 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create Category</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No categories found"
          description="Organize your product catalog by creating inventory categories."
          actionLabel={canEdit ? 'Create Category' : undefined}
          onAction={canEdit ? openCreate : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0 border border-black/10"
                      style={{ backgroundColor: c.color || '#C5F36B' }}
                    />
                    <h3 className="text-base font-semibold text-[#15191E] dark:text-white font-display">
                      {c.name}
                    </h3>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        aria-label={`Edit ${c.name}`}
                        className="p-1.5 rounded-lg text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        aria-label={`Delete ${c.name}`}
                        className="p-1.5 rounded-lg text-[#B4232A] dark:text-[#E56B6F] hover:bg-[#E56B6F]/15 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <p className="mt-2 text-xs text-[#89919A] line-clamp-2 min-h-[32px]">
                  {c.description || 'No description added.'}
                </p>
              </div>

              <div className="mt-4 pt-4 border-t border-[#E2E4DF] dark:border-[#29323C]">
                <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                  <div>
                    <p className="text-[#89919A]">SKUs</p>
                    <p className="font-bold text-[#15191E] dark:text-white tabular-nums">
                      {c.productCount ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#89919A]">Units</p>
                    <p className="font-bold text-[#15191E] dark:text-white tabular-nums">
                      {c.totalUnits ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#89919A]">Stock Value</p>
                    <p className="font-bold text-[#15191E] dark:text-white tabular-nums">
                      {formatCurrency(c.totalValue ?? 0, settings.currency)}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedCategory(c)}
                  className="w-full h-8 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] text-xs font-semibold cursor-pointer"
                >
                  View Assigned Products
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit Category · ${editing.name}` : 'Create Category'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">Category Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Studio Audio"
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2">Chart Color Marker</label>
            <div className="flex items-center gap-2">
              {COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  aria-label={`Select color ${swatch}`}
                  className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                    color === swatch ? 'border-[#15191E] dark:border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
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
              {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create Category'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reassign & Delete Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `Reassign & Delete · ${deleteTarget.name}` : 'Reassign Category'}
        subtitle="This category still contains products. Choose where to move them before deleting."
      >
        {deleteTarget && (
          <form onSubmit={handleConfirmReassignDelete} className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl bg-[#E6B65C]/15 border border-[#E6B65C]/40 flex items-start gap-2.5">
              <ArrowRightLeft className="w-4 h-4 text-[#8F6314] dark:text-[#E6B65C] shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-[#15191E] dark:text-white">
                  {deleteTarget.productCount ?? 0} assigned product(s) will be reassigned
                </p>
                <p className="text-[#525A63] dark:text-[#89919A] mt-0.5">
                  Select a destination category or mark those SKUs as uncategorized.
                </p>
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1.5">Reassign Products To</label>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              >
                {categories
                  .filter((item) => item.id !== deleteTarget.id)
                  .map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                <option value="none">Leave Uncategorized</option>
              </select>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={deleting}
                className="h-10 px-5 rounded-lg bg-[#E56B6F] hover:bg-[#D45559] text-white text-xs font-semibold cursor-pointer"
              >
                {deleting ? 'Reassigning...' : 'Reassign & Delete'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Assigned Products Modal */}
      <Modal
        open={Boolean(selectedCategory)}
        onClose={() => setSelectedCategory(null)}
        title={selectedCategory ? `${selectedCategory.name} — Assigned Products` : 'Products'}
      >
        {categoryProducts.length === 0 ? (
          <p className="text-xs text-[#89919A] py-4 text-center">
            No products are currently assigned to this category.
          </p>
        ) : (
          <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
            {categoryProducts.map((p) => (
              <div key={p.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-[#15191E] dark:text-white">{p.name}</p>
                  <p className="text-[#89919A] font-mono">{p.sku}</p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="font-semibold">
                    {p.quantity} {p.unit || 'units'}
                  </p>
                  <p className="text-[#89919A]">
                    {formatCurrency(p.quantity * p.purchasePrice, settings.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
