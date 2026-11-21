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
  Legend,
} from 'recharts';
import {
  calculateInventoryValuation,
  computeCategoryDistribution,
  computeProfitEstimate,
  filterByDateRange,
  isActiveSale,
} from '../utils/calculations';
import { formatCurrency } from '../lib/format';
import type { BusinessSettings, Category, Product, Purchase, Sale, Supplier } from '../types';

interface AnalyticsPageProps {
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  sales: Sale[];
  purchases: Purchase[];
  settings: BusinessSettings;
}

type AnalyticsWindow = '7d' | '30d' | '90d' | 'all';

export function AnalyticsPage({
  products,
  categories,
  suppliers,
  sales,
  purchases,
  settings,
}: AnalyticsPageProps) {
  const [windowPreset, setWindowPreset] = useState<AnalyticsWindow>('90d');
  const currency = settings.currency;

  const scopedSales = useMemo(
    () => (windowPreset === 'all' ? sales : filterByDateRange(sales, windowPreset)),
    [sales, windowPreset]
  );

  const scopedPurchases = useMemo(
    () => (windowPreset === 'all' ? purchases : filterByDateRange(purchases, windowPreset)),
    [purchases, windowPreset]
  );

  const valuation = useMemo(() => calculateInventoryValuation(products), [products]);
  const profit = useMemo(
    () => computeProfitEstimate(scopedSales, scopedPurchases),
    [scopedSales, scopedPurchases]
  );
  const categoryDist = useMemo(
    () => computeCategoryDistribution(products, categories),
    [products, categories]
  );

  const activeSalesCount = useMemo(
    () => scopedSales.filter((s) => isActiveSale(s)).length,
    [scopedSales]
  );

  // Daily sales performance & Monthly trends
  const { dailySales, monthlyComparison } = useMemo(() => {
    const dailyMap = new Map<string, { date: string; revenue: number; orders: number }>();
    const monthMap = new Map<string, { month: string; sales: number; purchases: number }>();

    for (const s of [...scopedSales].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )) {
      if (!isActiveSale(s)) continue;
      const d = new Date(s.createdAt);
      const dayKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const dEntry = dailyMap.get(dayKey) ?? { date: dayKey, revenue: 0, orders: 0 };
      dEntry.revenue = Math.round((dEntry.revenue + s.totalAmount) * 100) / 100;
      dEntry.orders += 1;
      dailyMap.set(dayKey, dEntry);

      const mKey = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const mEntry = monthMap.get(mKey) ?? { month: mKey, sales: 0, purchases: 0 };
      mEntry.sales = Math.round((mEntry.sales + s.totalAmount) * 100) / 100;
      monthMap.set(mKey, mEntry);
    }

    for (const po of scopedPurchases) {
      if (po.status === 'cancelled') continue;
      const d = new Date(po.createdAt);
      const mKey = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const mEntry = monthMap.get(mKey) ?? { month: mKey, sales: 0, purchases: 0 };
      mEntry.purchases = Math.round((mEntry.purchases + po.totalAmount) * 100) / 100;
      monthMap.set(mKey, mEntry);
    }

    return {
      dailySales: Array.from(dailyMap.values()),
      monthlyComparison: Array.from(monthMap.values()),
    };
  }, [scopedSales, scopedPurchases]);

  // Product sales comparison: top-performing vs slow-moving
  const { productSalesChart, topProducts, slowMovingProducts } = useMemo(() => {
    const soldMap = new Map<number, { units: number; revenue: number }>();
    for (const s of scopedSales) {
      if (!isActiveSale(s)) continue;
      for (const item of s.items ?? []) {
        const entry = soldMap.get(item.productId) ?? { units: 0, revenue: 0 };
        entry.units += item.quantity;
        entry.revenue = Math.round((entry.revenue + item.lineTotal) * 100) / 100;
        soldMap.set(item.productId, entry);
      }
    }

    const enriched = products
      .filter((p) => p.status !== 'archived')
      .map((p) => {
        const stats = soldMap.get(p.id) ?? { units: 0, revenue: 0 };
        return {
          id: p.id,
          name: p.name.length > 22 ? `${p.name.slice(0, 22)}...` : p.name,
          fullName: p.name,
          sku: p.sku,
          unitsSold: stats.units,
          revenue: stats.revenue,
          onHand: p.quantity,
        };
      });

    const top = [...enriched].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
    const slow = [...enriched]
      .filter((p) => p.onHand > 0)
      .sort((a, b) => a.unitsSold - b.unitsSold || b.onHand - a.onHand)
      .slice(0, 5);

    return {
      productSalesChart: top,
      topProducts: top.slice(0, 5),
      slowMovingProducts: slow,
    };
  }, [products, scopedSales]);

  // Category & Supplier performance breakdown
  const categoryPerformance = useMemo(() => {
    const map = new Map<
      string,
      { name: string; skus: number; units: number; stockValue: number; revenue: number }
    >();
    const prodCategory = new Map<number, string>();

    for (const p of products) {
      if (p.status === 'archived') continue;
      const catName = p.categoryName || 'Uncategorized';
      prodCategory.set(p.id, catName);
      const entry = map.get(catName) ?? {
        name: catName,
        skus: 0,
        units: 0,
        stockValue: 0,
        revenue: 0,
      };
      entry.skus += 1;
      entry.units += Math.max(0, p.quantity);
      entry.stockValue = Math.round((entry.stockValue + p.quantity * p.purchasePrice) * 100) / 100;
      map.set(catName, entry);
    }

    for (const s of scopedSales) {
      if (!isActiveSale(s)) continue;
      for (const item of s.items ?? []) {
        const catName = prodCategory.get(item.productId) ?? 'Uncategorized';
        const entry = map.get(catName) ?? {
          name: catName,
          skus: 0,
          units: 0,
          stockValue: 0,
          revenue: 0,
        };
        entry.revenue = Math.round((entry.revenue + item.lineTotal) * 100) / 100;
        map.set(catName, entry);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.stockValue - a.stockValue);
  }, [products, scopedSales]);

  const supplierPerformance = useMemo(() => {
    return suppliers
      .filter((s) => s.status !== 'archived')
      .map((sup) => {
        const pos = scopedPurchases.filter(
          (po) => po.supplierId === sup.id && po.status !== 'cancelled'
        );
        const spend = Math.round(pos.reduce((sum, po) => sum + po.totalAmount, 0) * 100) / 100;
        return {
          id: sup.id,
          companyName: sup.companyName,
          skus: sup.productCount ?? 0,
          poCount: pos.length,
          spend,
          onTimeRate: sup.onTimeRate ?? 96,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [suppliers, scopedPurchases]);

  const marginPct =
    profit.netSalesExTax > 0
      ? Math.round((profit.grossProfit / profit.netSalesExTax) * 1000) / 10
      : 0;

  return (
    <div className="space-y-6">
      {/* Window Selector Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold font-display text-[#15191E] dark:text-white">
            Business Intelligence &amp; Margin Analytics
          </h2>
          <p className="text-xs text-[#89919A]">
            Live revenue, COGS, category yield, and supplier fulfillment telemetry
          </p>
        </div>

        <div className="inline-flex p-1 rounded-lg bg-[#EAEAE4] dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] self-start sm:self-auto">
          {(
            [
              ['7d', '7 Days'],
              ['30d', '30 Days'],
              ['90d', '90 Days'],
              ['all', 'All Time'],
            ] as Array<[AnalyticsWindow, string]>
          ).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setWindowPreset(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                windowPreset === k
                  ? 'bg-[#15191E] text-[#C5F36B] dark:bg-[#C5F36B] dark:text-[#15191E]'
                  : 'text-[#525A63] dark:text-[#89919A]'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Valuation & Profit KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#89919A]">
            Gross Revenue (incl. Tax)
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums font-display">
            {formatCurrency(profit.grossRevenue, currency)}
          </p>
          <p className="mt-1 text-xs text-[#89919A] tabular-nums">
            Net sales (ex-tax): {formatCurrency(profit.netSalesExTax, currency)} · {activeSalesCount} orders
          </p>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#89919A]">
            Gross Profit &amp; Margin
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums font-display text-[#28815F] dark:text-[#68B88A]">
            {formatCurrency(profit.grossProfit, currency)}
          </p>
          <p className="mt-1 text-xs text-[#89919A] tabular-nums">
            Margin {marginPct}% · Net Est. {formatCurrency(profit.netProfitEstimate, currency)}
          </p>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#89919A]">
            COGS &amp; Purchase Spend
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums font-display">
            {formatCurrency(profit.cogs, currency)}
          </p>
          <p className="mt-1 text-xs text-[#89919A] tabular-nums">
            PO Spend: {formatCurrency(profit.purchaseSpend, currency)}
          </p>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#89919A]">
            Inventory Asset Value
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums font-display">
            {formatCurrency(valuation.totalCostValue, currency)}
          </p>
          <p className="mt-1 text-xs text-[#89919A] tabular-nums">
            Retail {formatCurrency(valuation.totalRetailValue, currency)} ({valuation.totalUnits} units)
          </p>
        </div>
      </div>

      {/* Primary Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display">Daily Sales Performance</h3>
          <p className="text-xs text-[#89919A] mb-4">Daily invoiced revenue across active transactions</p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySales}>
                <defs>
                  <linearGradient id="dailyArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#C5F36B" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#C5F36B" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#89919A" strokeOpacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#89919A' }} />
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
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#68B88A"
                  strokeWidth={2}
                  fill="url(#dailyArea)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display">Category Stock Distribution</h3>
          <p className="text-xs text-[#89919A] mb-4">Inventory cost value split by category</p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryDist}
                  dataKey="stockValue"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                  isAnimationActive={false}
                >
                  {categoryDist.map((entry, index) => (
                    <Cell key={index} fill={entry.color || '#C5F36B'} />
                  ))}
                </Pie>
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
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Purchase vs Sales & Product Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display">Purchases vs. Sales Trend</h3>
          <p className="text-xs text-[#89919A] mb-4">Monthly procurement spend vs. invoiced revenue</p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyComparison}>
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
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sales" name="Sales" fill="#C5F36B" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="purchases" name="Purchases" fill="#89919A" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display">Product Sales Comparison</h3>
          <p className="text-xs text-[#89919A] mb-4">Revenue generated by top-performing SKUs</p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productSalesChart} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#89919A" strokeOpacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#89919A' }} />
                <YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 11, fill: '#89919A' }} />
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
                <Bar dataKey="revenue" name="Revenue" fill="#68B88A" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Category & Supplier Performance Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display mb-3">Category Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] uppercase text-[#89919A]">
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">SKUs</th>
                  <th className="py-2 text-right">Stock Value</th>
                  <th className="py-2 text-right">Period Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
                {categoryPerformance.map((c) => (
                  <tr key={c.name} className="h-10">
                    <td className="font-semibold">{c.name}</td>
                    <td className="text-right tabular-nums">{c.skus}</td>
                    <td className="text-right tabular-nums">
                      {formatCurrency(c.stockValue, currency)}
                    </td>
                    <td className="text-right font-bold tabular-nums text-[#28815F] dark:text-[#68B88A]">
                      {formatCurrency(c.revenue, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display mb-3">Supplier Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] uppercase text-[#89919A]">
                  <th className="py-2">Supplier</th>
                  <th className="py-2 text-right">POs</th>
                  <th className="py-2 text-right">Period Spend</th>
                  <th className="py-2 text-right">On-Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
                {supplierPerformance.map((s) => (
                  <tr key={s.id} className="h-10">
                    <td className="font-semibold">{s.companyName}</td>
                    <td className="text-right tabular-nums">{s.poCount}</td>
                    <td className="text-right font-bold tabular-nums">
                      {formatCurrency(s.spend, currency)}
                    </td>
                    <td className="text-right font-semibold tabular-nums text-[#28815F] dark:text-[#68B88A]">
                      {s.onTimeRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Top Performing & Slow-Moving Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display mb-3">Top-Performing Products</h3>
          <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
            {topProducts.map((p) => (
              <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{p.fullName}</p>
                  <p className="font-mono text-[#89919A]">{p.sku}</p>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <p className="font-bold">{formatCurrency(p.revenue, currency)}</p>
                  <p className="text-[#89919A]">{p.unitsSold} units sold</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h3 className="text-base font-semibold font-display mb-3">Slow-Moving Inventory</h3>
          <div className="divide-y divide-[#E2E4DF] dark:divide-[#29323C] text-xs">
            {slowMovingProducts.map((p) => (
              <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{p.fullName}</p>
                  <p className="font-mono text-[#89919A]">{p.sku}</p>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <p className="font-semibold text-[#B4232A] dark:text-[#E56B6F]">
                    {p.unitsSold} sold
                  </p>
                  <p className="text-[#89919A]">{p.onHand} units sitting in stock</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
