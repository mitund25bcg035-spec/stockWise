import { db } from '../db.ts';
import {
  calculateAvailableStock,
  calculateInventoryValuation,
  getStockStatus,
  isActiveSale,
} from '../../src/utils/calculations.ts';
import type { NavModuleId } from '../../src/types.ts';

export interface LiveDataCitation {
  category: string;
  summary: string;
  module: NavModuleId;
}

export interface LiveDataResult {
  categories: string[];
  citations: LiveDataCitation[];
  suggestedLinks: Array<{ label: string; module: NavModuleId }>;
  contextText: string;
}

function getBusinessCurrency(businessId: number): { name: string; currency: string } {
  const row = db
    .prepare('SELECT name, currency FROM businesses WHERE id = ?')
    .get(businessId) as { name?: string; currency?: string } | undefined;
  return {
    name: row?.name || 'StockWise Operations',
    currency: row?.currency || 'USD',
  };
}

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getInventorySnapshot(businessId: number) {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.purchase_price, p.selling_price, p.quantity, p.reserved_qty, p.min_stock, p.unit, p.status,
              c.name as category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.business_id = ?`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  const mapped = rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    sku: String(r.sku),
    barcode: '',
    categoryId: null,
    supplierId: null,
    purchasePrice: Number(r.purchase_price ?? 0),
    sellingPrice: Number(r.selling_price ?? 0),
    quantity: Number(r.quantity ?? 0),
    reservedQty: Number(r.reserved_qty ?? 0),
    minStock: Number(r.min_stock ?? 0),
    maxStock: 0,
    unit: String(r.unit || 'pcs'),
    status: (r.status === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
    description: '',
    imageUrl: '',
    updatedAt: '',
    createdAt: '',
    categoryName: r.category_name ? String(r.category_name) : 'Uncategorized',
  }));

  const active = mapped.filter((p) => p.status === 'active');
  const archivedCount = mapped.length - active.length;
  const valuation = calculateInventoryValuation(active);

  const lowStock = active
    .filter((p) => {
      const available = calculateAvailableStock(p.quantity, p.reservedQty);
      return getStockStatus(available, p.minStock) === 'low_stock';
    })
    .sort((a, b) => a.quantity - b.quantity);

  const outOfStock = active.filter(
    (p) => getStockStatus(calculateAvailableStock(p.quantity, p.reservedQty), p.minStock) === 'out_of_stock'
  );

  return {
    activeCount: active.length,
    archivedCount,
    valuation,
    lowStock,
    outOfStock,
    topValued: [...active]
      .sort((a, b) => b.quantity * b.purchasePrice - a.quantity * a.purchasePrice)
      .slice(0, 5),
  };
}

export function getSalesSnapshot(businessId: number) {
  const salesRows = db
    .prepare(
      `SELECT id, invoice_number, customer_name, total_amount, amount_paid, status, payment_method, created_at
       FROM sales
       WHERE business_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  const mapped = salesRows.map((r) => ({
    id: Number(r.id),
    invoiceNumber: String(r.invoice_number),
    customerName: String(r.customer_name || 'Walk-in Customer'),
    totalAmount: Number(r.total_amount ?? 0),
    amountPaid: Number(r.amount_paid ?? 0),
    status: String(r.status) as 'paid' | 'pending' | 'partial' | 'refunded' | 'cancelled',
    paymentMethod: String(r.payment_method),
    createdAt: String(r.created_at),
  }));

  const activeSales = mapped.filter((s) => isActiveSale({ status: s.status }));
  const totalRevenue = activeSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const outstandingReceivables = activeSales.reduce(
    (sum, s) => sum + Math.max(0, s.totalAmount - s.amountPaid),
    0
  );

  const topProductsRows = db
    .prepare(
      `SELECT si.product_id, si.product_name, si.sku,
              SUM(si.quantity) as units_sold,
              SUM(si.line_total) as gross_sales
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.business_id = ?
         AND s.status NOT IN ('cancelled', 'refunded')
       GROUP BY si.product_id, si.product_name, si.sku
       ORDER BY units_sold DESC, gross_sales DESC
       LIMIT 6`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  return {
    totalActiveOrders: activeSales.length,
    paidCount: activeSales.filter((s) => s.status === 'paid').length,
    openCount: activeSales.filter((s) => s.status === 'pending' || s.status === 'partial').length,
    totalRevenue,
    outstandingReceivables,
    recentSales: mapped.slice(0, 6),
    topProducts: topProductsRows.map((r) => ({
      productName: String(r.product_name),
      sku: String(r.sku),
      unitsSold: Number(r.units_sold ?? 0),
      grossSales: Number(r.gross_sales ?? 0),
    })),
  };
}

export function getPurchaseSnapshot(businessId: number) {
  const poRows = db
    .prepare(
      `SELECT id, po_number, supplier_name, status, total_amount, expected_date, created_at
       FROM purchases
       WHERE business_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  const mapped = poRows.map((r) => ({
    id: Number(r.id),
    poNumber: String(r.po_number),
    supplierName: String(r.supplier_name || 'Unknown Supplier'),
    status: String(r.status),
    totalAmount: Number(r.total_amount ?? 0),
    expectedDate: r.expected_date ? String(r.expected_date) : null,
    createdAt: String(r.created_at),
  }));

  const pendingOrOpen = mapped.filter((p) =>
    ['draft', 'pending', 'ordered', 'partially_received'].includes(p.status)
  );

  return {
    totalOrders: mapped.length,
    openCount: pendingOrOpen.length,
    openTotal: pendingOrOpen.reduce((s, p) => s + p.totalAmount, 0),
    openOrders: pendingOrOpen.slice(0, 8),
    recentOrders: mapped.slice(0, 5),
  };
}

export function getPartnerSnapshot(businessId: number) {
  const suppliers = db
    .prepare(
      `SELECT company_name, contact_name, email, outstanding_balance, on_time_rate, status
       FROM suppliers WHERE business_id = ? AND status = 'active'
       ORDER BY outstanding_balance DESC, company_name ASC`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  const customerCount = db
    .prepare("SELECT COUNT(*) as c FROM customers WHERE business_id = ? AND status = 'active'")
    .get(businessId) as { c: number };

  const categoryCount = db
    .prepare('SELECT COUNT(*) as c FROM categories WHERE business_id = ?')
    .get(businessId) as { c: number };

  return {
    activeSuppliers: suppliers.map((s) => ({
      companyName: String(s.company_name),
      contactName: String(s.contact_name || ''),
      outstandingBalance: Number(s.outstanding_balance ?? 0),
      onTimeRate: Number(s.on_time_rate ?? 0),
    })),
    activeCustomersCount: Number(customerCount.c ?? 0),
    categoryCount: Number(categoryCount.c ?? 0),
  };
}

export function getUpcomingReminders(businessId: number) {
  const rows = db
    .prepare(
      `SELECT title, event_date, event_type, completed
       FROM calendar_events
       WHERE business_id = ? AND completed = 0
       ORDER BY event_date ASC
       LIMIT 6`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    title: String(r.title),
    eventDate: String(r.event_date),
    eventType: String(r.event_type),
  }));
}

export function fetchAuthorizedLiveContext(businessId: number, userQuery: string): LiveDataResult {
  const q = userQuery.toLowerCase();
  const biz = getBusinessCurrency(businessId);
  const currency = biz.currency;

  const wantsBriefing =
    /today|check|briefing|summary|summarize|overview|status|health|alert|priority|dashboard/.test(q);
  const wantsInventory =
    wantsBriefing ||
    /product|inventory|stock|sku|value|valuation|low|out of stock|empty|reorder|unit|how many/.test(q);
  const wantsSales =
    wantsBriefing ||
    /sale|sell|selling|revenue|invoice|top|best|highest|most|customer|paid|pending payment|receivable/.test(
      q
    );
  const wantsPurchases =
    wantsBriefing ||
    /purchase|po\b|restock|incoming|shipment|receive|pending purchase|supplier|vendor/.test(q);

  // If query is purely conceptual/how-to without live metrics keywords, still expose minimal workspace totals only when relevant
  const categories: string[] = [];
  const citations: LiveDataCitation[] = [];
  const suggestedLinks: Array<{ label: string; module: NavModuleId }> = [];
  const sections: string[] = [];

  if (wantsInventory) {
    const inv = getInventorySnapshot(businessId);
    categories.push('Live Inventory & Valuation');
    citations.push({
      category: 'Live Inventory & Valuation',
      summary: `${inv.activeCount} active SKUs (${inv.valuation.totalUnits} units), Cost Value ${fmtMoney(
        inv.valuation.totalCostValue,
        currency
      )}, ${inv.lowStock.length} low-stock, ${inv.outOfStock.length} out-of-stock.`,
      module: 'inventory',
    });
    suggestedLinks.push({ label: 'Open Inventory', module: 'inventory' });
    if (inv.lowStock.length > 0 || inv.outOfStock.length > 0) {
      suggestedLinks.push({ label: 'Review Products', module: 'products' });
    }

    sections.push(
      [
        `### Live Inventory & Valuation (${biz.name})`,
        `- Active Products: ${inv.activeCount} (Archived: ${inv.archivedCount})`,
        `- Total Units On Hand: ${inv.valuation.totalUnits}`,
        `- Total Cost Valuation: ${fmtMoney(inv.valuation.totalCostValue, currency)}`,
        `- Total Retail Valuation: ${fmtMoney(inv.valuation.totalRetailValue, currency)}`,
        `- Potential Gross Margin Value: ${fmtMoney(inv.valuation.potentialProfit, currency)}`,
        `- Out-of-Stock Products (${inv.outOfStock.length}): ${
          inv.outOfStock.length === 0
            ? 'None'
            : inv.outOfStock.map((p) => `${p.name} [${p.sku}] (0 / min ${p.minStock})`).join('; ')
        }`,
        `- Low-Stock Products (${inv.lowStock.length}): ${
          inv.lowStock.length === 0
            ? 'None'
            : inv.lowStock
                .map(
                  (p) =>
                    `${p.name} [${p.sku}] (${calculateAvailableStock(p.quantity, p.reservedQty)} avail / min ${p.minStock})`
                )
                .join('; ')
        }`,
      ].join('\n')
    );
  }

  if (wantsSales) {
    const sales = getSalesSnapshot(businessId);
    categories.push('Live Sales & Top Products');
    citations.push({
      category: 'Live Sales & Top Products',
      summary: `${sales.totalActiveOrders} active invoices (${fmtMoney(
        sales.totalRevenue,
        currency
      )} revenue; ${sales.openCount} open/partial).`,
      module: 'sales',
    });
    suggestedLinks.push({ label: 'Open Sales', module: 'sales' });

    sections.push(
      [
        `### Live Sales & Top-Selling Products (${biz.name})`,
        `- Active Invoices: ${sales.totalActiveOrders} (Paid: ${sales.paidCount}, Open/Partial: ${sales.openCount})`,
        `- Active Revenue Total: ${fmtMoney(sales.totalRevenue, currency)}`,
        `- Outstanding Receivables: ${fmtMoney(sales.outstandingReceivables, currency)}`,
        `- Top-Selling Products: ${
          sales.topProducts.length === 0
            ? 'No active sales items recorded yet.'
            : sales.topProducts
                .map((p) => `${p.productName} [${p.sku}]: ${p.unitsSold} units (${fmtMoney(p.grossSales, currency)})`)
                .join('; ')
        }`,
        `- Recent Invoices: ${
          sales.recentSales.length === 0
            ? 'None'
            : sales.recentSales
                .map(
                  (s) =>
                    `${s.invoiceNumber} · ${s.customerName} · ${fmtMoney(s.totalAmount, currency)} (${s.status})`
                )
                .join('; ')
        }`,
      ].join('\n')
    );
  }

  if (wantsPurchases) {
    const po = getPurchaseSnapshot(businessId);
    const partners = getPartnerSnapshot(businessId);
    categories.push('Live Purchase Orders & Suppliers');
    citations.push({
      category: 'Live Purchase Orders & Suppliers',
      summary: `${po.openCount} open/pending POs (${fmtMoney(
        po.openTotal,
        currency
      )}), ${partners.activeSuppliers.length} active suppliers.`,
      module: 'purchases',
    });
    suggestedLinks.push({ label: 'Open Purchases', module: 'purchases' });
    if (/supplier|vendor/.test(q)) {
      suggestedLinks.push({ label: 'Open Suppliers', module: 'suppliers' });
    }

    sections.push(
      [
        `### Live Purchase Orders & Suppliers (${biz.name})`,
        `- Total Purchase Orders: ${po.totalOrders} (Open/Pending/Draft/Partial: ${po.openCount}, Open Value: ${fmtMoney(po.openTotal, currency)})`,
        `- Open/Pending Purchase Orders: ${
          po.openOrders.length === 0
            ? 'None'
            : po.openOrders
                .map(
                  (p) =>
                    `${p.poNumber} · ${p.supplierName} · ${p.status} · ${fmtMoney(p.totalAmount, currency)}${
                      p.expectedDate ? ` (Expected: ${p.expectedDate})` : ''
                    }`
                )
                .join('; ')
        }`,
        `- Active Suppliers (${partners.activeSuppliers.length}): ${partners.activeSuppliers
          .map(
            (s) =>
              `${s.companyName} (Balance: ${fmtMoney(s.outstandingBalance, currency)}, On-time: ${s.onTimeRate}%)`
          )
          .join('; ')}`,
      ].join('\n')
    );
  }

  if (wantsBriefing) {
    const reminders = getUpcomingReminders(businessId);
    if (reminders.length > 0) {
      suggestedLinks.push({ label: 'Open Calendar', module: 'calendar' });
      sections.push(
        [
          '### Upcoming Operational Reminders',
          ...reminders.map((r) => `- ${r.eventDate}: ${r.title} (${r.eventType})`),
        ].join('\n')
      );
    }
  }

  // Deduplicate suggested links
  const uniqueLinks = Array.from(
    new Map(suggestedLinks.map((item) => [item.module, item])).values()
  ).slice(0, 4);

  return {
    categories,
    citations,
    suggestedLinks: uniqueLinks,
    contextText: sections.join('\n\n'),
  };
}
