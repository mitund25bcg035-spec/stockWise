import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'stockwise.db');
export const db = new DatabaseSync(dbPath);

function tableExists(tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function getColumnNames(tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(tableName: string, columnName: string, columnDef: string): void {
  const cols = getColumnNames(tableName);
  if (!cols.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
  }
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'StockWise Operations',
    logo_url TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT 'operations@stockwise.io',
    phone TEXT NOT NULL DEFAULT '+1 (415) 890-4410',
    address TEXT NOT NULL DEFAULT '740 Market Street, Suite 400, San Francisco, CA 94103',
    currency TEXT NOT NULL DEFAULT 'USD',
    tax_rate REAL NOT NULL DEFAULT 8.5,
    theme TEXT NOT NULL DEFAULT 'light',
    date_format TEXT NOT NULL DEFAULT 'MMM DD, YYYY',
    language TEXT NOT NULL DEFAULT 'en',
    low_stock_alerts_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff')) DEFAULT 'staff',
    permissions TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#C5F36B',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(business_id, name)
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    company_name TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    outstanding_balance REAL NOT NULL DEFAULT 0,
    on_time_rate REAL NOT NULL DEFAULT 96,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode TEXT NOT NULL DEFAULT '',
    category_id INTEGER,
    supplier_id INTEGER,
    purchase_price REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 0,
    reserved_qty INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 5,
    max_stock INTEGER NOT NULL DEFAULT 100,
    unit TEXT NOT NULL DEFAULT 'pcs',
    status TEXT NOT NULL DEFAULT 'active',
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(business_id, sku),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    product_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity_delta INTEGER NOT NULL,
    previous_qty INTEGER NOT NULL,
    new_qty INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    reference_code TEXT NOT NULL DEFAULT '',
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    invoice_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER,
    customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer',
    subtotal REAL NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'card',
    status TEXT NOT NULL DEFAULT 'paid',
    notes TEXT NOT NULL DEFAULT '',
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    unit_cost REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    po_number TEXT NOT NULL UNIQUE,
    supplier_id INTEGER,
    supplier_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ordered',
    subtotal REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    expected_date TEXT,
    received_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    received_qty INTEGER NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL,
    line_total REAL NOT NULL,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'reminder',
    notes TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_module TEXT NOT NULL DEFAULT 'dashboard',
    dedupe_key TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER,
    user_name TEXT NOT NULL DEFAULT 'System',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Safe forward migrations for existing stockwise.db files created before v2 schema
ensureColumn('categories', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('suppliers', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('suppliers', 'city', "TEXT NOT NULL DEFAULT ''");
ensureColumn('suppliers', 'state', "TEXT NOT NULL DEFAULT ''");
ensureColumn('suppliers', 'country', "TEXT NOT NULL DEFAULT ''");
ensureColumn('suppliers', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('suppliers', 'outstanding_balance', 'REAL NOT NULL DEFAULT 0');
ensureColumn('customers', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('customers', 'city', "TEXT NOT NULL DEFAULT ''");
ensureColumn('customers', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('products', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('products', 'reserved_qty', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'max_stock', 'INTEGER NOT NULL DEFAULT 100');
ensureColumn('products', 'unit', "TEXT NOT NULL DEFAULT 'pcs'");
ensureColumn('products', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('stock_movements', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('sales', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('sales', 'amount_paid', 'REAL NOT NULL DEFAULT 0');
ensureColumn('purchases', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('purchases', 'subtotal', 'REAL NOT NULL DEFAULT 0');
ensureColumn('purchases', 'discount_amount', 'REAL NOT NULL DEFAULT 0');
ensureColumn('purchases', 'tax_rate', 'REAL NOT NULL DEFAULT 0');
ensureColumn('purchases', 'tax_amount', 'REAL NOT NULL DEFAULT 0');
ensureColumn('purchase_items', 'received_qty', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('calendar_events', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('notifications', 'business_id', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('notifications', 'dedupe_key', "TEXT NOT NULL DEFAULT ''");

// If old database has legacy strict CHECK constraints on stock_movements/sales/purchases, rebuild safely
function checkNeedsConstraintUpgrade(tableName: string, testToken: string): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName) as { sql?: string } | undefined;
  return Boolean(row?.sql && row.sql.includes('CHECK(') && !row.sql.includes(testToken));
}

if (checkNeedsConstraintUpgrade('stock_movements', 'damaged')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE stock_movements_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL DEFAULT 1,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      previous_qty INTEGER NOT NULL,
      new_qty INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      reference_code TEXT NOT NULL DEFAULT '',
      user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO stock_movements_new (id, business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
    SELECT id, business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at FROM stock_movements;
    DROP TABLE stock_movements;
    ALTER TABLE stock_movements_new RENAME TO stock_movements;
    PRAGMA foreign_keys = ON;
  `);
}

if (checkNeedsConstraintUpgrade('sales', 'partial')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE sales_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL DEFAULT 1,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER,
      customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer',
      subtotal REAL NOT NULL DEFAULT 0,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'card',
      status TEXT NOT NULL DEFAULT 'paid',
      notes TEXT NOT NULL DEFAULT '',
      user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sales_new (id, business_id, invoice_number, customer_id, customer_name, subtotal, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total_amount, amount_paid, payment_method, status, notes, user_id, created_at)
    SELECT id, business_id, invoice_number, customer_id, customer_name, subtotal, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total_amount, CASE WHEN status = 'paid' THEN total_amount ELSE 0 END, payment_method, status, notes, user_id, created_at FROM sales;
    DROP TABLE sales;
    ALTER TABLE sales_new RENAME TO sales;
    PRAGMA foreign_keys = ON;
  `);
}

if (checkNeedsConstraintUpgrade('purchases', 'partially_received')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE purchases_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL DEFAULT 1,
      po_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER,
      supplier_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ordered',
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      expected_date TEXT,
      received_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO purchases_new (id, business_id, po_number, supplier_id, supplier_name, status, subtotal, discount_amount, tax_rate, tax_amount, total_amount, expected_date, received_at, notes, user_id, created_at)
    SELECT id, business_id, po_number, supplier_id, supplier_name, status, total_amount, 0, 0, 0, total_amount, expected_date, received_at, notes, user_id, created_at FROM purchases;
    DROP TABLE purchases;
    ALTER TABLE purchases_new RENAME TO purchases;
    PRAGMA foreign_keys = ON;
  `);
}

// Migrate legacy settings row into businesses id=1 if needed
if (tableExists('settings')) {
  const bCount = db.prepare('SELECT COUNT(*) as c FROM businesses').get() as { c: number };
  if (bCount.c === 0) {
    const oldSet = db.prepare('SELECT * FROM settings WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (oldSet) {
      db.prepare(
        `INSERT INTO businesses (id, name, logo_url, email, phone, address, currency, tax_rate, theme)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        String(oldSet.company_name ?? 'StockWise Operations'),
        String(oldSet.logo_url ?? ''),
        String(oldSet.email ?? 'operations@stockwise.io'),
        String(oldSet.phone ?? '+1 (415) 890-4410'),
        String(oldSet.address ?? ''),
        String(oldSet.currency ?? 'USD'),
        Number(oldSet.tax_rate ?? 8.5),
        String(oldSet.theme ?? 'light')
      );
    }
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id);
  CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id);
  CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers(business_id);
  CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id);
  CREATE INDEX IF NOT EXISTS idx_movements_business ON stock_movements(business_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sales_business ON sales(business_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_purchases_business ON purchases(business_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_business ON audit_logs(business_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(business_id, dedupe_key, is_read);

  CREATE TABLE IF NOT EXISTS ai_documents (
    id TEXT PRIMARY KEY,
    business_id INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    document_type TEXT NOT NULL DEFAULT 'guide',
    source TEXT NOT NULL DEFAULT 'sample_documentation',
    source_key TEXT NOT NULL DEFAULT '',
    storage_path TEXT NOT NULL DEFAULT '',
    raw_content TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    business_id INTEGER NOT NULL DEFAULT 1,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    embedding TEXT NOT NULL DEFAULT '[]',
    embedding_model TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(document_id, chunk_index),
    FOREIGN KEY (document_id) REFERENCES ai_documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    business_id INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ai_ingestion_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    business_id INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT NOT NULL DEFAULT '',
    processed_chunks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (document_id) REFERENCES ai_documents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ai_docs_business ON ai_documents(business_id, status, updated_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_docs_source_key ON ai_documents(business_id, source_key) WHERE source_key <> '';
  CREATE INDEX IF NOT EXISTS idx_ai_chunks_doc ON ai_document_chunks(business_id, document_id);
  CREATE INDEX IF NOT EXISTS idx_ai_conv_user_biz ON ai_conversations(user_id, business_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_jobs_doc ON ai_ingestion_jobs(document_id, created_at);
`);

export function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function logAudit(params: {
  businessId: number;
  userId: number | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | number;
  summary: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (business_id, user_id, user_name, action, entity_type, entity_id, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.businessId,
    params.userId,
    params.userName,
    params.action,
    params.entityType,
    String(params.entityId),
    params.summary
  );
}
