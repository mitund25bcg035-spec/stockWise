import React, { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Plus,
  Receipt,
  ArrowLeftRight,
  ClipboardList,
  Truck,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Package,
  CalendarClock,
} from 'lucide-react';
import {
  calculateInventoryValuation,
  calculateSalesGrowthPercent,
  computeCategoryDistribution,
  filterByDateRange,
  getStockStatus,
  isActiveSale,
} from '../utils/calculations';
import { formatCurrency, formatDateTime, formatShortDate } from '../lib/format';
import { StatusBadge } from '../components/ui/StatusBadge';
import type { QuickCreateAction } from '../components/layout/Header';
import type {
  BusinessSettings,
  CalendarEvent,
  Category,
  Customer,
  DateRangePreset,
  NavModuleId,
  Product,
  Sale,
  StockMovement,
  Supplier,
  User,
} from '../types';

interface DashboardPageProps {
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  customers: Customer[];
  sales: Sale[];
  movements: StockMovement[];
  calendarEvents: CalendarEvent[];
  settings: BusinessSettings;
  user: User;
  onNavigate: (module: NavModuleId) => void;
  onOpenQuickAction: (action: QuickCreateAction) => void;
}

export function DashboardPage({
  products,
  categories,
  suppliers,
  customers,
  sales,
  movements,
  calendarEvents,
  settings,
  user,
  onNavigate,
  onOpenQuickAction,
}: DashboardPageProps) {
  const [datePreset, setDatePreset] = useState<DateRangePreset>('30d');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const activeProducts = useMemo(
    () => products.filter((p) => p.status !== 'archived'),
    [products]
  );

  const filteredSales = useMemo(
    () =>
      filterByDateRange(sales, datePreset, customStart, customEnd).filter((s) =>
        isActiveSale(s)
      ),
    [sales, datePreset, customStart, customEnd]
  );

  const filteredMovements = useMemo(
    () => filterByDateRange(movements, datePreset, customStart, customEnd),
    [movements, datePreset, customStart, customEnd]
  );

  const valuation = useMemo(() => calculateInventoryValuation(activeProducts), [activeProducts]);

  const stockCounts = useMemo(() => {
    let inStock = 0;
    let lowStock = 0;
    let outOfStock = 0;
    for (const p of activeProducts) {
      const s = getStockStatus(p.quantity, p.minStock);
      if (s === 'in_stock') inStock += 1;
      else if (s === 'low_stock') lowStock += 1;
      else outOfStock += 1;
    }
    return { inStock, lowStock, outOfStock };
  }, [activeProducts]);

  const totalRevenue = useMemo(
    () => filteredSales.reduce((sum, s) => sum + s.totalAmount, 0),
    [filteredSales]
  );

  const monthlyGrowth = useMemo(() => calculateSalesGrowthPercent(sales), [sales]);

  const revenueChartData = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; orders: number }>();
    const sorted = [...filteredSales].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    for (const s of sorted) {
      const label = new Date(s.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      const prev = map.get(label) ?? { date: label, revenue: 0, orders: 0 };
      prev.revenue = Math.round((prev.revenue + s.totalAmount) * 100) / 100;
      prev.orders += 1;
      map.set(label, prev);
    }
    return Array.from(map.values());
  }, [filteredSales]);

  const monthlySalesTrends = useMemo(() => {
    const map = new Map<string, { month: string; revenue: number; orders: number }>();
    const sorted = [...sales]
      .filter((s) => isActiveSale(s))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const s of sorted) {
      const month = new Date(s.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      });
      const prev = map.get(month) ?? { month, revenue: 0, orders: 0 };
      prev.revenue = Math.round((prev.revenue + s.totalAmount) * 100) / 100;
      prev.orders += 1;
      map.set(month, prev);
    }
    return Array.from(map.values());
  }, [sales]);

  const categoryDist = useMemo(
    () => computeCategoryDistribution(activeProducts, categories),
    [activeProducts, categories]
  );

  const { topSellingProducts, slowMovingProducts } = useMemo(() => {
    const map = new Map<number, { productId: number; name: string; sku: string; units: number; revenue: number }>();
    for (const s of filteredSales) {
      for (const item of s.items ?? []) {
        const entry = map.get(item.productId) ?? {
          productId: item.productId,
          name: item.productName,
          sku: item.sku,
          units: 0,
          revenue: 0,
        };
        entry.units += item.quantity;
        entry.revenue = Math.round((entry.revenue + item.lineTotal) * 100) / 100;
        map.set(item.productId, entry);
      }
    }
    const top = Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const slow = activeProducts
      .filter((p) => p.quantity > 0)
      .map((p) => {
        const stats = map.get(p.id);
        return {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          unitsSold: stats?.units ?? 0,
          onHand: p.quantity,
        };
      })
      .sort((a, b) => a.unitsSold - b.unitsSold || b.onHand - a.onHand)
      .slice(0, 5);

    return { topSellingProducts: top, slowMovingProducts: slow };
  }, [filteredSales, activeProducts]);

  const lowStockList = useMemo(
    () =>
      activeProducts
        .filter((p) => p.quantity <= p.minStock)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 6),
    [activeProducts]
  );

  const upcomingReminders = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return calendarEvents
      .filter((ev) => !ev.completed && ev.eventDate >= today)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
      .slice(0, 4);
  }, [calendarEvents]);

  const healthPct =
    activeProducts.length > 0 ? Math.round((stockCounts.inStock / activeProducts.length) * 100) : 100;
  const currency = settings.currency;
  const activeSuppliersCount = suppliers.filter((s) => s.status !== 'archived').length;
  const activeCustomersCount = customers.filter((c) => c.status !== 'archived').length;

  const canEditProd = user.role === 'admin' || user.permissions.canEditProducts;
  const canSale = user.role === 'admin' || user.permissions.canCreateSales;
  const canAdjust = user.role === 'admin' || user.permissions.canAdjustInventory;
  const canPO = user.role === 'admin' || user.permissions.canManagePurchases;
  const canContacts = user.role === 'admin' || user.permissions.canManageContacts;

  return (
    <div className="space-y-6">
      {/* Top Toolbar: Date Filter + 5 Quick Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 rounded-lg bg-[#E9E9E2] dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] max-w-full overflow-x-auto">
            {(
              [
                ['today', 'Today'],
                ['7d', '7 Days'],
                ['30d', '30 Days'],
                ['90d', '90 Days'],
                ['custom', 'Custom Range'],
              ] as Array<[DateRangePreset, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDatePreset(key)}
                className={`px-2 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  datePreset === key
                    ? 'bg-[#15191E] text-[#C5F36B] dark:bg-[#C5F36B] dark:text-[#15191E]'
                    : 'text-[#5C646D] dark:text-[#89919A] hover:text-[#15191E] dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="Start date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              />
              <span className="text-xs text-[#89919A]">to</span>
              <input
                type="date"
                aria-label="End date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-9 px-2.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
              />
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {canSale && (
            <button
              type="button"
              onClick={() => onOpenQuickAction('new_sale')}
              className="h-9 px-3.5 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>Record Sale</span>
            </button>
          )}
          {canEditProd && (
            <button
              type="button"
              onClick={() => onOpenQuickAction('add_product')}
              className="h-9 px-3.5 rounded-lg bg-[#15191E] hover:bg-[#202832] dark:bg-[#29323C] dark:hover:bg-[#343F4B] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Product</span>
            </button>
          )}
          {canPO && (
            <button
              type="button"
              onClick={() => onOpenQuickAction('new_po')}
              className="h-9 px-3.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Create Purchase</span>
            </button>
          )}
          {canContacts && (
            <button
              type="button"
              onClick={() => onOpenQuickAction('add_supplier')}
              className="h-9 px-3.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Add Supplier</span>
            </button>
          )}
          {canAdjust && (
            <button
              type="button"
              onClick={() => onOpenQuickAction('adjust_stock')}
              className="h-9 px-3.5 rounded-lg bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>Stock Adjustment</span>
            </button>
          )}
        </div>
      </div>

      {/* 8 Core KPI Cards (2 rows of 4 on desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Total Products
          </p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-display tabular-nums">
            {activeProducts.length}
          </p>
          <p className="mt-1.5 text-xs text-[#89919A] tabular-nums">
            {valuation.totalUnits.toLocaleString()} total units on hand
          </p>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Total Inventory Value
          </p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-display tabular-nums">
            {formatCurrency(valuation.totalCostValue, currency)}
          </p>
          <p className="mt-1.5 text-xs text-[#89919A] tabular-nums">
            Retail value {formatCurrency(valuation.totalRetailValue, currency)}
          </p>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Total Sales
          </p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-display tabular-nums">
            {filteredSales.length}
          </p>
          <p className="mt-1.5 text-xs text-[#89919A] tabular-nums">
            {filteredSales.filter((s) => s.status === 'paid').length} paid ·{' '}
            {filteredSales.filter((s) => s.status === 'pending' || s.status === 'partial').length} open
          </p>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Total Revenue
          </p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-display tabular-nums">
            {formatCurrency(totalRevenue, currency)}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <span
              className={`inline-flex items-center gap-1 font-semibold tabular-nums ${
                monthlyGrowth >= 0 ? 'text-[#68B88A]' : 'text-[#E56B6F]'
              }`}
            >
              {monthlyGrowth >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {monthlyGrowth >= 0 ? '+' : ''}
              {monthlyGrowth}% MoM
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Low-Stock Products
          </p>
          <p className="mt-2 text-2xl font-bold text-[#E6B65C] font-display tabular-nums">
            {stockCounts.lowStock}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="mt-1.5 text-xs font-semibold text-[#15191E] dark:text-[#C5F36B] hover:underline cursor-pointer"
          >
            Review reorder levels
          </button>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Out-of-Stock Products
          </p>
          <p className="mt-2 text-2xl font-bold text-[#E56B6F] font-display tabular-nums">
            {stockCounts.outOfStock}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('purchases')}
            className="mt-1.5 text-xs font-semibold text-[#15191E] dark:text-[#C5F36B] hover:underline cursor-pointer"
          >
            Create restock PO
          </button>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Total Suppliers
          </p>
          <p className="mt-2 text-2xl font-bold font-display tabular-nums">
            {activeSuppliersCount}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('suppliers')}
            className="mt-1.5 text-xs font-semibold text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
          >
            Open vendor directory
          </button>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#89919A]">
            Total Customers
          </p>
          <p className="mt-2 text-2xl font-bold font-display tabular-nums">
            {activeCustomersCount}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('customers')}
            className="mt-1.5 text-xs font-semibold text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
          >
            Open customer accounts
          </button>
        </div>
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="text-base font-semibold font-display">Revenue Overview</h2>
              <p className="text-xs text-[#89919A]">
                Invoiced revenue trajectory across the selected window
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] hover:underline cursor-pointer"
            >
              Deep Analytics
            </button>
          </div>

          <div className="h-64 w-full">
            {revenueChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[#89919A]">
                No recorded sales within this date range.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueChartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#C5F36B" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#C5F36B" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#89919A" strokeOpacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#89919A' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#89919A' }} />
                  <Tooltip
                    formatter={(val) => formatCurrency(Number(val), currency)}
                    contentStyle={{
                      backgroundColor: '#15191E',
                      borderColor: '#29323C',
                      borderRadius: 8,
                      color: '#FFFFFF',
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#68B88A"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#revFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Inventory Health & Stock Distribution */}
        <div className="lg:col-span-4 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-semibold font-display">Inventory Health</h2>
            <p className="text-xs text-[#89919A] mt-0.5">
              SKU coverage against minimum stock levels
            </p>

            <div className="mt-4">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs font-medium text-[#5C646D] dark:text-[#89919A]">
                  Healthy Coverage
                </span>
                <span className="text-sm font-bold tabular-nums">{healthPct}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#E2E4DF] dark:bg-[#29323C] overflow-hidden">
                <div
                  className="h-full bg-[#C5F36B] rounded-full transition-all"
                  style={{ width: `${healthPct}%` }}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
                  <p className="text-lg font-bold text-[#68B88A] tabular-nums">
                    {stockCounts.inStock}
                  </p>
                  <p className="text-[11px] text-[#89919A]">Healthy</p>
                </div>
                <div className="p-2.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
                  <p className="text-lg font-bold text-[#E6B65C] tabular-nums">
                    {stockCounts.lowStock}
                  </p>
                  <p className="text-[11px] text-[#89919A]">Low</p>
                </div>
                <div className="p-2.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E]">
                  <p className="text-lg font-bold text-[#E56B6F] tabular-nums">
                    {stockCounts.outOfStock}
                  </p>
                  <p className="text-[11px] text-[#89919A]">Empty</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#E2E4DF] dark:border-[#29323C]">
            <p className="text-xs font-semibold mb-2">Category Value Split</p>
            {categoryDist.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-xs text-[#89919A]">
                No category stock value
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="h-32 w-32 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryDist}
                        dataKey="stockValue"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={28}
                        outerRadius={48}
                        paddingAngle={2}
                        isAnimationActive={false}
                      >
                        {categoryDist.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color || '#C5F36B'} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val) => formatCurrency(Number(val), currency)}
                        contentStyle={{
                          backgroundColor: '#15191E',
                          borderColor: '#29323C',
                          borderRadius: 8,
                          color: '#FFFFFF',
                          fontSize: 11,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex-1 min-w-0 space-y-1.5 text-[11px]">
                  {categoryDist.slice(0, 4).map((c) => {
                    const totalVal = categoryDist.reduce((s, item) => s + item.stockValue, 0);
                    const pct = totalVal > 0 ? Math.round((c.stockValue / totalVal) * 100) : 0;
                    return (
                      <li key={c.name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-sm shrink-0"
                            style={{ backgroundColor: c.color || '#C5F36B' }}
                          />
                          <span className="truncate text-[#5C646D] dark:text-[#89919A]">
                            {c.name}
                          </span>
                        </span>
                        <span className="font-semibold tabular-nums shrink-0">{pct}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Monthly Sales Trends & Category Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h2 className="text-base font-semibold font-display">Monthly Sales Trends</h2>
          <p className="text-xs text-[#89919A] mb-4">Aggregate revenue by month</p>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySalesTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#89919A" strokeOpacity={0.2} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#89919A' }} />
                <YAxis tick={{ fontSize: 11, fill: '#89919A' }} />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v), currency)}
                  contentStyle={{
                    backgroundColor: '#15191E',
                    borderColor: '#29323C',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="revenue" name="Revenue" fill="#C5F36B" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h2 className="text-base font-semibold font-display">Category Stock Value</h2>
          <p className="text-xs text-[#89919A] mb-4">Capital allocation across categories</p>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryDist} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#89919A" strokeOpacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#89919A' }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#89919A' }} />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v), currency)}
                  contentStyle={{
                    backgroundColor: '#15191E',
                    borderColor: '#29323C',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="stockValue" name="Stock Value" fill="#68B88A" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Selling, Slow Moving & Low-Stock Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold font-display">Top-Selling Products</h2>
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] hover:underline cursor-pointer"
            >
              Catalog
            </button>
          </div>
          {topSellingProducts.length === 0 ? (
            <p className="text-xs text-[#89919A] py-6 text-center">No sales in this period.</p>
          ) : (
            <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
              {topSellingProducts.map((item) => (
                <div key={item.productId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] flex items-center justify-center text-[#15191E] dark:text-[#C5F36B] shrink-0">
                      <Package className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{item.name}</p>
                      <p className="text-[11px] text-[#89919A] font-mono">{item.sku}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold tabular-nums">
                      {formatCurrency(item.revenue, currency)}
                    </p>
                    <p className="text-[11px] text-[#89919A] tabular-nums">{item.units} sold</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold font-display">Slow-Moving Products</h2>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] hover:underline cursor-pointer"
            >
              Inspect
            </button>
          </div>
          {slowMovingProducts.length === 0 ? (
            <p className="text-xs text-[#89919A] py-6 text-center">No stock items available.</p>
          ) : (
            <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
              {slowMovingProducts.map((item) => (
                <div key={item.productId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{item.name}</p>
                    <p className="text-[11px] text-[#89919A] font-mono">{item.sku}</p>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <p className="text-xs font-bold text-[#E6B65C]">{item.unitsSold} sold</p>
                    <p className="text-[11px] text-[#89919A]">{item.onHand} in stock</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#E6B65C]" />
              <h2 className="text-base font-semibold font-display">Low-Stock Alerts</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('purchases')}
              className="text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] hover:underline cursor-pointer"
            >
              Reorder
            </button>
          </div>

          {lowStockList.length === 0 ? (
            <p className="text-xs text-[#68B88A] py-6 text-center">
              All products are above minimum levels.
            </p>
          ) : (
            <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
              {lowStockList.map((p) => (
                <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{p.name}</p>
                    <p className="text-[11px] text-[#89919A] tabular-nums">
                      {p.sku} · Min {p.minStock}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold tabular-nums">{p.quantity}</span>
                    <StatusBadge variant={getStockStatus(p.quantity, p.minStock)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Recent Transactions, Recent Movements & Upcoming Calendar Reminders */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold font-display">Recent Transactions</h2>
            <button
              type="button"
              onClick={() => onNavigate('sales')}
              className="text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] hover:underline cursor-pointer"
            >
              All Sales
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase text-[#89919A]">
                  <th className="py-2 pr-3">Invoice</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
                {filteredSales.slice(0, 5).map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 pr-3 font-mono font-medium">{s.invoiceNumber}</td>
                    <td className="py-2.5 pr-3 text-[#5C646D] dark:text-[#89919A] truncate max-w-[120px]">
                      {s.customerName}
                    </td>
                    <td className="py-2.5 pr-3">
                      <StatusBadge variant={s.status} />
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">
                      {formatCurrency(s.totalAmount, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold font-display">Recent Stock Movements</h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] hover:underline cursor-pointer"
            >
              Ledger
            </button>
          </div>
          <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
            {filteredMovements.slice(0, 5).map((m) => (
              <div key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-medium truncate">{m.productName}</p>
                  <p className="text-[#89919A] truncate">
                    {m.reason || m.type} · {formatDateTime(m.createdAt)}
                  </p>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <span
                    className={`font-bold ${
                      m.quantityDelta >= 0 ? 'text-[#68B88A]' : 'text-[#E56B6F]'
                    }`}
                  >
                    {m.quantityDelta >= 0 ? '+' : ''}
                    {m.quantityDelta}
                  </span>
                  <p className="text-[11px] text-[#89919A]">Bal: {m.newQty}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-[#C5F36B]" />
              <h2 className="text-base font-semibold font-display">Reminders</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] hover:underline cursor-pointer"
            >
              Calendar
            </button>
          </div>
          {upcomingReminders.length === 0 ? (
            <p className="text-xs text-[#89919A] py-6 text-center">No upcoming events.</p>
          ) : (
            <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
              {upcomingReminders.map((ev) => (
                <div key={ev.id} className="py-2.5">
                  <p className="font-semibold truncate">{ev.title}</p>
                  <p className="text-[11px] text-[#89919A]">
                    {formatShortDate(ev.eventDate, settings.dateFormat)} · {ev.eventType.replace('_', ' ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
