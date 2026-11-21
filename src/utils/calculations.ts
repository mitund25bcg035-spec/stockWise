import type {
  Category,
  DateRangePreset,
  Product,
  Purchase,
  PurchaseItemInput,
  Sale,
  SaleItemInput,
} from '../types';

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export function getStockStatus(quantity: number, minStock: number): StockStatus {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= minStock) return 'low_stock';
  return 'in_stock';
}

export function calculateAvailableStock(quantity: number, reservedQty = 0): number {
  return Math.max(0, quantity - Math.max(0, reservedQty));
}

export function calculateProfitMarginPercent(purchasePrice: number, sellingPrice: number): number {
  if (sellingPrice <= 0) return 0;
  return Math.round(((sellingPrice - purchasePrice) / sellingPrice) * 1000) / 10;
}

export function calculateInventoryValuation(products: Product[]): {
  totalCostValue: number;
  totalRetailValue: number;
  potentialProfit: number;
  totalUnits: number;
} {
  let totalCostValue = 0;
  let totalRetailValue = 0;
  let totalUnits = 0;

  for (const p of products) {
    if (p.status === 'archived') continue;
    const qty = Math.max(0, p.quantity);
    totalUnits += qty;
    totalCostValue += qty * p.purchasePrice;
    totalRetailValue += qty * p.sellingPrice;
  }

  totalCostValue = Math.round(totalCostValue * 100) / 100;
  totalRetailValue = Math.round(totalRetailValue * 100) / 100;

  return {
    totalCostValue,
    totalRetailValue,
    potentialProfit: Math.round((totalRetailValue - totalCostValue) * 100) / 100,
    totalUnits,
  };
}

export function calculateSaleTotals(
  items: SaleItemInput[],
  discountType: 'percent' | 'fixed',
  discountValue: number,
  taxRate: number
): {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
} {
  const subtotal =
    Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;

  const safeDiscountVal = Math.max(0, discountValue);
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = Math.round(subtotal * (Math.min(100, safeDiscountVal) / 100) * 100) / 100;
  } else {
    discountAmount = Math.min(subtotal, Math.round(safeDiscountVal * 100) / 100);
  }

  const taxable = Math.max(0, subtotal - discountAmount);
  const taxAmount = Math.round(taxable * (Math.max(0, taxRate) / 100) * 100) / 100;
  const totalAmount = Math.round((taxable + taxAmount) * 100) / 100;

  return { subtotal, discountAmount, taxAmount, totalAmount };
}

export function validateSaleItems(
  items: SaleItemInput[],
  productStockMap: Record<number, { name: string; quantity: number; reservedQty?: number }>
): { valid: boolean; error?: string } {
  if (!items.length) {
    return { valid: false, error: 'Add at least one product to the invoice.' };
  }

  const requestedTotals = new Map<number, number>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { valid: false, error: 'All line item quantities must be positive integers.' };
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return { valid: false, error: 'Unit price cannot be negative.' };
    }
    const product = productStockMap[item.productId];
    if (!product) {
      return { valid: false, error: 'One or more selected products no longer exist.' };
    }
    requestedTotals.set(item.productId, (requestedTotals.get(item.productId) ?? 0) + item.quantity);
  }

  for (const [productId, totalQty] of requestedTotals.entries()) {
    const product = productStockMap[productId];
    const available = calculateAvailableStock(product.quantity, product.reservedQty ?? 0);
    if (totalQty > available) {
      return {
        valid: false,
        error: `Insufficient available stock for "${product.name}". Available: ${available}, requested: ${totalQty}.`,
      };
    }
  }

  return { valid: true };
}

export function calculatePurchaseTotal(items: PurchaseItemInput[]): number {
  return Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0) * 100) / 100;
}

export function calculatePurchaseTotalsWithTaxDiscount(
  items: PurchaseItemInput[],
  discountAmount = 0,
  taxRate = 0
): {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
} {
  const subtotal = calculatePurchaseTotal(items);
  const safeDiscount = Math.min(subtotal, Math.max(0, Math.round(discountAmount * 100) / 100));
  const taxable = Math.max(0, subtotal - safeDiscount);
  const taxAmount = Math.round(taxable * (Math.max(0, taxRate) / 100) * 100) / 100;
  const totalAmount = Math.round((taxable + taxAmount) * 100) / 100;
  return { subtotal, discountAmount: safeDiscount, taxAmount, totalAmount };
}

