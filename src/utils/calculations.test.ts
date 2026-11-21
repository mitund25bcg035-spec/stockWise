import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsvString,
  calculateAvailableStock,
  calculateInventoryValuation,
  calculateProfitMarginPercent,
  calculatePurchaseTotal,
  calculatePurchaseTotalsWithTaxDiscount,
  calculateSalesGrowthPercent,
  calculateSaleTotals,
  computeProfitEstimate,
  filterByDateRange,
  getStockStatus,
  validateSaleItems,
} from './calculations';
import type { Product, Purchase, Sale } from '../types';

test('getStockStatus classifies out_of_stock, low_stock, and in_stock accurately', () => {
  assert.equal(getStockStatus(0, 5), 'out_of_stock');
  assert.equal(getStockStatus(-1, 5), 'out_of_stock');
  assert.equal(getStockStatus(5, 5), 'low_stock');
  assert.equal(getStockStatus(3, 5), 'low_stock');
  assert.equal(getStockStatus(6, 5), 'in_stock');
});

test('calculateAvailableStock and calculateProfitMarginPercent compute accurately', () => {
  assert.equal(calculateAvailableStock(12, 4), 8);
  assert.equal(calculateAvailableStock(3, 5), 0);
  assert.equal(calculateProfitMarginPercent(50, 100), 50);
  assert.equal(calculateProfitMarginPercent(75, 100), 25);
  assert.equal(calculateProfitMarginPercent(50, 0), 0);
});

test('calculateInventoryValuation computes cost, retail, and profit excluding archived SKUs', () => {
  const sample: Product[] = [
    {
      id: 1,
      name: 'Keyboard',
      sku: 'KB-1',
      barcode: '',
      categoryId: 1,
      supplierId: 1,
      purchasePrice: 50,
      sellingPrice: 120,
      quantity: 10,
      reservedQty: 0,
      minStock: 2,
      maxStock: 50,
      unit: 'pcs',
      status: 'active',
      description: '',
      imageUrl: '',
      updatedAt: '',
      createdAt: '',
    },
    {
      id: 2,
      name: 'Archived Item',
      sku: 'ARC-1',
      barcode: '',
      categoryId: 1,
      supplierId: 1,
      purchasePrice: 100,
      sellingPrice: 200,
      quantity: 5,
      reservedQty: 0,
      minStock: 1,
      maxStock: 20,
      unit: 'pcs',
      status: 'archived',
      description: '',
      imageUrl: '',
      updatedAt: '',
      createdAt: '',
    },
  ];
  const val = calculateInventoryValuation(sample);
  assert.equal(val.totalUnits, 10);
  assert.equal(val.totalCostValue, 500);
  assert.equal(val.totalRetailValue, 1200);
  assert.equal(val.potentialProfit, 700);
});

test('calculateSaleTotals handles percent and fixed discounts with tax', () => {
  const pct = calculateSaleTotals([{ productId: 1, quantity: 2, unitPrice: 100 }], 'percent', 10, 10);
  assert.deepEqual(pct, {
    subtotal: 200,
    discountAmount: 20,
    taxAmount: 18,
    totalAmount: 198,
  });

  const fixed = calculateSaleTotals([{ productId: 1, quantity: 1, unitPrice: 50 }], 'fixed', 100, 8);
  assert.deepEqual(fixed, {
    subtotal: 50,
    discountAmount: 50,
    taxAmount: 0,
    totalAmount: 0,
  });
});

test('validateSaleItems prevents overselling across duplicate lines and respects reserved stock', () => {
  const stock = {
    1: { name: 'Studio Mic', quantity: 5, reservedQty: 1 },
  };
  assert.equal(validateSaleItems([{ productId: 1, quantity: 4, unitPrice: 100 }], stock).valid, true);
  assert.equal(validateSaleItems([{ productId: 1, quantity: 5, unitPrice: 100 }], stock).valid, false);
  const dup = validateSaleItems(
    [
      { productId: 1, quantity: 3, unitPrice: 100 },
      { productId: 1, quantity: 2, unitPrice: 100 },
    ],
    stock
  );
  assert.equal(dup.valid, false);
});

