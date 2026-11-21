import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Printer, Search, ArrowUpDown } from 'lucide-react';
import {
  buildCsvString,
  calculateProfitMarginPercent,
  filterByDateRange,
  getStockStatus,
  isActiveSale,
} from '../utils/calculations';
import { downloadCsv, formatCurrency, formatDateTime, formatShortDate } from '../lib/format';
import type {
  BusinessSettings,
  Category,
  Customer,
  DateRangePreset,
  Product,
  Purchase,
  Sale,
  StockMovement,
  Supplier,
  User,
} from '../types';

type ReportKind =
  | 'inventory'
  | 'product'
  | 'sales'
  | 'purchase'
  | 'low_stock'
  | 'out_of_stock'
  | 'stock_movement'
  | 'supplier'
  | 'customer'
  | 'profitability';

interface ReportsPageProps {
  products: Product[];
  categories: Category[];
  sales: Sale[];
  purchases: Purchase[];
  movements: StockMovement[];
  suppliers: Supplier[];
  customers: Customer[];
  settings: BusinessSettings;
  user: User;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const REPORT_DEFS: Array<{ id: ReportKind; label: string; description: string }> = [
  { id: 'inventory', label: 'Complete Inventory', description: 'Full stock on hand, reserved units, and asset valuation.' },
  { id: 'product', label: 'Product Catalog', description: 'SKU pricing, cost basis, and unit profit margins.' },
  { id: 'sales', label: 'Sales Ledger', description: 'Customer invoices, discounts, tax, paid amounts, and status.' },
  { id: 'purchase', label: 'Purchase Orders', description: 'Supplier POs, receipt quantities, and fulfillment status.' },
  { id: 'low_stock', label: 'Low-Stock Alerts', description: 'Active SKUs at or below reorder threshold.' },
  { id: 'out_of_stock', label: 'Out-of-Stock', description: 'Active SKUs with zero stock available.' },
  { id: 'stock_movement', label: 'Stock Movements', description: 'Audit trail of stock ins, outs, damages, and transfers.' },
  { id: 'supplier', label: 'Supplier Report', description: 'Vendor spend, balances, SKU coverage, and on-time rates.' },
  { id: 'customer', label: 'Customer Report', description: 'Customer accounts, order volume, and lifetime spend.' },
  { id: 'profitability', label: 'Profitability & COGS', description: 'Units sold, revenue, COGS, and gross profit per SKU.' },
];

export function ReportsPage({
  products,
  categories,
  sales,
  purchases,
  movements,
  suppliers,
  customers,
  settings,
  user,
  onToast,
}: ReportsPageProps) {
  const [reportType, setReportType] = useState<ReportKind>('inventory');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('90d');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const currency = settings.currency;
  const canExport = user.role === 'admin' || user.permissions.canExportReports;

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (categoryFilter !== 'all' && String(p.categoryId ?? '') !== categoryFilter) return false;
      if (productFilter !== 'all' && String(p.id) !== productFilter) return false;
      return true;
    });
  }, [products, categoryFilter, productFilter]);

  const filteredSales = useMemo(
    () => filterByDateRange(sales, datePreset, customStart, customEnd),
    [sales, datePreset, customStart, customEnd]
  );

  const filteredPurchases = useMemo(
    () => filterByDateRange(purchases, datePreset, customStart, customEnd),
    [purchases, datePreset, customStart, customEnd]
  );

  const filteredMovements = useMemo(() => {
    const ranged = filterByDateRange(movements, datePreset, customStart, customEnd);
    return ranged.filter((m) => {
      if (productFilter !== 'all' && String(m.productId) !== productFilter) return false;
      if (categoryFilter !== 'all') {
        const prod = products.find((p) => p.id === m.productId);
        if (!prod || String(prod.categoryId ?? '') !== categoryFilter) return false;
      }
      return true;
    });
  }, [movements, datePreset, customStart, customEnd, productFilter, categoryFilter, products]);

  const rawReport = useMemo(() => {
    if (reportType === 'inventory') {
      return {
        headers: ['SKU', 'Product', 'Category', 'On Hand', 'Reserved', 'Min Stock', 'Cost Value'],
        rows: filteredProducts.map((p) => [
          p.sku,
          p.name,
          p.categoryName || 'Uncategorized',
          p.quantity,
          p.reservedQty ?? 0,
          p.minStock,
          formatCurrency(p.quantity * p.purchasePrice, currency),
        ]),
        rawRows: filteredProducts.map((p) => [
          p.sku,
          p.name,
          p.categoryName || 'Uncategorized',
          p.quantity,
          p.reservedQty ?? 0,
          p.minStock,
          Math.round(p.quantity * p.purchasePrice * 100) / 100,
        ]),
      };
    }

    if (reportType === 'product') {
      return {
        headers: ['SKU', 'Product', 'Category', 'Supplier', 'Cost', 'Price', 'Margin %', 'Status'],
        rows: filteredProducts.map((p) => [
          p.sku,
          p.name,
          p.categoryName || 'Uncategorized',
          p.supplierName || 'Unassigned',
          formatCurrency(p.purchasePrice, currency),
          formatCurrency(p.sellingPrice, currency),
          `${calculateProfitMarginPercent(p.purchasePrice, p.sellingPrice)}%`,
          p.status,
        ]),
        rawRows: filteredProducts.map((p) => [
          p.sku,
          p.name,
          p.categoryName || 'Uncategorized',
          p.supplierName || 'Unassigned',
          p.purchasePrice,
          p.sellingPrice,
          calculateProfitMarginPercent(p.purchasePrice, p.sellingPrice),
          p.status,
        ]),
      };
    }

    if (reportType === 'low_stock') {
      const low = filteredProducts.filter(
        (p) => p.status !== 'archived' && getStockStatus(p.quantity, p.minStock) === 'low_stock'
      );
      return {
        headers: ['SKU', 'Product', 'Supplier', 'On Hand', 'Min Stock', 'Shortfall', 'Reorder Cost'],
        rows: low.map((p) => {
          const shortfall = Math.max(0, p.maxStock - p.quantity);
          return [
            p.sku,
            p.name,
            p.supplierName || 'Unassigned',
            p.quantity,
            p.minStock,
            shortfall,
            formatCurrency(shortfall * p.purchasePrice, currency),
          ];
        }),
        rawRows: low.map((p) => {
          const shortfall = Math.max(0, p.maxStock - p.quantity);
          return [
            p.sku,
            p.name,
            p.supplierName || 'Unassigned',
            p.quantity,
            p.minStock,
            shortfall,
            Math.round(shortfall * p.purchasePrice * 100) / 100,
          ];
        }),
      };
    }

    if (reportType === 'out_of_stock') {
      const oos = filteredProducts.filter((p) => p.status !== 'archived' && p.quantity <= 0);
      return {
        headers: ['SKU', 'Product', 'Category', 'Supplier', 'Min Stock', 'Target Max', 'Unit Cost'],
        rows: oos.map((p) => [
          p.sku,
          p.name,
          p.categoryName || 'Uncategorized',
          p.supplierName || 'Unassigned',
          p.minStock,
          p.maxStock ?? 100,
          formatCurrency(p.purchasePrice, currency),
        ]),
        rawRows: oos.map((p) => [
          p.sku,
          p.name,
          p.categoryName || 'Uncategorized',
          p.supplierName || 'Unassigned',
          p.minStock,
          p.maxStock ?? 100,
          p.purchasePrice,
        ]),
      };
    }

    if (reportType === 'stock_movement') {
      return {
        headers: ['Date', 'Reference', 'SKU', 'Product', 'Type', 'Delta', 'New Qty', 'Reason'],
        rows: filteredMovements.map((m) => [
          formatDateTime(m.createdAt),
          m.referenceCode || '—',
          m.productSku || '—',
          m.productName || '—',
          m.type.replace('_', ' '),
          m.quantityDelta > 0 ? `+${m.quantityDelta}` : String(m.quantityDelta),
          m.newQty,
          m.reason,
        ]),
        rawRows: filteredMovements.map((m) => [
          m.createdAt.slice(0, 19),
          m.referenceCode,
          m.productSku || '',
          m.productName || '',
          m.type,
          m.quantityDelta,
          m.newQty,
          m.reason,
        ]),
      };
    }

    if (reportType === 'sales') {
      return {
        headers: ['Invoice #', 'Date', 'Customer', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Status'],
        rows: filteredSales.map((s) => [
          s.invoiceNumber,
          formatShortDate(s.createdAt, settings.dateFormat),
          s.customerName,
          formatCurrency(s.subtotal, currency),
          formatCurrency(s.discountAmount, currency),
          formatCurrency(s.taxAmount, currency),
          formatCurrency(s.totalAmount, currency),
          formatCurrency(s.amountPaid ?? 0, currency),
          s.status,
        ]),
        rawRows: filteredSales.map((s) => [
          s.invoiceNumber,
          s.createdAt.slice(0, 10),
          s.customerName,
          s.subtotal,
          s.discountAmount,
          s.taxAmount,
          s.totalAmount,
          s.amountPaid ?? 0,
          s.status,
        ]),
      };
    }

    if (reportType === 'purchase') {
      return {
        headers: ['PO #', 'Date', 'Supplier', 'Expected Date', 'Total Cost', 'Status'],
        rows: filteredPurchases.map((po) => [
          po.poNumber,
          formatShortDate(po.createdAt, settings.dateFormat),
          po.supplierName,
          formatShortDate(po.expectedDate, settings.dateFormat),
          formatCurrency(po.totalAmount, currency),
          po.status.replace('_', ' '),
        ]),
        rawRows: filteredPurchases.map((po) => [
          po.poNumber,
          po.createdAt.slice(0, 10),
          po.supplierName,
          po.expectedDate || '',
          po.totalAmount,
          po.status,
        ]),
      };
    }

    if (reportType === 'profitability') {
      const soldMap = new Map<number, { units: number; revenue: number; cost: number }>();
      for (const s of filteredSales) {
        if (!isActiveSale(s)) continue;
        for (const item of s.items ?? []) {
          const entry = soldMap.get(item.productId) ?? { units: 0, revenue: 0, cost: 0 };
          entry.units += item.quantity;
          entry.revenue += item.lineTotal;
          entry.cost += item.quantity * item.unitCost;
          soldMap.set(item.productId, entry);
        }
      }
      const perf = filteredProducts.map((p) => {
        const st = soldMap.get(p.id) ?? { units: 0, revenue: 0, cost: 0 };
        const profit = Math.round((st.revenue - st.cost) * 100) / 100;
        const margin = st.revenue > 0 ? Math.round((profit / st.revenue) * 1000) / 10 : 0;
        return { p, ...st, profit, margin };
      });
      return {
        headers: ['SKU', 'Product', 'Units Sold', 'Revenue', 'COGS', 'Gross Profit', 'Margin %'],
        rows: perf.map((r) => [
          r.p.sku,
          r.p.name,
          r.units,
          formatCurrency(r.revenue, currency),
          formatCurrency(r.cost, currency),
          formatCurrency(r.profit, currency),
          `${r.margin}%`,
        ]),
        rawRows: perf.map((r) => [
          r.p.sku,
          r.p.name,
          r.units,
          Math.round(r.revenue * 100) / 100,
          Math.round(r.cost * 100) / 100,
          r.profit,
          r.margin,
        ]),
      };
    }

    if (reportType === 'supplier') {
      return {
        headers: ['Company', 'Contact', 'Location', 'SKUs', 'PO Count', 'Total Spend', 'Balance', 'On-Time %'],
        rows: suppliers.map((s) => [
          s.companyName,
          s.contactName || '—',
          [s.city, s.country].filter(Boolean).join(', ') || '—',
          s.productCount ?? 0,
          s.purchaseCount ?? 0,
          formatCurrency(s.totalSpend ?? 0, currency),
          formatCurrency(s.outstandingBalance ?? 0, currency),
          `${s.onTimeRate ?? 96}%`,
        ]),
        rawRows: suppliers.map((s) => [
          s.companyName,
          s.contactName,
          [s.city, s.country].filter(Boolean).join(', '),
          s.productCount ?? 0,
          s.purchaseCount ?? 0,
          s.totalSpend ?? 0,
          s.outstandingBalance ?? 0,
          s.onTimeRate ?? 96,
        ]),
      };
    }

    // customer report
    return {
      headers: ['Customer', 'Company', 'City', 'Orders', 'Total Purchases', 'Last Order'],
      rows: customers.map((c) => [
        c.name,
        c.company || '—',
        c.city || '—',
        c.orderCount ?? 0,
        formatCurrency(c.totalPurchases ?? 0, currency),
        formatShortDate(c.lastOrderDate, settings.dateFormat),
      ]),
      rawRows: customers.map((c) => [
        c.name,
        c.company,
        c.city,
        c.orderCount ?? 0,
        c.totalPurchases ?? 0,
        c.lastOrderDate ? c.lastOrderDate.slice(0, 10) : '',
      ]),
    };
  }, [
    reportType,
    filteredProducts,
    filteredSales,
    filteredPurchases,
    filteredMovements,
    suppliers,
    customers,
    currency,
    settings.dateFormat,
  ]);

  // Apply search & column sorting across paired display + raw rows
  const processedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const paired = rawReport.rows.map((displayRow, idx) => ({
      display: displayRow,
      raw: rawReport.rawRows[idx] ?? displayRow,
    }));

    const searched = q
      ? paired.filter((pair) =>
          pair.display.some((cell) => String(cell).toLowerCase().includes(q))
        )
      : paired;

    if (sortCol === null) return searched;

    return [...searched].sort((a, b) => {
      const av = a.raw[sortCol];
      const bv = b.raw[sortCol];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rawReport, search, sortCol, sortDir]);

  function toggleSort(colIdx: number) {
    if (sortCol === colIdx) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colIdx);
      setSortDir('desc');
    }
  }

  function handleExportCsv() {
    if (!canExport) {
      onToast('error', 'Your account does not have export permission.');
      return;
    }
    const csv = buildCsvString(
      rawReport.headers,
      processedRows.map((p) => p.raw)
    );
    downloadCsv(`stockwise-${reportType}-report-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    onToast('success', 'Report downloaded as CSV.');
  }

  return (
    <div className="space-y-6">
      {/* Report Selector Grid (all 10 reports) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 no-print">
        {REPORT_DEFS.map((def) => {
          const active = reportType === def.id;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => {
                setReportType(def.id);
                setSortCol(null);
              }}
              className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                active
                  ? 'bg-[#15191E] text-[#C5F36B] border-[#15191E] dark:bg-[#C5F36B] dark:text-[#15191E] dark:border-[#C5F36B]'
                  : 'bg-white dark:bg-[#202832] border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C]'
              }`}
            >
              <p className="text-xs font-semibold">{def.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filter & Export Bar */}
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-4 space-y-3 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold font-display">
              {REPORT_DEFS.find((d) => d.id === reportType)?.label}
            </h2>
            <p className="text-xs text-[#89919A]">
              {REPORT_DEFS.find((d) => d.id === reportType)?.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C]">
              {(
                [
                  ['today', 'Today'],
                  ['7d', '7 Days'],
                  ['30d', '30 Days'],
                  ['90d', '90 Days'],
                  ['custom', 'Custom'],
                ] as Array<[DateRangePreset, string]>
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDatePreset(k)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    datePreset === k
                      ? 'bg-[#15191E] text-[#C5F36B] dark:bg-[#C5F36B] dark:text-[#15191E]'
                      : 'text-[#525A63] dark:text-[#89919A]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-9 px-2 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#15191E] text-xs"
                />
                <span className="text-xs text-[#89919A]">–</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-9 px-2 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#15191E] text-xs"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="h-9 px-3 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" />
              <span>Print / PDF</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!canExport}
              className="h-9 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E2E4DF] dark:border-[#29323C]">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search report rows"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter rows by keyword..."
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>

          <select
            aria-label="Filter report by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 px-3 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter report by product"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="h-9 px-3 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs max-w-[220px]"
          >
            <option value="all">All Products</option>
            {products.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.sku} — {p.name}
              </option>
            ))}
          </select>

          <span className="ml-auto text-xs text-[#89919A] tabular-nums">
            {processedRows.length} row(s)
          </span>
        </div>
      </div>

      {/* Report Table */}
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                {rawReport.headers.map((h, idx) => (
                  <th key={h} className="px-4 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort(idx)}
                      className="inline-flex items-center gap-1 hover:text-[#15191E] dark:hover:text-white cursor-pointer uppercase"
                    >
                      <span>{h}</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
              {processedRows.length === 0 ? (
                <tr>
                  <td colSpan={rawReport.headers.length} className="px-4 py-10 text-center text-[#89919A]">
                    <FileSpreadsheet className="w-6 h-6 mx-auto mb-2 opacity-60" />
                    No records match this report and filter selection.
                  </td>
                </tr>
              ) : (
                processedRows.map((pair, idx) => (
                  <tr key={idx} className="h-11 hover:bg-[#F5F5F0]/60 dark:hover:bg-[#29323C]/50">
                    {pair.display.map((cell, cIdx) => (
                      <td key={cIdx} className="px-4 tabular-nums whitespace-nowrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
