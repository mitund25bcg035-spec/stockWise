export interface SampleKnowledgeDocument {
  sourceKey: string;
  title: string;
  description: string;
  documentType: 'manual' | 'guide' | 'policy' | 'faq';
  content: string;
}

export const SAMPLE_KNOWLEDGE_DOCUMENTS: SampleKnowledgeDocument[] = [
  {
    sourceKey: 'sample-doc-1-user-manual',
    title: 'StockWise User Manual',
    description:
      'Sample Documentation: Complete walkthrough of StockWise modules, navigation, and day-to-day workflows.',
    documentType: 'manual',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# StockWise User Manual

## What StockWise Does
StockWise is an inventory management and business intelligence platform designed for small and medium-sized businesses, wholesalers, retail shops, and distributors. It centralizes product catalogs, atomic stock movements, supplier purchase orders, customer invoicing, valuation analytics, operational calendars, notifications, and role-based team governance inside isolated multi-business workspaces.

## Dashboard Navigation
The collapsible left sidebar organizes StockWise into four operational sections:
- Operations: Dashboard, Products, Inventory, Categories
- Commerce: Suppliers, Customers, Sales, Purchases
- Intelligence: Analytics, Reports, Calendar, Notifications
- Administration: User Management, AI Knowledge Base, Settings

The top header includes a Global Search palette (Command/Ctrl+K) that jumps directly to matching products, SKUs, categories, suppliers, customers, invoices, or purchase orders, a Quick Create menu for common tasks, a Light/Dark theme toggle, unread notification indicator, and a workspace switcher when multiple businesses are configured.

## Core Modules Overview
- Dashboard: Displays 8 KPI cards (Total Products, Total Inventory Value, Total Sales, Total Revenue, Low-Stock Products, Out-of-Stock Products, Total Suppliers, Total Customers) with Today, 7 Days, 30 Days, 90 Days, and Custom Range filtering, alongside Revenue Overview, Inventory Health, Monthly Sales Trends, Category Stock Value, Top-Selling Products, Slow-Moving Products, Low-Stock Alerts, Recent Transactions, Recent Stock Movements, and Reminders.
- Product Management: Add, edit, duplicate, archive, restore, or delete SKUs with cost price, selling price, minimum/maximum stock levels, unit of measure, barcode, category, supplier, and product imagery. Switch between Table and Grid views with live search, filtering, sorting, and pagination.
- Inventory Management: Monitor Cost Valuation, Retail Valuation, and total Units On Hand. Record Stock In, Stock Out, Adjust (+/-), Return (+), Damaged (-), and Transfer (-) movements with mandatory audit reasons.
- Category Management: Color-coded product categories showing assigned SKU counts, total units, and category stock value, with safe Reassign & Delete protection when products are still assigned.
- Supplier Management: Maintain vendor contacts, city/state/country, outstanding balances, on-time delivery metrics, purchase histories, and archive/restore controls.
- Customer Management: Track customer accounts, billing locations, order frequency, lifetime spend, and purchase histories.
- Sales Management: Create multi-line customer invoices with percentage or fixed discounts, configurable tax rates, payment method tracking, partial payment recording, invoice printing, and automatic inventory deduction.
- Purchase Management: Draft, submit, approve, partially receive, or fully receive supplier purchase orders, automatically incrementing stock and logging purchase intake movements.
- Analytics: Deep-dive visual intelligence comparing Daily Sales Performance, Category Stock Distribution, Purchases vs. Sales Trend, Product Sales Comparison, Category & Supplier Performance, and Slow-Moving Inventory across 7D, 30D, 90D, and All-Time windows.
- Reports: Generate 10 exportable reports (Inventory Summary, Low-Stock, Out-of-Stock, Valuation, Sales, Purchases, Profitability & COGS, Stock Movements, Suppliers, Customers) with CSV download and Print/PDF output.
- Calendar & Notifications: Schedule warehouse cycle counts, expected PO deliveries, and reminders in Month, Week, or Day views, and receive automatic low-stock and out-of-stock alerts.
- Settings: Configure multi-business workspaces, company profile, currency, default tax rate, date format, language, alert toggles, Light/Dark theme, and account password updates.`,
  },
  {
    sourceKey: 'sample-doc-2-inventory-guide',
    title: 'Inventory Management Guide',
    description:
      'Sample Documentation: Stock-in, stock-out, adjustments, valuation formulas, and alert thresholds.',
    documentType: 'guide',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# Inventory Management Guide

## Stock-In Process
Use Stock In when adding verified units to warehouse shelves outside of a formal Purchase Order (for example, opening balance intake or found inventory). Select the product, enter a positive integer quantity, and supply a clear audit reason. StockWise increments quantity atomically and records a stock_in entry in the Movement Ledger.

## Stock-Out Process
Use Stock Out for manual internal consumption, promotional samples, or non-invoiced dispatches. StockWise verifies that sufficient unreserved stock is available before deducting units so physical stock never drops below zero or reserved commitments.

## Stock Adjustments, Returns, Damaged & Transfers
- Adjust (+/-): Use for physical cycle-count reconciliation (+N to add surplus units, -N to deduct shrinkage).
- Return (+): Restocks returned sellable merchandise back into available inventory.
- Damaged (-): Deducts unsellable or broken items (such as crushed cartons) with a mandatory audit note.
- Transfer (-): Records stock moved out to an alternate fulfillment location or branch.

## Low-Stock and Out-of-Stock Identification
- Out of Stock: Quantity on hand is 0 or less. StockWise automatically triggers an out_of_stock notification when alerts are enabled.
- Low Stock: Quantity on hand is greater than 0 and less than or equal to the SKU's configured Minimum Stock Level (min_stock).
- In Stock (Healthy): Quantity on hand exceeds min_stock.
Once restocked above min_stock via a purchase receipt or Stock In, unresolved low-stock and out-of-stock alerts for that SKU automatically clear.

## Inventory Valuation & Stock Movement Tracking
- Cost Valuation = SUM(quantity * purchase_price) across active (non-archived) SKUs.
- Retail Valuation = SUM(quantity * selling_price) across active SKUs.
- Potential Gross Margin Value = Retail Valuation - Cost Valuation.
Every stock change writes an immutable ledger entry containing timestamp, SKU, movement type, previous quantity, delta, new quantity, reason, reference code, and acting user.

## Inventory Best Practices
1. Run weekly cycle counts on high-velocity SKUs using the Adjust (+/-) workflow.
2. Set min_stock to cover supplier lead time plus safety buffer.
3. Archive discontinued products instead of deleting historical transaction records.`,
  },
  {
    sourceKey: 'sample-doc-3-product-guide',
    title: 'Product Management Guide',
    description:
      'Sample Documentation: Creating SKUs, pricing margins, categories, imagery, and reorder thresholds.',
    documentType: 'guide',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# Product Management Guide

## Creating and Updating Products
Authorized users (Admins and Staff with canEditProducts permission) can add products from the Products module or the Quick Create header button. Required fields are Product Name and a unique SKU (automatically normalized to uppercase per business workspace).

## SKU and Barcode Management
Each SKU must be unique within the active business workspace. You can also assign a 12/13-digit barcode (UPC/EAN) to enable instant lookup from Global Search or the Products filter bar. Use the Duplicate action on an existing product row to quickly create a variant with a new SKU suffix.

## Product Categories and Suppliers
Assign each SKU to a Category and primary Supplier. If you need to remove a category that still contains products, StockWise blocks accidental deletion (HTTP 409) and presents a Reassign & Delete dialog to move SKUs safely to another category first.

## Product Pricing and Profit Margin
Enter both Purchase Price (unit cost) and Selling Price (unit retail price). StockWise automatically computes Profit Margin % = ((Selling Price - Purchase Price) / Selling Price) * 100 and uses unit cost snapshots on sales invoices for accurate COGS and profitability reporting.

## Product Images
Upload JPG, PNG, or WebP product thumbnails directly inside the Product form (stored as validated image data URLs up to 2.5 MB). If an image is omitted, StockWise displays a clean monogram fallback without broken image frames.

## Minimum and Maximum Stock Levels
- Minimum Stock Level (min_stock): Triggers Low Stock status and automated reorder alerts when quantity <= min_stock.
- Maximum Stock Level (max_stock): Guides purchasing teams on target replenishment caps during Purchase Order creation.`,
  },
  {
    sourceKey: 'sample-doc-4-sales-guide',
    title: 'Sales Management Guide',
    description:
      'Sample Documentation: Multi-line invoicing, discounts, tax math, partial payments, and stock updates.',
    documentType: 'guide',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# Sales Management Guide

## Creating Sales and Adding Products
From the Sales module (or Quick Create > New Sale Invoice), choose an existing Customer or leave as Walk-in Customer. Add one or more active products, adjust quantities and unit prices if needed, and verify live stock availability displayed next to each item.

## Validation and Atomic Inventory Updates
StockWise aggregates duplicate product lines before validation and blocks any sale where requested quantity exceeds Available Stock (quantity - reserved_qty). When a sale is confirmed, all line items are deducted inside a single atomic database transaction and logged as 'sale' movements referencing the generated invoice number (for example, INV-2026-1008).

## Discounts and Tax Calculations
- Percent Discount: discount_amount = subtotal * (discount_value / 100)
- Fixed Discount: discount_amount = min(discount_value, subtotal)
- Taxable Base: subtotal - discount_amount
- Tax Amount: taxable_base * (tax_rate / 100), defaulting to the business tax rate in Settings
- Total Amount: taxable_base + tax_amount

## Invoice Statuses, Partial Payments, and Refunds
Invoices support statuses: Paid, Pending, Partial, Refunded, and Cancelled.
- Paid: amount_paid >= total_amount.
- Partial: 0 < amount_paid < total_amount. Use Record Payment on an open or partial invoice to collect remaining installments.
- Cancelled or Refunded: Cancelling or refunding a sale automatically restores sold item quantities back into inventory and records a 'return' stock movement. Cancelled and refunded invoices are excluded from active revenue and profit totals.

## Invoice Generation and Sales History
Click View/Print on any invoice row to inspect full line-item breakdowns, discount/tax lines, payment status, and print a clean commercial invoice.`,
  },
  {
    sourceKey: 'sample-doc-5-purchase-guide',
    title: 'Purchase Management Guide',
    description:
      'Sample Documentation: Supplier purchase orders, approval lifecycle, partial receipts, and stock intake.',
    documentType: 'guide',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# Purchase Management Guide

## Creating Purchase Orders
Authorized Staff (canManagePurchases) and Admins can create Purchase Orders under Purchases > Create Purchase Order. Select an active Supplier, set an optional Expected Delivery Date, choose an initial status (Draft, Pending, Ordered, or Received Immediately), and add one or more SKUs with order quantities and unit costs. Discounts and tax rates can be applied to calculate net PO total.

## Purchase Order Lifecycle Statuses
StockWise supports six PO statuses:
1. Draft: Initial planning state; does not affect inventory or supplier balances.
2. Pending: Submitted internally for manager review/approval.
3. Ordered: Sent to the supplier and awaiting shipment; appears as expected delivery on the Calendar when an expected date is set.
4. Partially Received: Some line items have arrived via Receive Goods while remaining units are still open on backorder.
5. Received: All ordered units across all lines have arrived; received_at timestamp is recorded.
6. Cancelled: Order voided before full receipt.

## Receiving Goods and Automatic Stock Updates
Click Receive Goods on any Pending, Ordered, or Partially Received PO to open the shipment receiving modal. Enter the quantity arriving per line item (up to remaining unreceived quantity). StockWise atomically:
- Increases product quantity on hand by the received amount.
- Logs a 'purchase' movement in the Stock Movement Ledger with the PO number.
- Updates received_qty on each purchase item.
- Automatically transitions the PO status to Partially Received or Received and updates the supplier's open balance summary.`,
  },
  {
    sourceKey: 'sample-doc-6-supplier-customer-guide',
    title: 'Supplier and Customer Guide',
    description:
      'Sample Documentation: Vendor onboarding, supplier metrics, customer CRM records, and archiving.',
    documentType: 'guide',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# Supplier and Customer Guide

## Supplier Registration and Management
Under the Suppliers module, register vendors with Company Name, Primary Contact Name, Email, Phone, Street Address, City, State, Country, On-Time Delivery Rate (%), and operational notes. Active suppliers appear in Product and Purchase Order selectors.

## Supplier History and Financial Tracking
Opening a supplier profile displays linked SKUs, historical Purchase Orders, total lifetime procurement spend, on-time rate, and outstanding balance on open orders. Rather than deleting suppliers linked to historical POs, use Archive to retire a vendor while keeping audit history intact, or Restore to reactivate them later.

## Customer Registration and Management
Under the Customers module, store Full Name, Company, Email, Phone, Address, City, and account notes. Customers can be selected during Sales invoice creation so repeat buyers build unified order histories.

## Customer Purchase History and Contact Filtering
Inspecting any customer profile shows total order count, lifetime revenue, last order date, and itemized invoice links. Both Suppliers and Customers support instant search by name, company, email, phone, or city, plus Active / Archived / All status filters.`,
  },
  {
    sourceKey: 'sample-doc-7-business-rules-security',
    title: 'Business Rules and Security',
    description:
      'Sample Documentation: Role-based access control, stock/sales/purchase validation rules, and multi-business isolation.',
    documentType: 'policy',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# Business Rules and Security

## User Roles and Permissions
StockWise enforces Role-Based Access Control (RBAC) across two account roles:
- Admin: Full access to all 14 operational modules plus User Management, Audit Trail, AI Knowledge Base administration, and multi-business creation.
- Staff: Scoped operational access governed by six explicit permissions configurable by an Admin:
  1. canEditProducts (Add & edit products and categories)
  2. canAdjustInventory (Record manual stock adjustments)
  3. canCreateSales (Issue invoices and record payments)
  4. canManagePurchases (Create and receive purchase orders)
  5. canManageContacts (Manage suppliers and customers)
  6. canExportReports (Export CSV reports)

## Stock, Sales, and Purchase Validation Rules
- No Negative Stock: Stock-out, damaged, transfer, negative adjustments, and sales transactions fail cleanly if they would reduce physical stock below 0 or below reserved_qty.
- Category Integrity: Deleting a category with assigned products returns HTTP 409 and requires reassigning products to another category first.
- Idempotent PO Receiving: Receiving goods validates that received quantities never exceed remaining ordered quantities per line item.
- Atomic Transactions: Multi-line sales and purchase receipts execute inside database transactions so partial failures never corrupt stock balances.

## Data Privacy and Multi-Business Isolation
- Every record (products, categories, suppliers, customers, sales, purchases, stock movements, notifications, calendar events, AI documents, document chunks, and AI conversations) is scoped by business_id.
- Server-side queries strictly enforce authenticated user identity and active business scope on every request.
- AI chatbot conversations are private to the authenticated user within the active business; users cannot read or delete another user's AI conversations.
- All administrative mutations (user creation, permission edits, password resets, knowledge base uploads/deletions) are recorded in the Workspace Audit Trail.`,
  },
  {
    sourceKey: 'sample-doc-8-faq',
    title: 'StockWise Frequently Asked Questions (FAQ)',
    description:
      'Sample Documentation: 32 common operational questions and step-by-step answers for StockWise.',
    documentType: 'faq',
    content: `[SAMPLE DOCUMENTATION — NOT LIVE CUSTOMER RECORDS]

# StockWise Frequently Asked Questions

1. Q: How do I add a product?
   A: Open Products from the sidebar (or Quick Create > Add New Product), click Add Product, enter the Name, unique SKU, prices, minimum stock level, category, and supplier, then click Save Product.

2. Q: How do I duplicate an existing product to create a variant?
   A: In the Products table, click the Duplicate icon on a product row. StockWise creates a copy with a unique SKU suffix and zeroed/copied baseline metadata ready to edit.

3. Q: How do I update stock quantities?
   A: Open Inventory and choose Stock In, Stock Out, Adjust (+/-), Return (+), Damaged (-), or Transfer (-), select the product, enter the quantity and reason, and click Apply Stock Transaction.

4. Q: Why did a stock deduction fail with an insufficient stock error?
   A: StockWise blocks any deduction that would push quantity on hand below zero or below reserved_qty. Check current stock and active reservations on the Inventory page.

5. Q: How do I identify low-stock and out-of-stock products?
   A: Check the Low-Stock Products and Out-of-Stock Products KPI cards on the Dashboard, open the Low & Empty Alerts tab inside Inventory, or run the Low-Stock / Out-of-Stock reports under Reports.

6. Q: How is inventory value calculated?
   A: Cost Valuation sums (quantity * purchase_price) for all active SKUs; Retail Valuation sums (quantity * selling_price). Archived SKUs are excluded from active valuation.

7. Q: How do I create a sale and generate an invoice?
   A: Go to Sales > New Sale (or Quick Create > New Sale Invoice), select a customer, add products and quantities, optionally set discount and tax rate, choose payment method and amount paid, and submit. Click View/Print on the invoice row to print or save as PDF.

8. Q: How do I record a partial payment on a customer invoice?
   A: When creating a sale, enter less than the total in Amount Paid (marking it Partial) or 0 (Pending). Later, click Record Payment on that invoice row in Sales to apply subsequent installments until Paid.

9. Q: What happens to inventory when a sale is cancelled or refunded?
   A: Cancelling or refunding an invoice automatically restores all sold quantities back into product stock and records 'return' movements in the ledger.

10. Q: How do I create a purchase order?
    A: Open Purchases > Create Purchase Order, select the supplier, set an expected date and initial status (Draft, Pending, or Ordered), add SKUs with unit costs, and submit.

11. Q: How do I receive a purchase order partially or in full?
    A: Click Receive Goods on any Pending, Ordered, or Partially Received PO, enter the units received per line item, and submit. StockWise updates stock immediately and sets status to Partially Received or Received.

12. Q: Can I edit or delete a category that has products assigned?
    A: You can edit a category's name, color, and description anytime. If you delete a category with assigned products, StockWise opens the Reassign & Delete dialog so you can move those SKUs to another category safely first.

13. Q: How do I export reports to CSV or PDF?
    A: Open the Reports module, choose any of the 10 report types, apply category or search filters, and click Export CSV for spreadsheet data or Print / PDF for formatted document output.

14. Q: What reports are available in StockWise?
    A: Inventory Summary, Low-Stock Report, Out-of-Stock Report, Inventory Valuation, Sales Report, Purchases Report, Profitability & COGS, Stock Movements, Supplier Performance, and Customer Activity.

15. Q: How do I manage suppliers and track vendor performance?
    A: Open Suppliers to add vendors, edit contact/location details, view linked products and purchase orders, inspect on-time delivery % and outstanding balances, or archive inactive vendors.

16. Q: How do I view a customer's purchase history?
    A: Open Customers and click View (eye icon) on any customer row to inspect total orders, total revenue, last order date, and past invoices.

17. Q: How do I search quickly across the entire platform?
    A: Press Command+K (Mac) or Ctrl+K (Windows/Linux), or click the Search bar in the top header, to jump straight to products, SKUs, categories, suppliers, customers, invoices, or purchase orders.

18. Q: How do I switch between Light and Dark themes?
    A: Click the sun/moon icon in the top header, or choose Warm Off-White Light / Deep Charcoal Dark in Settings > Theme Preference.

19. Q: How do I manage multiple businesses or warehouses?
    A: Admins can click Settings > Business Workspaces > New Business to create an isolated workspace with its own currency, catalog, orders, and AI knowledge base, and switch anytime using the workspace selector in the header.

20. Q: How do I add a Staff user and limit their permissions?
    A: Admins open User Management > Add Team Member, choose Staff (Scoped), and toggle the six operational permission checkboxes (products, inventory, sales, purchases, contacts, reports).

21. Q: How do I reset a team member's password?
    A: An Administrator can click the Reset Password key icon beside any user in User Management to issue a new temporary password immediately.

22. Q: Where can I audit sensitive workspace actions?
    A: Admins can inspect the Workspace Audit Trail table at the bottom of User Management, filterable by actor, action code, or summary.

23. Q: How do I schedule cycle counts or delivery reminders?
    A: Open Calendar, click Add Event (or click + on a date cell), choose Reminder, Delivery, Purchase, Sale, or Stock Audit, and toggle between Month, Week, and Day views.

24. Q: Why did a low-stock alert disappear automatically?
    A: When stock is replenished above min_stock via Receive Goods or Stock In, StockWise automatically marks the active low-stock or out-of-stock alert as resolved.

25. Q: What file formats can I upload to the AI Knowledge Base?
    A: Administrators can upload .txt, .md, .pdf, and .docx documents up to 5 MB each, or author text/markdown documents directly in the AI Knowledge Base page.

26. Q: How does StockWise AI know both documentation and my current stock levels?
    A: StockWise AI combines vector RAG search over your business's processed knowledge base documents with authenticated, business-scoped live queries against your real products, sales, and purchase tables.

27. Q: Can another business see my AI documents or chat conversations?
    A: No. Both RAG chunks and live inventory queries filter strictly by your authenticated business_id, and chat conversations are private to your user account.

28. Q: What should I check at the start of every business day?
    A: Review Out-of-Stock and Low-Stock alerts, check Ordered POs due today or overdue on the Calendar, inspect Pending/Partial sales invoices needing payment collection, and review yesterday's stock movements.

29. Q: Why is a duplicated or archived product not counted in Inventory Valuation?
    A: Archived products are excluded from active Inventory Valuation, low-stock alerts, and sales/purchase selectors so discontinued SKUs never skew operational metrics.

30. Q: How do I change the business currency or default tax rate?
    A: Open Settings > Business Profile, Localization & Alerts, choose your currency (USD, EUR, GBP, INR, CAD, AUD) and default tax percentage, and click Save Business Settings.

31. Q: Can Staff users upload or delete documents in the AI Knowledge Base?
    A: No. Only Administrators can create, upload, edit, reprocess, or delete documents in the AI Knowledge Base, while all authenticated workspace members can ask questions in StockWise AI.

32. Q: How do I reprocess a document if an embedding update or edit happens?
    A: Open AI Knowledge Base and click Reprocess on any document row. StockWise safely replaces previous chunks, generates fresh embeddings, and logs a new ingestion job.`,
  },
];