test('calculatePurchaseTotal and tax/discount totals compute cleanly', () => {
  assert.equal(
    calculatePurchaseTotal([
      { productId: 1, quantity: 4, unitCost: 12.5 },
      { productId: 2, quantity: 3, unitCost: 10 },
    ]),
    80
  );
  const full = calculatePurchaseTotalsWithTaxDiscount(
    [{ productId: 1, quantity: 2, unitCost: 100 }],
    20,
    10
  );
  assert.deepEqual(full, {
    subtotal: 200,
    discountAmount: 20,
    taxAmount: 18,
    totalAmount: 198,
  });
});

test('filterByDateRange filters today, 7d, 30d, 90d, and custom ranges accurately', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const items = [
    { id: 1, createdAt: '2026-06-15T09:00:00Z' },
    { id: 2, createdAt: '2026-06-10T09:00:00Z' },
    { id: 3, createdAt: '2026-05-25T09:00:00Z' },
    { id: 4, createdAt: '2026-04-01T09:00:00Z' },
  ];
  assert.equal(filterByDateRange(items, 'today', undefined, undefined, now).length, 1);
  assert.equal(filterByDateRange(items, '7d', undefined, undefined, now).length, 2);
  assert.equal(filterByDateRange(items, '30d', undefined, undefined, now).length, 3);
  assert.equal(filterByDateRange(items, '90d', undefined, undefined, now).length, 4);
  assert.equal(filterByDateRange(items, 'custom', '2026-05-20', '2026-06-11', now).length, 2);
});

test('calculateSalesGrowthPercent and computeProfitEstimate ignore cancelled/refunded orders', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const sales: Sale[] = [
    {
      id: 1,
      invoiceNumber: 'INV-1',
      customerId: null,
      customerName: 'A',
      subtotal: 100,
      discountType: 'percent',
      discountValue: 0,
      discountAmount: 0,
      taxRate: 10,
      taxAmount: 10,
      totalAmount: 110,
      amountPaid: 110,
      paymentMethod: 'card',
      status: 'paid',
      notes: '',
      items: [{ id: 1, saleId: 1, productId: 1, productName: 'X', sku: 'X', quantity: 2, unitPrice: 50, unitCost: 30, lineTotal: 100 }],
      createdAt: '2026-05-10T10:00:00Z',
    },
    {
      id: 2,
      invoiceNumber: 'INV-2',
      customerId: null,
      customerName: 'B',
      subtotal: 200,
      discountType: 'percent',
      discountValue: 0,
      discountAmount: 0,
      taxRate: 10,
      taxAmount: 20,
      totalAmount: 220,
      amountPaid: 220,
      paymentMethod: 'card',
      status: 'paid',
      notes: '',
      items: [{ id: 2, saleId: 2, productId: 1, productName: 'X', sku: 'X', quantity: 4, unitPrice: 50, unitCost: 30, lineTotal: 200 }],
      createdAt: '2026-06-10T10:00:00Z',
    },
    {
      id: 3,
      invoiceNumber: 'INV-3',
      customerId: null,
      customerName: 'C',
      subtotal: 500,
      discountType: 'percent',
      discountValue: 0,
      discountAmount: 0,
      taxRate: 0,
      taxAmount: 0,
      totalAmount: 500,
      amountPaid: 0,
      paymentMethod: 'card',
      status: 'cancelled',
      notes: '',
      createdAt: '2026-06-12T10:00:00Z',
    },
  ];
  assert.equal(calculateSalesGrowthPercent(sales, now), 100);
  const profit = computeProfitEstimate(sales, [] as Purchase[]);
  assert.equal(profit.grossRevenue, 330);
  assert.equal(profit.netSalesExTax, 300);
  assert.equal(profit.cogs, 180);
  assert.equal(profit.grossProfit, 120);
});

test('buildCsvString escapes quotes, commas, and formula prefixes', () => {
  const csv = buildCsvString(['Name', 'Note'], [['Test, Inc', '=SUM(A1:A2)']]);
  assert.equal(csv, 'Name,Note\n"Test, Inc",\'=SUM(A1:A2)');
});