export function filterByDateRange<T extends { createdAt: string }>(
  records: T[],
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  now = new Date()
): T[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let minTs = 0;
  let maxTs = Number.POSITIVE_INFINITY;

  if (preset === 'today') {
    minTs = startOfToday;
  } else if (preset === '7d') {
    minTs = startOfToday - 6 * 24 * 60 * 60 * 1000;
  } else if (preset === '30d') {
    minTs = startOfToday - 29 * 24 * 60 * 60 * 1000;
  } else if (preset === '90d') {
    minTs = startOfToday - 89 * 24 * 60 * 60 * 1000;
  } else if (preset === 'custom') {
    if (customStart) minTs = new Date(`${customStart}T00:00:00`).getTime();
    if (customEnd) maxTs = new Date(`${customEnd}T23:59:59.999`).getTime();
  }

  return records.filter((r) => {
    const ts = new Date(r.createdAt).getTime();
    if (Number.isNaN(ts)) return false;
    return ts >= minTs && ts <= maxTs;
  });
}

export function buildCsvString(headers: string[], rows: Array<Array<string | number>>): string {
  const escapeCell = (val: string | number): string => {
    let str = String(val ?? '');
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join(
    '\n'
  );
}

export function isActiveSale(sale: Pick<Sale, 'status'>): boolean {
  return sale.status !== 'refunded' && sale.status !== 'cancelled';
}

export function calculateSalesGrowthPercent(sales: Sale[], now = new Date()): number {
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const prevMonthDate = new Date(thisYear, thisMonth - 1, 1);
  const prevMonth = prevMonthDate.getMonth();
  const prevYear = prevMonthDate.getFullYear();

  let currentTotal = 0;
  let previousTotal = 0;

  for (const sale of sales) {
    if (!isActiveSale(sale)) continue;
    const d = new Date(sale.createdAt);
    if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) {
      currentTotal += sale.totalAmount;
    } else if (d.getFullYear() === prevYear && d.getMonth() === prevMonth) {
      previousTotal += sale.totalAmount;
    }
  }

  if (previousTotal === 0) {
    return currentTotal > 0 ? 100 : 0;
  }
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 1000) / 10;
}

export function computeCategoryDistribution(
  products: Product[],
  categories: Category[]
): Array<{ name: string; stockValue: number; units: number; color: string }> {
  const catMap = new Map<number, Category>();
  for (const c of categories) catMap.set(c.id, c);

  const buckets = new Map<string, { name: string; stockValue: number; units: number; color: string }>();
  for (const p of products) {
    if (p.status === 'archived') continue;
    const cat = p.categoryId ? catMap.get(p.categoryId) : undefined;
    const name = cat?.name ?? p.categoryName ?? 'Uncategorized';
    const color = cat?.color ?? '#89919A';
    const entry = buckets.get(name) ?? { name, stockValue: 0, units: 0, color };
    entry.units += Math.max(0, p.quantity);
    entry.stockValue =
      Math.round((entry.stockValue + Math.max(0, p.quantity) * p.purchasePrice) * 100) / 100;
    buckets.set(name, entry);
  }

  return Array.from(buckets.values()).sort((a, b) => b.stockValue - a.stockValue);
}

export function computeProfitEstimate(
  sales: Sale[],
  purchases: Purchase[]
): {
  grossRevenue: number;
  netSalesExTax: number;
  cogs: number;
  grossProfit: number;
  netProfitEstimate: number;
  purchaseSpend: number;
} {
  let grossRevenue = 0;
  let netSalesExTax = 0;
  let cogs = 0;

  for (const s of sales) {
    if (!isActiveSale(s)) continue;
    grossRevenue += s.totalAmount;
    netSalesExTax += Math.max(0, s.subtotal - s.discountAmount);
    for (const item of s.items ?? []) {
      cogs += item.quantity * item.unitCost;
    }
  }

  const purchaseSpend = purchases
    .filter((po) => po.status !== 'cancelled')
    .reduce((sum, po) => sum + po.totalAmount, 0);

  grossRevenue = Math.round(grossRevenue * 100) / 100;
  netSalesExTax = Math.round(netSalesExTax * 100) / 100;
  cogs = Math.round(cogs * 100) / 100;
  const grossProfit = Math.round((netSalesExTax - cogs) * 100) / 100;
  // Operating margin estimate excludes collected pass-through tax and accounts for COGS
  const netProfitEstimate = Math.round((grossRevenue - cogs - (grossRevenue - netSalesExTax)) * 100) / 100;

  return {
    grossRevenue,
    netSalesExTax,
    cogs,
    grossProfit,
    netProfitEstimate,
    purchaseSpend: Math.round(purchaseSpend * 100) / 100,
  };
}
