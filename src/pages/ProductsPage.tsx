import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Pencil,
  Trash2,
  Eye,
  Upload,
  Package,
  ChevronLeft,
  ChevronRight,
  Copy,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  formatCurrency,
  formatDateTime,
  formatShortDate,
  readImageFileAsDataUrl,
} from '../lib/format';
import {
  calculateProfitMarginPercent,
  getStockStatus,
} from '../utils/calculations';
import { Modal } from '../components/ui/Modal';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import type {
  BusinessSettings,
  Category,
  Product,
  StockMovement,
  Supplier,
  User,
} from '../types';

interface ProductsPageProps {
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  movements: StockMovement[];
  settings: BusinessSettings;
  user: User;
  initialOpenCreate?: boolean;
  onClearInitialCreate?: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

interface ProductFormState {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  supplierId: string;
  purchasePrice: string;
  sellingPrice: string;
  quantity: string;
  minStock: string;
  maxStock: string;
  unit: string;
  description: string;
  imageUrl: string;
}

const EMPTY_FORM: ProductFormState = {
  name: '',
  sku: '',
  barcode: '',
  categoryId: '',
  supplierId: '',
  purchasePrice: '0',
  sellingPrice: '0',
  quantity: '0',
  minStock: '5',
  maxStock: '100',
  unit: 'pcs',
  description: '',
  imageUrl: '',
};

export function ProductsPage({
  products,
  categories,
  suppliers,
  movements,
  settings,
  user,
  initialOpenCreate,
  onClearInitialCreate,
  onRefresh,
  onToast,
}: ProductsPageProps) {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [sortBy, setSortBy] = useState<'newest' | 'name_asc' | 'qty_asc' | 'price_desc'>('newest');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const [formOpen, setFormOpen] = useState(Boolean(initialOpenCreate));
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const canEdit = user.role === 'admin' || user.permissions.canEditProducts;

  useEffect(() => {
    if (initialOpenCreate) {
      openCreateModal();
    }
  }, [initialOpenCreate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (categoryFilter !== 'all' && String(p.categoryId ?? '') !== categoryFilter) {
        return false;
      }
      if (stockFilter !== 'all' && getStockStatus(p.quantity, p.minStock) !== stockFilter) {
        return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (sortBy === 'qty_asc') return a.quantity - b.quantity;
      if (sortBy === 'price_desc') return b.sellingPrice - a.sellingPrice;
      return b.id - a.id;
    });

    return list;
  }, [products, search, categoryFilter, stockFilter, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const detailMovements = useMemo(
    () =>
      detailProduct
        ? movements.filter((m) => m.productId === detailProduct.id).slice(0, 12)
        : [],
    [detailProduct, movements]
  );

  function openCreateModal() {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEditModal(p: Product) {
    setEditingProduct(p);
    setForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      categoryId: p.categoryId ? String(p.categoryId) : '',
      supplierId: p.supplierId ? String(p.supplierId) : '',
      purchasePrice: String(p.purchasePrice),
      sellingPrice: String(p.sellingPrice),
      quantity: String(p.quantity),
      minStock: String(p.minStock),
      maxStock: String(p.maxStock ?? 100),
      unit: p.unit || 'pcs',
      description: p.description,
      imageUrl: p.imageUrl,
    });
    setFormOpen(true);
  }

  function closeModal() {
    setFormOpen(false);
    setEditingProduct(null);
    onClearInitialCreate?.();
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setForm((prev) => ({ ...prev, imageUrl: dataUrl }));
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to upload image.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.sku.trim()) {
      onToast('error', 'Product name and SKU are required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim().toUpperCase(),
        barcode: form.barcode.trim(),
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        supplierId: form.supplierId ? Number(form.supplierId) : null,
        purchasePrice: Number(form.purchasePrice),
        sellingPrice: Number(form.sellingPrice),
        quantity: Number(form.quantity),
        minStock: Number(form.minStock),
        maxStock: Number(form.maxStock),
        unit: form.unit.trim() || 'pcs',
        description: form.description.trim(),
        imageUrl: form.imageUrl,
      };

      if (editingProduct) {
        await apiRequest(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        onToast('success', `Updated "${payload.name}".`);
      } else {
        await apiRequest('/api/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast('success', `Added "${payload.name}" to catalog.`);
      }

      await onRefresh();
      closeModal();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save product.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDuplicate(p: Product) {
    try {
      const res = await apiRequest<{ id: number; sku: string }>(`/api/products/${p.id}/duplicate`, {
        method: 'POST',
      });
      onToast('success', `Duplicated as ${res.sku}.`);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to duplicate product.');
    }
  }

  async function handleToggleArchive(p: Product) {
    try {
      const res = await apiRequest<{ status: 'active' | 'archived' }>(
        `/api/products/${p.id}/archive`,
        { method: 'PATCH' }
      );
      onToast(
        'success',
        res.status === 'archived' ? `Archived "${p.name}".` : `Restored "${p.name}".`
      );
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update product status.');
    }
  }

  async function handleDelete(p: Product) {
    try {
      await apiRequest(`/api/products/${p.id}`, { method: 'DELETE' });
      onToast('success', `Deleted "${p.name}".`);
      await onRefresh();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Cannot delete product.');
    }
  }

  return (
    <div className="space-y-5">
      {/* Filter & Action Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-60">
            <Search className="w-4 h-4 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search products"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, SKU, barcode..."
              className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>

          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by stock status"
            value={stockFilter}
            onChange={(e) => {
              setStockFilter(e.target.value as typeof stockFilter);
              setPage(1);
            }}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="all">All Stock Levels</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>

          <select
            aria-label="Filter by product status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="active">Active Catalog</option>
            <option value="archived">Archived</option>
            <option value="all">All Products</option>
          </select>

          <select
            aria-label="Sort products"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="h-10 px-3 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="newest">Sort: Newest</option>
            <option value="name_asc">Sort: Name A–Z</option>
            <option value="qty_asc">Sort: Lowest Stock</option>
            <option value="price_desc">Sort: Highest Price</option>
          </select>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="inline-flex p-1 rounded-lg bg-[#E9E9E2] dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C]">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="Table view"
              className={`p-1.5 rounded-md cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-[#29323C] text-[#15191E] dark:text-white shadow-xs'
                  : 'text-[#89919A]'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              className={`p-1.5 rounded-md cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-[#29323C] text-[#15191E] dark:text-white shadow-xs'
                  : 'text-[#89919A]'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={openCreateModal}
              className="h-10 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          )}
        </div>
      </div>

      {/* Product Listing */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No matching products"
          description="Try clearing your search or status filter, or add a new SKU to the catalog."
          actionLabel={canEdit ? 'Add Product' : undefined}
          onAction={canEdit ? openCreateModal : undefined}
        />
      ) : viewMode === 'table' ? (
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                  <th className="px-4">Product</th>
                  <th className="px-4">SKU / Barcode</th>
                  <th className="px-4">Category</th>
                  <th className="px-4 text-right">Cost</th>
                  <th className="px-4 text-right">Selling / Margin</th>
                  <th className="px-4 text-right">Stock</th>
                  <th className="px-4">Status</th>
                  <th className="px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {paginated.map((p) => {
                  const margin = calculateProfitMarginPercent(p.purchasePrice, p.sellingPrice);
                  return (
                    <tr
                      key={p.id}
                      className="h-14 hover:bg-[#F9F9F6] dark:hover:bg-[#29323C]/50 transition-colors"
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt={p.name}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-lg object-cover border border-[#E2E4DF] dark:border-[#29323C] shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center text-[#89919A] shrink-0">
                              <Package className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold truncate max-w-[210px]">{p.name}</p>
                            <p className="text-[11px] text-[#89919A] truncate max-w-[210px]">
                              {p.supplierName}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono">
                        <p>{p.sku}</p>
                        <p className="text-[11px] text-[#89919A]">{p.barcode || '—'}</p>
                      </td>
                      <td className="px-4 py-2 text-[#5C646D] dark:text-[#89919A]">
                        {p.categoryName}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-[#89919A]">
                        {formatCurrency(p.purchasePrice, settings.currency)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        <p className="font-semibold">{formatCurrency(p.sellingPrice, settings.currency)}</p>
                        <p className="text-[11px] text-[#68B88A]">{margin}% margin</p>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">
                        {p.quantity} {p.unit}
                        <p className="text-[11px] font-normal text-[#89919A]">
                          Min {p.minStock} / Max {p.maxStock}
                        </p>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge variant={getStockStatus(p.quantity, p.minStock)} />
                          {p.status === 'archived' && <StatusBadge variant="archived" />}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(p)}
                            aria-label={`View ${p.name}`}
                            title="Inspect Details & Stock History"
                            className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(p)}
                                aria-label={`Edit ${p.name}`}
                                title="Edit Product"
                                className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicate(p)}
                                aria-label={`Duplicate ${p.name}`}
                                title="Duplicate SKU"
                                className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleArchive(p)}
                                aria-label={p.status === 'archived' ? `Restore ${p.name}` : `Archive ${p.name}`}
                                title={p.status === 'archived' ? 'Restore Product' : 'Archive Product'}
                                className="p-1.5 rounded-lg text-[#E6B65C] hover:bg-[#E6B65C]/15 cursor-pointer"
                              >
                                {p.status === 'archived' ? (
                                  <ArchiveRestore className="w-4 h-4" />
                                ) : (
                                  <Archive className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(p)}
                                aria-label={`Delete ${p.name}`}
                                title="Delete Product"
                                className="p-1.5 rounded-lg text-[#E56B6F] hover:bg-[#E56B6F]/15 cursor-pointer"
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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {paginated.map((p) => (
            <div
              key={p.id}
              className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-4 flex flex-col justify-between"
            >
              <div>
                <div className="aspect-[4/3] rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden flex items-center justify-center mb-3">
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-[#89919A]">
                      <Package className="w-8 h-8" />
                      <span className="text-[11px] font-mono">{p.sku}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] text-[#89919A] truncate">
                    {p.categoryName} · {p.sku}
                  </span>
                  <StatusBadge variant={getStockStatus(p.quantity, p.minStock)} />
                </div>
                <h3 className="text-sm font-semibold line-clamp-2">{p.name}</h3>
              </div>

              <div className="mt-4 pt-3 border-t border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold tabular-nums">
                    {formatCurrency(p.sellingPrice, settings.currency)}
                  </p>
                  <p className="text-[11px] text-[#89919A] tabular-nums">
                    {p.quantity} {p.unit} · {calculateProfitMarginPercent(p.purchasePrice, p.sellingPrice)}% margin
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDetailProduct(p)}
                    aria-label={`View ${p.name}`}
                    className="p-1.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditModal(p)}
                      aria-label={`Edit ${p.name}`}
                      className="p-1.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between text-xs text-[#89919A]">
          <span className="tabular-nums">
            Showing {(currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} products
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
              className="h-8 px-2.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#202832] disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 tabular-nums font-medium text-[#15191E] dark:text-white">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
              className="h-8 px-2.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#202832] disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      <Modal
        open={formOpen}
        onClose={closeModal}
        title={editingProduct ? `Edit Product · ${editingProduct.sku}` : 'Add New Product'}
        subtitle="Configure pricing, min/max thresholds, unit of measure, supplier link, and product image."
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Product Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Tactile Aluminum Mechanical Keyboard"
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">SKU *</label>
              <input
                type="text"
                required
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="HW-KB-205"
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm font-mono uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Barcode</label>
              <input
                type="text"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="890101009911"
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Category</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Supplier</label>
              <select
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              >
                <option value="">Unassigned</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Purchase Cost</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.purchasePrice}
                onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Selling Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={form.sellingPrice}
                onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Current Quantity</label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Unit of Measure</label>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="pcs, box, kg, roll"
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Minimum Stock Level</label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Maximum Stock Capacity</label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={form.maxStock}
                onChange={(e) => setForm({ ...form, maxStock: e.target.value })}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Product Image (PNG, JPEG, WebP)</label>
              <div className="flex items-center gap-3">
                <label className="h-10 px-3.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>Upload Image</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleImageUpload}
                    className="sr-only"
                  />
                </label>
                {form.imageUrl && (
                  <div className="flex items-center gap-2">
                    <img
                      src={form.imageUrl}
                      alt="Product preview"
                      className="w-10 h-10 rounded-lg object-cover border border-[#E2E4DF]"
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, imageUrl: '' })}
                      className="text-xs text-[#E56B6F] hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Specifications, storage handling, or catalog notes..."
                className="w-full p-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E2E4DF] dark:border-[#29323C]">
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
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {submitting ? 'Saving...' : editingProduct ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Product Detail + Stock History Modal */}
      <Modal
        open={Boolean(detailProduct)}
        onClose={() => setDetailProduct(null)}
        title={detailProduct?.name ?? 'Product Details'}
        subtitle={detailProduct ? `${detailProduct.sku} · ${detailProduct.categoryName}` : undefined}
        maxWidthClass="max-w-2xl"
      >
        {detailProduct && (
          <div className="space-y-4 text-sm">
            {detailProduct.imageUrl && (
              <img
                src={detailProduct.imageUrl}
                alt={detailProduct.name}
                referrerPolicy="no-referrer"
                className="w-full h-44 object-cover rounded-xl border border-[#E2E4DF] dark:border-[#29323C]"
              />
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusBadge variant={getStockStatus(detailProduct.quantity, detailProduct.minStock)} />
                <StatusBadge variant={detailProduct.status} />
              </div>
              <span className="text-xs text-[#89919A]">
                Updated {formatShortDate(detailProduct.updatedAt, settings.dateFormat)}
              </span>
            </div>
            <p className="text-xs text-[#5C646D] dark:text-[#89919A] leading-relaxed">
              {detailProduct.description || 'No description provided for this SKU.'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
                <p className="text-[11px] text-[#89919A]">Purchase Cost</p>
                <p className="text-sm font-bold tabular-nums">
                  {formatCurrency(detailProduct.purchasePrice, settings.currency)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
                <p className="text-[11px] text-[#89919A]">Selling Price</p>
                <p className="text-sm font-bold tabular-nums">
                  {formatCurrency(detailProduct.sellingPrice, settings.currency)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
                <p className="text-[11px] text-[#89919A]">Profit Margin</p>
                <p className="text-sm font-bold text-[#68B88A] tabular-nums">
                  {calculateProfitMarginPercent(
                    detailProduct.purchasePrice,
                    detailProduct.sellingPrice
                  )}
                  %
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
                <p className="text-[11px] text-[#89919A]">Stock / Min–Max</p>
                <p className="text-sm font-bold tabular-nums">
                  {detailProduct.quantity} {detailProduct.unit} ({detailProduct.minStock}–
                  {detailProduct.maxStock})
                </p>
              </div>
            </div>

            <div className="pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#89919A] mb-2">
                Recent Stock History ({detailMovements.length})
              </h3>
              {detailMovements.length === 0 ? (
                <p className="text-xs text-[#89919A] py-3">No stock movements recorded yet.</p>
              ) : (
                <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] border border-[#E2E4DF] dark:border-[#29323C] rounded-xl px-3 max-h-56 overflow-y-auto text-xs">
                  {detailMovements.map((m) => (
                    <div key={m.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {m.type.replace('_', ' ')} · {m.reason}
                        </p>
                        <p className="text-[11px] text-[#89919A]">
                          {formatDateTime(m.createdAt)} · {m.referenceCode || m.userName}
                        </p>
                      </div>
                      <div className="text-right tabular-nums shrink-0">
                        <span
                          className={`font-bold ${
                            m.quantityDelta >= 0 ? 'text-[#68B88A]' : 'text-[#E56B6F]'
                          }`}
                        >
                          {m.quantityDelta >= 0 ? '+' : ''}
                          {m.quantityDelta}
                        </span>
                        <p className="text-[11px] text-[#89919A]">
                          {m.previousQty} → {m.newQty}
                        </p>
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
