import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { db, logAudit, withTransaction } from './server/db.ts';
import {
  ADMIN_PERMISSIONS,
  clearSessionCookie,
  createSession,
  DEFAULT_STAFF_PERMISSIONS,
  extractTokenFromRequest,
  hashPassword,
  hashToken,
  mapUserRow,
  requireAdmin,
  requireAuth,
  requirePermission,
  setSessionCookie,
  verifyPassword,
  type AuthenticatedRequest,
} from './server/auth.ts';
import { seedInitialDataIfEmpty } from './server/seed.ts';
import {
  EMBEDDING_DIMENSIONS,
  GeminiServiceError,
  getConfiguredChatModel,
  getConfiguredEmbeddingModel,
  isGeminiConfigured,
} from './server/ai/gemini.ts';
import {
  extractTextFromDocumentBuffer,
  validateDocumentUpload,
} from './server/ai/chunker.ts';
import {
  createConversation,
  createOrUpdateDocumentRecord,
  deleteConversation,
  deleteDocumentRecord,
  getDocumentById,
  getDocumentChunks,
  ingestDocument,
  isSupabaseConfigured,
  listConversations,
  listDocuments,
  listMessagesForConversation,
  renameConversation,
  seedSampleKnowledgeBase,
  uploadRawFileToStorage,
  type DocumentType,
} from './server/ai/store.ts';
import { checkChatRateLimit, runStockWiseRagChat } from './server/ai/ragPipeline.ts';
import {
  calculateAvailableStock,
  calculatePurchaseTotalsWithTaxDiscount,
  calculateSaleTotals,
  isActiveSale,
  validateSaleItems,
} from './src/utils/calculations.ts';

seedInitialDataIfEmpty();

const app = express();
app.use(express.json({ limit: '8mb' }));

function isValidImageUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url === '') return true;
  if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(url)) {
    return url.length <= 2_500_000;
  }
  return false;
}

function getBusinessSettings(businessId = 1) {
  let row = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    row = db.prepare('SELECT * FROM businesses ORDER BY id ASC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;
  }
  if (!row) {
    return {
      businessId: 1,
      companyName: 'StockWise Operations',
      logoUrl: '',
      email: 'operations@stockwise.io',
      phone: '',
      address: '',
      currency: 'USD' as const,
      taxRate: 8.5,
      theme: 'light' as const,
      dateFormat: 'MMM DD, YYYY' as const,
      language: 'en',
      lowStockAlertsEnabled: true,
    };
  }
  return {
    businessId: Number(row.id),
    companyName: String(row.name || 'StockWise Operations'),
    logoUrl: String(row.logo_url || ''),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    address: String(row.address || ''),
    currency: (['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'].includes(String(row.currency))
      ? String(row.currency)
      : 'USD') as 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD',
    taxRate: Number(row.tax_rate ?? 8.5),
    theme: (row.theme === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
    dateFormat: (['MMM DD, YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'].includes(String(row.date_format))
      ? String(row.date_format)
      : 'MMM DD, YYYY') as 'MMM DD, YYYY' | 'YYYY-MM-DD' | 'DD/MM/YYYY',
    language: String(row.language || 'en'),
    lowStockAlertsEnabled: Number(row.low_stock_alerts_enabled ?? 1) === 1,
  };
}

function getBusinessesList() {
  const rows = db
    .prepare('SELECT id, name, currency FROM businesses ORDER BY id ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    currency: String(r.currency || 'USD'),
  }));
}

function createAlertNotificationIfNeeded(productId: number, businessId: number): void {
  const settings = getBusinessSettings(businessId);
  if (!settings.lowStockAlertsEnabled) return;

  const p = db
    .prepare('SELECT id, name, sku, quantity, min_stock, status FROM products WHERE id = ? AND business_id = ?')
    .get(productId, businessId) as
    | { id: number; name: string; sku: string; quantity: number; min_stock: number; status: string }
    | undefined;
  if (!p || p.status === 'archived') return;

  if (p.quantity > p.min_stock) {
    // Auto-clear unresolved low/out-of-stock alerts once stock recovers
    db.prepare(
      `UPDATE notifications SET is_read = 1
       WHERE business_id = ? AND is_read = 0 AND dedupe_key IN (?, ?)`
    ).run(businessId, `oos-${p.id}`, `low-${p.id}`);
    return;
  }

  const isOos = p.quantity <= 0;
  const dedupeKey = isOos ? `oos-${p.id}` : `low-${p.id}`;
  const existing = db
    .prepare(
      'SELECT id FROM notifications WHERE business_id = ? AND dedupe_key = ? AND is_read = 0 LIMIT 1'
    )
    .get(businessId, dedupeKey) as { id?: number } | undefined;
  if (existing?.id) return;

  if (isOos) {
    db.prepare(
      `INSERT INTO notifications (business_id, type, title, message, related_module, dedupe_key, is_read)
       VALUES (?, 'out_of_stock', ?, ?, 'inventory', ?, 0)`
    ).run(
      businessId,
      `Out of Stock: ${p.name}`,
      `SKU ${p.sku} has reached 0 units on hand (minimum threshold: ${p.min_stock}).`,
      dedupeKey
    );
  } else {
    db.prepare(
      `INSERT INTO notifications (business_id, type, title, message, related_module, dedupe_key, is_read)
       VALUES (?, 'low_stock', ?, ?, 'inventory', ?, 0)`
    ).run(
      businessId,
      `Low Stock Warning: ${p.name}`,
      `SKU ${p.sku} has ${p.quantity} units remaining (minimum threshold: ${p.min_stock}).`,
      dedupeKey
    );
  }
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ==================== AUTH ROUTES ====================
app.get('/api/auth/status', (req, res) => {
  const adminRow = db
    .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1")
    .get() as { c: number };
  const passcodeConfigured = Boolean(
    process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0
  );
  const needsSetup = adminRow.c === 0 && !passcodeConfigured;

  let currentUser = null;
  if (!needsSetup) {
    const { token } = extractTokenFromRequest(req);
    if (token) {
      const tokenHash = hashToken(token);
      const row = db
        .prepare(
          `SELECT u.*, s.expires_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ?`
        )
        .get(tokenHash) as Record<string, unknown> | undefined;
      if (row && Number(row.active) === 1) {
        const exp = new Date(String(row.expires_at)).getTime();
        if (!Number.isNaN(exp) && exp >= Date.now()) {
          currentUser = mapUserRow(row);
        }
      }
    }
  }

  res.json({
    needsSetup,
    adminPasscodeConfigured: passcodeConfigured,
    user: currentUser,
    settings: currentUser ? getBusinessSettings(1) : null,
    businesses: currentUser ? getBusinessesList() : [],
  });
});

app.post('/api/auth/setup', (req, res) => {
  const passcodeConfigured = Boolean(
    process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0
  );
  if (passcodeConfigured) {
    res.status(409).json({
      error: 'Workspace setup is locked because ADMIN_PASSCODE is configured.',
    });
    return;
  }

  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  if (!name || !email || !email.includes('@')) {
    res.status(400).json({ error: 'Please provide a valid full name and email address.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  try {
    const result = withTransaction(() => {
      const adminCount = db
        .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'")
        .get() as { c: number };
      if (adminCount.c > 0) {
        return { locked: true as const };
      }

      const passwordHash = hashPassword(password);
      const inserted = db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, permissions, active)
           VALUES (?, ?, ?, 'admin', ?, 1)`
        )
        .run(name, email, passwordHash, JSON.stringify(ADMIN_PERMISSIONS));

      const userRow = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(Number(inserted.lastInsertRowid)) as Record<string, unknown>;
      const user = mapUserRow(userRow);
      const session = createSession(user.id);
      logAudit({
        businessId: 1,
        userId: user.id,
        userName: user.name,
        action: 'ADMIN_CLAIM',
        entityType: 'user',
        entityId: user.id,
        summary: `Claimed primary administrator workspace (${user.email})`,
      });
      return { locked: false as const, user, token: session.token };
    });

    if (result.locked) {
      res
        .status(409)
        .json({ error: 'Workspace administrator has already been claimed. Please sign in.' });
      return;
    }

    setSessionCookie(res, result.token);
    res.status(201).json({
      token: result.token,
      user: result.user,
      settings: getBusinessSettings(1),
      businesses: getBusinessesList(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to initialize admin workspace.';
    res
      .status(400)
      .json({ error: msg.includes('UNIQUE') ? 'An account with this email already exists.' : msg });
  }
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const envPasscode = (process.env.ADMIN_PASSCODE || '').trim();
  let userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | Record<string, unknown>
    | undefined;

  if (!userRow && envPasscode && password === envPasscode) {
    const passwordHash = hashPassword(password);
    const inserted = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, permissions, active)
         VALUES (?, ?, ?, 'admin', ?, 1)`
      )
      .run('Workspace Admin', email, passwordHash, JSON.stringify(ADMIN_PERMISSIONS));
    userRow = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(Number(inserted.lastInsertRowid)) as Record<string, unknown>;
  }

  if (!userRow) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (Number(userRow.active) !== 1) {
    res.status(403).json({ error: 'This user account is deactivated.' });
    return;
  }

  const isAdminEnvOverride =
    envPasscode.length > 0 && String(userRow.role) === 'admin' && password === envPasscode;
  const passwordOk =
    isAdminEnvOverride || verifyPassword(password, String(userRow.password_hash));

  if (!passwordOk) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const user = mapUserRow(userRow);
  const session = createSession(user.id);
  setSessionCookie(res, session.token);

  res.json({
    token: session.token,
    user,
    settings: getBusinessSettings(1),
    businesses: getBusinessesList(),
  });
});

app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.sessionTokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    user: req.authUser,
    settings: getBusinessSettings(req.businessId!),
    businesses: getBusinessesList(),
  });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');

  if (newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters.' });
    return;
  }

  const userRow = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(req.authUser!.id) as Record<string, unknown>;
  if (!verifyPassword(currentPassword, String(userRow.password_hash))) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
    hashPassword(newPassword),
    req.authUser!.id
  );
  logAudit({
    businessId: req.businessId!,
    userId: req.authUser!.id,
    userName: req.authUser!.name,
    action: 'PASSWORD_CHANGE',
    entityType: 'user',
    entityId: req.authUser!.id,
    summary: `Updated own account password`,
  });
  res.json({ ok: true });
});

// ==================== BUSINESSES ====================
app.get('/api/businesses', requireAuth, (_req, res) => {
  res.json(getBusinessesList());
});

app.post('/api/businesses', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const name = String(req.body?.name ?? '').trim();
  const currency = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'].includes(req.body?.currency)
    ? String(req.body.currency)
    : 'USD';
  const email = String(req.body?.email ?? '').trim();
  const phone = String(req.body?.phone ?? '').trim();
  const address = String(req.body?.address ?? '').trim();
  const taxRate = Math.max(0, Math.min(50, Number(req.body?.taxRate ?? 8.5)));

  if (!name) {
    res.status(400).json({ error: 'Business name is required.' });
    return;
  }

  const newId = withTransaction(() => {
    const inserted = db
      .prepare(
        `INSERT INTO businesses (name, email, phone, address, currency, tax_rate, theme, date_format, language, low_stock_alerts_enabled)
         VALUES (?, ?, ?, ?, ?, ?, 'light', 'MMM DD, YYYY', 'en', 1)`
      )
      .run(name, email, phone, address, currency, taxRate);
    const bid = Number(inserted.lastInsertRowid);
    db.prepare(
      'INSERT INTO categories (business_id, name, description, color) VALUES (?, ?, ?, ?)'
    ).run(bid, 'General Inventory', 'Default category for this business unit', '#C5F36B');
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'CREATE_BUSINESS',
      entityType: 'business',
      entityId: bid,
      summary: `Created business workspace "${name}" (${currency})`,
    });
    return bid;
  });

  res.status(201).json({
    business: { id: newId, name, currency },
    businesses: getBusinessesList(),
    settings: getBusinessSettings(newId),
  });
});

// ==================== PRODUCTS ====================
app.get('/api/products', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name, s.company_name AS supplier_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.business_id = ?
       ORDER BY p.id DESC`
    )
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      sku: String(r.sku),
      barcode: String(r.barcode ?? ''),
      categoryId: r.category_id === null ? null : Number(r.category_id),
      categoryName: r.category_name ? String(r.category_name) : 'Uncategorized',
      supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
      supplierName: r.supplier_name ? String(r.supplier_name) : 'Unassigned',
      purchasePrice: Number(r.purchase_price),
      sellingPrice: Number(r.selling_price),
      quantity: Number(r.quantity),
      reservedQty: Number(r.reserved_qty ?? 0),
      minStock: Number(r.min_stock),
      maxStock: Number(r.max_stock ?? 100),
      unit: String(r.unit ?? 'pcs'),
      status: r.status === 'archived' ? 'archived' : 'active',
      description: String(r.description ?? ''),
      imageUrl: String(r.image_url ?? ''),
      updatedAt: String(r.updated_at),
      createdAt: String(r.created_at),
    }))
  );
});

app.post(
  '/api/products',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const name = String(req.body?.name ?? '').trim();
    const sku = String(req.body?.sku ?? '').trim().toUpperCase();
    const barcode = String(req.body?.barcode ?? '').trim();
    const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
    const supplierId = req.body?.supplierId ? Number(req.body.supplierId) : null;
    const purchasePrice = Number(req.body?.purchasePrice ?? 0);
    const sellingPrice = Number(req.body?.sellingPrice ?? 0);
    const quantity = Math.trunc(Number(req.body?.quantity ?? 0));
    const minStock = Math.max(0, Math.trunc(Number(req.body?.minStock ?? 5)));
    const maxStock = Math.max(minStock, Math.trunc(Number(req.body?.maxStock ?? 100)));
    const unit = String(req.body?.unit ?? 'pcs').trim() || 'pcs';
    const description = String(req.body?.description ?? '').trim();
    const imageUrl = String(req.body?.imageUrl ?? '');

    if (!name || !sku) {
      res.status(400).json({ error: 'Product name and SKU are required.' });
      return;
    }
    if (
      !Number.isFinite(purchasePrice) ||
      purchasePrice < 0 ||
      !Number.isFinite(sellingPrice) ||
      sellingPrice < 0
    ) {
      res.status(400).json({ error: 'Prices must be zero or positive numbers.' });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      res.status(400).json({ error: 'Quantity must be a non-negative integer.' });
      return;
    }
    if (!isValidImageUrl(imageUrl)) {
      res.status(400).json({ error: 'Invalid product image format or size (max ~1.8MB).' });
      return;
    }

    try {
      const productId = withTransaction(() => {
        const now = new Date().toISOString();
        const inserted = db
          .prepare(
            `INSERT INTO products (business_id, name, sku, barcode, category_id, supplier_id, purchase_price, selling_price, quantity, reserved_qty, min_stock, max_stock, unit, status, description, image_url, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'active', ?, ?, ?, ?)`
          )
          .run(
            bid,
            name,
            sku,
            barcode,
            categoryId,
            supplierId,
            purchasePrice,
            sellingPrice,
            quantity,
            minStock,
            maxStock,
            unit,
            description,
            imageUrl,
            now,
            now
          );

        const id = Number(inserted.lastInsertRowid);
        if (quantity > 0) {
          db.prepare(
            `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
             VALUES (?, ?, 'stock_in', ?, 0, ?, 'Initial product stock', ?, ?, ?)`
          ).run(bid, id, quantity, quantity, `INIT-${sku}`, req.authUser!.id, now);
        }
        createAlertNotificationIfNeeded(id, bid);
        logAudit({
          businessId: bid,
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'CREATE_PRODUCT',
          entityType: 'product',
          entityId: id,
          summary: `Created SKU ${sku} · ${name} (${quantity} ${unit})`,
        });
        return id;
      });

      res.status(201).json({ id: productId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create product.';
      res.status(400).json({ error: msg.includes('UNIQUE') ? `SKU "${sku}" already exists.` : msg });
    }
  }
);

app.put(
  '/api/products/:id',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT * FROM products WHERE id = ? AND business_id = ?')
      .get(id, bid) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const name = String(req.body?.name ?? '').trim();
    const sku = String(req.body?.sku ?? '').trim().toUpperCase();
    const barcode = String(req.body?.barcode ?? '').trim();
    const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
    const supplierId = req.body?.supplierId ? Number(req.body.supplierId) : null;
    const purchasePrice = Number(req.body?.purchasePrice ?? 0);
    const sellingPrice = Number(req.body?.sellingPrice ?? 0);
    const quantity = Math.trunc(Number(req.body?.quantity ?? existing.quantity));
    const minStock = Math.max(0, Math.trunc(Number(req.body?.minStock ?? existing.min_stock ?? 5)));
    const maxStock = Math.max(
      minStock,
      Math.trunc(Number(req.body?.maxStock ?? existing.max_stock ?? 100))
    );
    const unit = String(req.body?.unit ?? existing.unit ?? 'pcs').trim() || 'pcs';
    const status = req.body?.status === 'archived' ? 'archived' : 'active';
    const description = String(req.body?.description ?? '').trim();
    const imageUrl =
      req.body?.imageUrl !== undefined ? String(req.body.imageUrl) : String(existing.image_url ?? '');

    if (!name || !sku) {
      res.status(400).json({ error: 'Product name and SKU are required.' });
      return;
    }
    if (
      !Number.isFinite(purchasePrice) ||
      purchasePrice < 0 ||
      !Number.isFinite(sellingPrice) ||
      sellingPrice < 0
    ) {
      res.status(400).json({ error: 'Prices must be zero or positive numbers.' });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      res.status(400).json({ error: 'Quantity cannot be negative.' });
      return;
    }
    if (!isValidImageUrl(imageUrl)) {
      res.status(400).json({ error: 'Invalid product image format or size.' });
      return;
    }

    try {
      withTransaction(() => {
        const now = new Date().toISOString();
        const prevQty = Number(existing.quantity);
        db.prepare(
          `UPDATE products
           SET name = ?, sku = ?, barcode = ?, category_id = ?, supplier_id = ?,
               purchase_price = ?, selling_price = ?, quantity = ?, min_stock = ?, max_stock = ?,
               unit = ?, status = ?, description = ?, image_url = ?, updated_at = ?
           WHERE id = ? AND business_id = ?`
        ).run(
          name,
          sku,
          barcode,
          categoryId,
          supplierId,
          purchasePrice,
          sellingPrice,
          quantity,
          minStock,
          maxStock,
          unit,
          status,
          description,
          imageUrl,
          now,
          id,
          bid
        );

        if (quantity !== prevQty) {
          db.prepare(
            `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
             VALUES (?, ?, 'adjustment', ?, ?, ?, 'Updated via product editor', ?, ?, ?)`
          ).run(bid, id, quantity - prevQty, prevQty, quantity, `EDIT-${sku}`, req.authUser!.id, now);
          createAlertNotificationIfNeeded(id, bid);
        }
        logAudit({
          businessId: bid,
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'UPDATE_PRODUCT',
          entityType: 'product',
          entityId: id,
          summary: `Updated SKU ${sku} · ${name}`,
        });
      });
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update product.';
      res.status(400).json({ error: msg.includes('UNIQUE') ? `SKU "${sku}" already exists.` : msg });
    }
  }
);

app.post(
  '/api/products/:id/duplicate',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT * FROM products WHERE id = ? AND business_id = ?')
      .get(id, bid) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const now = new Date().toISOString();
    const baseSku = String(existing.sku);
    let candidateSku = `${baseSku}-COPY`;
    let suffix = 2;
    while (
      db
        .prepare('SELECT id FROM products WHERE business_id = ? AND sku = ?')
        .get(bid, candidateSku)
    ) {
      candidateSku = `${baseSku}-COPY-${suffix}`;
      suffix += 1;
    }

    const inserted = db
      .prepare(
        `INSERT INTO products (business_id, name, sku, barcode, category_id, supplier_id, purchase_price, selling_price, quantity, reserved_qty, min_stock, max_stock, unit, status, description, image_url, updated_at, created_at)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, 0, 0, ?, ?, ?, 'active', ?, ?, ?, ?)`
      )
      .run(
        bid,
        `${String(existing.name)} (Copy)`,
        candidateSku,
        existing.category_id === null ? null : Number(existing.category_id),
        existing.supplier_id === null ? null : Number(existing.supplier_id),
        Number(existing.purchase_price),
        Number(existing.selling_price),
        Number(existing.min_stock),
        Number(existing.max_stock ?? 100),
        String(existing.unit ?? 'pcs'),
        String(existing.description ?? ''),
        String(existing.image_url ?? ''),
        now,
        now
      );

    const newId = Number(inserted.lastInsertRowid);
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'DUPLICATE_PRODUCT',
      entityType: 'product',
      entityId: newId,
      summary: `Duplicated ${baseSku} to ${candidateSku}`,
    });
    res.status(201).json({ id: newId, sku: candidateSku });
  }
);

app.patch(
  '/api/products/:id/archive',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, name, sku, status FROM products WHERE id = ? AND business_id = ?')
      .get(id, bid) as { id: number; name: string; sku: string; status: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    const nextStatus = req.body?.status === 'active' || existing.status === 'archived' ? 'active' : 'archived';
    db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?').run(
      nextStatus,
      new Date().toISOString(),
      id,
      bid
    );
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: nextStatus === 'archived' ? 'ARCHIVE_PRODUCT' : 'RESTORE_PRODUCT',
      entityType: 'product',
      entityId: id,
      summary: `${nextStatus === 'archived' ? 'Archived' : 'Restored'} ${existing.sku} · ${existing.name}`,
    });
    res.json({ status: nextStatus });
  }
);

app.delete(
  '/api/products/:id',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, name, sku FROM products WHERE id = ? AND business_id = ?')
      .get(id, bid) as { id: number; name: string; sku: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const usedInSales = db
      .prepare('SELECT COUNT(*) as c FROM sale_items WHERE product_id = ?')
      .get(id) as { c: number };
    const usedInPurchases = db
      .prepare('SELECT COUNT(*) as c FROM purchase_items WHERE product_id = ?')
      .get(id) as { c: number };

    if (usedInSales.c > 0 || usedInPurchases.c > 0) {
      res.status(409).json({
        error:
          'Cannot delete a product with recorded sales or purchase history. Archive this product instead.',
      });
      return;
    }

    db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(id, bid);
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'DELETE_PRODUCT',
      entityType: 'product',
      entityId: id,
      summary: `Deleted SKU ${existing.sku} · ${existing.name}`,
    });
    res.json({ ok: true });
  }
);

// ==================== INVENTORY MOVEMENTS ====================
app.get('/api/inventory/movements', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT m.*, p.name AS product_name, p.sku AS product_sku, u.name AS user_name
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.business_id = ?
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 400`
    )
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      productId: Number(r.product_id),
      productName: String(r.product_name),
      productSku: String(r.product_sku),
      type: String(r.type),
      quantityDelta: Number(r.quantity_delta),
      previousQty: Number(r.previous_qty),
      newQty: Number(r.new_qty),
      reason: String(r.reason ?? ''),
      referenceCode: String(r.reference_code ?? ''),
      userId: r.user_id === null ? null : Number(r.user_id),
      userName: r.user_name ? String(r.user_name) : 'System',
      createdAt: String(r.created_at),
    }))
  );
});

app.post(
  '/api/inventory/adjust',
  requireAuth,
  requirePermission('canAdjustInventory'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const productId = Number(req.body?.productId);
    const type = String(req.body?.type ?? '');
    const rawQuantity = Math.trunc(Number(req.body?.quantity ?? 0));
    const reason = String(req.body?.reason ?? '').trim();

    if (!['stock_in', 'stock_out', 'adjustment', 'return', 'damaged', 'transfer'].includes(type)) {
      res.status(400).json({ error: 'Invalid movement type.' });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: 'Please specify a reason for this stock transaction.' });
      return;
    }
    if (
      !Number.isInteger(rawQuantity) ||
      (type !== 'adjustment' && rawQuantity <= 0) ||
      (type === 'adjustment' && rawQuantity === 0)
    ) {
      res.status(400).json({ error: 'Enter a valid non-zero quantity.' });
      return;
    }

    try {
      const result = withTransaction(() => {
        const p = db
          .prepare('SELECT * FROM products WHERE id = ? AND business_id = ?')
          .get(productId, bid) as Record<string, unknown> | undefined;
        if (!p) {
          return { error: 'Product not found.', status: 404 as const };
        }

        const prevQty = Number(p.quantity);
        const reserved = Number(p.reserved_qty ?? 0);
        const delta =
          type === 'stock_in' || type === 'return'
            ? rawQuantity
            : type === 'stock_out' || type === 'damaged' || type === 'transfer'
            ? -rawQuantity
            : rawQuantity;
        const newQty = prevQty + delta;

        if (newQty < 0) {
          return {
            error: `Insufficient stock for "${p.name}". On hand ${prevQty}, cannot deduct ${Math.abs(delta)}.`,
            status: 400 as const,
          };
        }
        if (delta < 0 && newQty < reserved) {
          return {
            error: `Cannot reduce stock below reserved quantity (${reserved} units reserved for open orders).`,
            status: 400 as const,
          };
        }

        const now = new Date().toISOString();
        const prefixMap: Record<string, string> = {
          stock_in: 'IN',
          stock_out: 'OUT',
          adjustment: 'ADJ',
          return: 'RET',
          damaged: 'DMG',
          transfer: 'TRF',
        };
        const refCode = `${prefixMap[type] ?? 'MOV'}-${Date.now().toString().slice(-6)}`;

        db.prepare('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?').run(
          newQty,
          now,
          productId
        );
        db.prepare(
          `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(bid, productId, type, delta, prevQty, newQty, reason, refCode, req.authUser!.id, now);

        const labelMap: Record<string, string> = {
          stock_in: 'Added',
          stock_out: 'Removed',
          adjustment: 'Adjusted',
          return: 'Returned',
          damaged: 'Damaged Write-Off',
          transfer: 'Transferred Out',
        };

        db.prepare(
          `INSERT INTO notifications (business_id, type, title, message, related_module, is_read, created_at)
           VALUES (?, 'stock_adjustment', ?, ?, 'inventory', 0, ?)`
        ).run(
          bid,
          `Stock ${labelMap[type] ?? 'Updated'}: ${p.name}`,
          `${delta > 0 ? '+' : ''}${delta} units (${prevQty} → ${newQty}) · ${reason}`,
          now
        );

        createAlertNotificationIfNeeded(productId, bid);
        logAudit({
          businessId: bid,
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: `STOCK_${type.toUpperCase()}`,
          entityType: 'product',
          entityId: productId,
          summary: `${p.sku} ${delta > 0 ? '+' : ''}${delta} (${prevQty} → ${newQty}) · ${reason}`,
        });

        return { ok: true as const, newQty };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }

      res.status(201).json(result);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : 'Stock adjustment failed.' });
    }
  }
);

// ==================== CATEGORIES ====================
app.get('/api/categories', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
              COUNT(p.id) AS product_count,
              COALESCE(SUM(p.quantity), 0) AS total_units,
              COALESCE(SUM(p.quantity * p.purchase_price), 0) AS total_value
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.business_id = c.business_id
       WHERE c.business_id = ?
       GROUP BY c.id
       ORDER BY c.name ASC`
    )
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      description: String(r.description ?? ''),
      color: String(r.color ?? '#C5F36B'),
      productCount: Number(r.product_count ?? 0),
      totalUnits: Number(r.total_units ?? 0),
      totalValue: Math.round(Number(r.total_value ?? 0) * 100) / 100,
      createdAt: String(r.created_at),
    }))
  );
});

app.post(
  '/api/categories',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const color = String(req.body?.color ?? '#C5F36B').trim();
    if (!name) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }
    try {
      const inserted = db
        .prepare('INSERT INTO categories (business_id, name, description, color) VALUES (?, ?, ?, ?)')
        .run(bid, name, description, color);
      const id = Number(inserted.lastInsertRowid);
      logAudit({
        businessId: bid,
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'CREATE_CATEGORY',
        entityType: 'category',
        entityId: id,
        summary: `Created category "${name}"`,
      });
      res.status(201).json({ id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create category.';
      res.status(400).json({ error: msg.includes('UNIQUE') ? 'Category already exists.' : msg });
    }
  }
);

app.put(
  '/api/categories/:id',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const color = String(req.body?.color ?? '#C5F36B').trim();
    if (!name) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }
    try {
      db.prepare(
        'UPDATE categories SET name = ?, description = ?, color = ? WHERE id = ? AND business_id = ?'
      ).run(name, description, color, id, bid);
      logAudit({
        businessId: bid,
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'UPDATE_CATEGORY',
        entityType: 'category',
        entityId: id,
        summary: `Updated category "${name}"`,
      });
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update category.';
      res.status(400).json({ error: msg.includes('UNIQUE') ? 'Category name already exists.' : msg });
    }
  }
);

app.delete(
  '/api/categories/:id',
  requireAuth,
  requirePermission('canEditProducts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, name FROM categories WHERE id = ? AND business_id = ?')
      .get(id, bid) as { id: number; name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    const assignedCount = db
      .prepare('SELECT COUNT(*) as c FROM products WHERE category_id = ? AND business_id = ?')
      .get(id, bid) as { c: number };

    const reassignTo = req.query.reassignTo ? String(req.query.reassignTo) : '';

    if (assignedCount.c > 0 && !reassignTo) {
      res.status(409).json({
        error: `Cannot delete "${existing.name}" because ${assignedCount.c} product(s) are assigned to it. Reassign those products first.`,
        productCount: assignedCount.c,
      });
      return;
    }

    withTransaction(() => {
      if (assignedCount.c > 0) {
        if (reassignTo === 'none') {
          db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ? AND business_id = ?').run(
            id,
            bid
          );
        } else {
          const targetId = Number(reassignTo);
          const target = db
            .prepare('SELECT id FROM categories WHERE id = ? AND business_id = ?')
            .get(targetId, bid) as { id?: number } | undefined;
          if (!target?.id || target.id === id) {
            throw new Error('Invalid replacement category.');
          }
          db.prepare('UPDATE products SET category_id = ? WHERE category_id = ? AND business_id = ?').run(
            target.id,
            id,
            bid
          );
        }
      }
      db.prepare('DELETE FROM categories WHERE id = ? AND business_id = ?').run(id, bid);
      logAudit({
        businessId: bid,
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'DELETE_CATEGORY',
        entityType: 'category',
        entityId: id,
        summary: `Deleted category "${existing.name}"`,
      });
    });

    res.json({ ok: true });
  }
);

// ==================== SUPPLIERS ====================
app.get('/api/suppliers', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.business_id = s.business_id) AS product_count,
              (SELECT COUNT(*) FROM purchases po WHERE po.supplier_id = s.id AND po.business_id = s.business_id AND po.status != 'cancelled') AS purchase_count,
              (SELECT COALESCE(SUM(po.total_amount), 0) FROM purchases po WHERE po.supplier_id = s.id AND po.business_id = s.business_id AND po.status != 'cancelled') AS total_spend
       FROM suppliers s
       WHERE s.business_id = ?
       ORDER BY s.company_name ASC`
    )
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      companyName: String(r.company_name),
      contactName: String(r.contact_name ?? ''),
      email: String(r.email ?? ''),
      phone: String(r.phone ?? ''),
      address: String(r.address ?? ''),
      city: String(r.city ?? ''),
      state: String(r.state ?? ''),
      country: String(r.country ?? ''),
      notes: String(r.notes ?? ''),
      status: r.status === 'archived' ? 'archived' : 'active',
      outstandingBalance: Number(r.outstanding_balance ?? 0),
      onTimeRate: Number(r.on_time_rate ?? 96),
      productCount: Number(r.product_count ?? 0),
      purchaseCount: Number(r.purchase_count ?? 0),
      totalSpend: Math.round(Number(r.total_spend ?? 0) * 100) / 100,
      createdAt: String(r.created_at),
    }))
  );
});

app.post(
  '/api/suppliers',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const companyName = String(req.body?.companyName ?? '').trim();
    const contactName = String(req.body?.contactName ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const address = String(req.body?.address ?? '').trim();
    const city = String(req.body?.city ?? '').trim();
    const state = String(req.body?.state ?? '').trim();
    const country = String(req.body?.country ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();
    const outstandingBalance = Math.max(0, Number(req.body?.outstandingBalance ?? 0));

    if (!companyName) {
      res.status(400).json({ error: 'Company name is required.' });
      return;
    }

    const inserted = db
      .prepare(
        `INSERT INTO suppliers (business_id, company_name, contact_name, email, phone, address, city, state, country, notes, status, outstanding_balance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(
        bid,
        companyName,
        contactName,
        email,
        phone,
        address,
        city,
        state,
        country,
        notes,
        outstandingBalance
      );

    const id = Number(inserted.lastInsertRowid);
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'CREATE_SUPPLIER',
      entityType: 'supplier',
      entityId: id,
      summary: `Added supplier "${companyName}"`,
    });
    res.status(201).json({ id });
  }
);

app.put(
  '/api/suppliers/:id',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const companyName = String(req.body?.companyName ?? '').trim();
    const contactName = String(req.body?.contactName ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const address = String(req.body?.address ?? '').trim();
    const city = String(req.body?.city ?? '').trim();
    const state = String(req.body?.state ?? '').trim();
    const country = String(req.body?.country ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();
    const status = req.body?.status === 'archived' ? 'archived' : 'active';
    const outstandingBalance = Math.max(0, Number(req.body?.outstandingBalance ?? 0));

    if (!companyName) {
      res.status(400).json({ error: 'Company name is required.' });
      return;
    }

    db.prepare(
      `UPDATE suppliers
       SET company_name = ?, contact_name = ?, email = ?, phone = ?, address = ?, city = ?, state = ?, country = ?, notes = ?, status = ?, outstanding_balance = ?
       WHERE id = ? AND business_id = ?`
    ).run(
      companyName,
      contactName,
      email,
      phone,
      address,
      city,
      state,
      country,
      notes,
      status,
      outstandingBalance,
      id,
      bid
    );

    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'UPDATE_SUPPLIER',
      entityType: 'supplier',
      entityId: id,
      summary: `Updated supplier "${companyName}"`,
    });
    res.json({ ok: true });
  }
);

app.patch(
  '/api/suppliers/:id/archive',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, company_name, status FROM suppliers WHERE id = ? AND business_id = ?')
      .get(id, bid) as { id: number; company_name: string; status: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Supplier not found.' });
      return;
    }
    const nextStatus = existing.status === 'archived' ? 'active' : 'archived';
    db.prepare('UPDATE suppliers SET status = ? WHERE id = ? AND business_id = ?').run(
      nextStatus,
      id,
      bid
    );
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: nextStatus === 'archived' ? 'ARCHIVE_SUPPLIER' : 'RESTORE_SUPPLIER',
      entityType: 'supplier',
      entityId: id,
      summary: `${nextStatus === 'archived' ? 'Archived' : 'Restored'} supplier "${existing.company_name}"`,
    });
    res.json({ status: nextStatus });
  }
);

app.delete(
  '/api/suppliers/:id',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    db.prepare('DELETE FROM suppliers WHERE id = ? AND business_id = ?').run(id, bid);
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'DELETE_SUPPLIER',
      entityType: 'supplier',
      entityId: id,
      summary: `Removed supplier #${id}`,
    });
    res.json({ ok: true });
  }
);

// ==================== CUSTOMERS ====================
app.get('/api/customers', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.business_id = c.business_id AND s.status NOT IN ('refunded', 'cancelled')) AS order_count,
              (SELECT COALESCE(SUM(s.total_amount), 0) FROM sales s WHERE s.customer_id = c.id AND s.business_id = c.business_id AND s.status NOT IN ('refunded', 'cancelled')) AS total_purchases,
              (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id AND s.business_id = c.business_id) AS last_order_date
       FROM customers c
       WHERE c.business_id = ?
       ORDER BY c.name ASC`
    )
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      company: String(r.company ?? ''),
      email: String(r.email ?? ''),
      phone: String(r.phone ?? ''),
      address: String(r.address ?? ''),
      city: String(r.city ?? ''),
      notes: String(r.notes ?? ''),
      status: r.status === 'archived' ? 'archived' : 'active',
      orderCount: Number(r.order_count ?? 0),
      totalPurchases: Math.round(Number(r.total_purchases ?? 0) * 100) / 100,
      lastOrderDate: r.last_order_date ? String(r.last_order_date) : null,
      createdAt: String(r.created_at),
    }))
  );
});

app.post(
  '/api/customers',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const name = String(req.body?.name ?? '').trim();
    const company = String(req.body?.company ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const address = String(req.body?.address ?? '').trim();
    const city = String(req.body?.city ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();

    if (!name) {
      res.status(400).json({ error: 'Customer name is required.' });
      return;
    }

    const inserted = db
      .prepare(
        `INSERT INTO customers (business_id, name, company, email, phone, address, city, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(bid, name, company, email, phone, address, city, notes);

    const id = Number(inserted.lastInsertRowid);
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'CREATE_CUSTOMER',
      entityType: 'customer',
      entityId: id,
      summary: `Added customer "${name}"`,
    });
    res.status(201).json({ id });
  }
);

app.put(
  '/api/customers/:id',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const name = String(req.body?.name ?? '').trim();
    const company = String(req.body?.company ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const address = String(req.body?.address ?? '').trim();
    const city = String(req.body?.city ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();
    const status = req.body?.status === 'archived' ? 'archived' : 'active';

    if (!name) {
      res.status(400).json({ error: 'Customer name is required.' });
      return;
    }

    db.prepare(
      `UPDATE customers
       SET name = ?, company = ?, email = ?, phone = ?, address = ?, city = ?, notes = ?, status = ?
       WHERE id = ? AND business_id = ?`
    ).run(name, company, email, phone, address, city, notes, status, id, bid);

    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'UPDATE_CUSTOMER',
      entityType: 'customer',
      entityId: id,
      summary: `Updated customer "${name}"`,
    });
    res.json({ ok: true });
  }
);

app.patch(
  '/api/customers/:id/archive',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, name, status FROM customers WHERE id = ? AND business_id = ?')
      .get(id, bid) as { id: number; name: string; status: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }
    const nextStatus = existing.status === 'archived' ? 'active' : 'archived';
    db.prepare('UPDATE customers SET status = ? WHERE id = ? AND business_id = ?').run(
      nextStatus,
      id,
      bid
    );
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: nextStatus === 'archived' ? 'ARCHIVE_CUSTOMER' : 'RESTORE_CUSTOMER',
      entityType: 'customer',
      entityId: id,
      summary: `${nextStatus === 'archived' ? 'Archived' : 'Restored'} customer "${existing.name}"`,
    });
    res.json({ status: nextStatus });
  }
);

app.delete(
  '/api/customers/:id',
  requireAuth,
  requirePermission('canManageContacts'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    db.prepare('DELETE FROM customers WHERE id = ? AND business_id = ?').run(id, bid);
    logAudit({
      businessId: bid,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'DELETE_CUSTOMER',
      entityType: 'customer',
      entityId: id,
      summary: `Removed customer #${id}`,
    });
    res.json({ ok: true });
  }
);

// ==================== SALES ====================
app.get('/api/sales', requireAuth, (req: AuthenticatedRequest, res) => {
  const bid = req.businessId!;
  const salesRows = db
    .prepare(
      `SELECT s.*, c.email AS customer_email, u.name AS created_by_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.business_id = ?
       ORDER BY s.created_at DESC, s.id DESC`
    )
    .all(bid) as Array<Record<string, unknown>>;

  const itemRows = db
    .prepare(
      `SELECT si.*
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.business_id = ?
       ORDER BY si.id ASC`
    )
    .all(bid) as Array<Record<string, unknown>>;

  const itemsBySale = new Map<number, Array<Record<string, unknown>>>();
  for (const item of itemRows) {
    const sid = Number(item.sale_id);
    if (!itemsBySale.has(sid)) itemsBySale.set(sid, []);
    itemsBySale.get(sid)!.push({
      id: Number(item.id),
      saleId: sid,
      productId: Number(item.product_id),
      productName: String(item.product_name),
      sku: String(item.sku),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      unitCost: Number(item.unit_cost),
      lineTotal: Number(item.line_total),
    });
  }

  res.json(
    salesRows.map((r) => ({
      id: Number(r.id),
      invoiceNumber: String(r.invoice_number),
      customerId: r.customer_id === null ? null : Number(r.customer_id),
      customerName: String(r.customer_name),
      customerEmail: r.customer_email ? String(r.customer_email) : '',
      subtotal: Number(r.subtotal),
      discountType: r.discount_type === 'fixed' ? 'fixed' : 'percent',
      discountValue: Number(r.discount_value),
      discountAmount: Number(r.discount_amount),
      taxRate: Number(r.tax_rate),
      taxAmount: Number(r.tax_amount),
      totalAmount: Number(r.total_amount),
      amountPaid: Number(r.amount_paid ?? (r.status === 'paid' ? r.total_amount : 0)),
      paymentMethod: String(r.payment_method),
      status: String(r.status),
      notes: String(r.notes ?? ''),
      createdByName: r.created_by_name ? String(r.created_by_name) : 'Operations',
      items: itemsBySale.get(Number(r.id)) ?? [],
      createdAt: String(r.created_at),
    }))
  );
});

app.post(
  '/api/sales',
  requireAuth,
  requirePermission('canCreateSales'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const customerId = req.body?.customerId ? Number(req.body.customerId) : null;
    const discountType = req.body?.discountType === 'fixed' ? 'fixed' : 'percent';
    const discountValue = Number(req.body?.discountValue ?? 0);
    const paymentMethod = ['card', 'bank_transfer', 'cash', 'invoice'].includes(
      req.body?.paymentMethod
    )
      ? String(req.body.paymentMethod)
      : 'card';
    const requestedStatus = ['paid', 'pending', 'partial'].includes(req.body?.status)
      ? String(req.body.status)
      : paymentMethod === 'invoice'
      ? 'pending'
      : 'paid';
    const notes = String(req.body?.notes ?? '').trim();
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

    const parsedItems = rawItems.map((it: Record<string, unknown>) => ({
      productId: Number(it.productId),
      quantity: Math.trunc(Number(it.quantity)),
      unitPrice: Number(it.unitPrice),
    }));

    try {
      const result = withTransaction(() => {
        const allProducts = db
          .prepare(
            'SELECT id, name, sku, quantity, reserved_qty, purchase_price FROM products WHERE business_id = ?'
          )
          .all(bid) as Array<{
          id: number;
          name: string;
          sku: string;
          quantity: number;
          reserved_qty: number;
          purchase_price: number;
        }>;
        const productMap: Record<
          number,
          { name: string; sku: string; quantity: number; reservedQty: number; purchasePrice: number }
        > = {};
        for (const p of allProducts) {
          productMap[p.id] = {
            name: p.name,
            sku: p.sku,
            quantity: p.quantity,
            reservedQty: Number(p.reserved_qty ?? 0),
            purchasePrice: p.purchase_price,
          };
        }

        const validation = validateSaleItems(parsedItems, productMap);
        if (!validation.valid) {
          return { error: validation.error!, status: 400 as const };
        }

        let customerName =
          String(req.body?.customerName ?? 'Walk-in Customer').trim() || 'Walk-in Customer';
        if (customerId) {
          const cRow = db
            .prepare('SELECT name FROM customers WHERE id = ? AND business_id = ?')
            .get(customerId, bid) as { name: string } | undefined;
          if (cRow) customerName = cRow.name;
        }

        const settings = getBusinessSettings(bid);
        const taxRate =
          req.body?.taxRate !== undefined ? Math.max(0, Number(req.body.taxRate)) : settings.taxRate;
        const totals = calculateSaleTotals(parsedItems, discountType, discountValue, taxRate);

        let amountPaid =
          req.body?.amountPaid !== undefined
            ? Math.max(0, Math.min(totals.totalAmount, Number(req.body.amountPaid)))
            : requestedStatus === 'paid'
            ? totals.totalAmount
            : 0;
        amountPaid = Math.round(amountPaid * 100) / 100;

        const finalStatus =
          amountPaid >= totals.totalAmount && totals.totalAmount > 0
            ? 'paid'
            : amountPaid > 0
            ? 'partial'
            : requestedStatus;

        const countRow = db
          .prepare('SELECT COALESCE(MAX(id), 0) + 1001 AS nextNum FROM sales')
          .get() as { nextNum: number };
        const invoiceNumber = `INV-${new Date().getFullYear()}-${countRow.nextNum}`;
        const now = new Date().toISOString();

        const inserted = db
          .prepare(
            `INSERT INTO sales (business_id, invoice_number, customer_id, customer_name, subtotal, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total_amount, amount_paid, payment_method, status, notes, user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            bid,
            invoiceNumber,
            customerId,
            customerName,
            totals.subtotal,
            discountType,
            discountValue,
            totals.discountAmount,
            taxRate,
            totals.taxAmount,
            totals.totalAmount,
            amountPaid,
            paymentMethod,
            finalStatus,
            notes,
            req.authUser!.id,
            now
          );

        const saleId = Number(inserted.lastInsertRowid);
        const insertItem = db.prepare(
          `INSERT INTO sale_items (sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const updateStock = db.prepare('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?');
        const insertMove = db.prepare(
          `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
           VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?)`
        );

        for (const item of parsedItems) {
          const prod = productMap[item.productId];
          const prevQty = prod.quantity;
          const newQty = prevQty - item.quantity;
          if (newQty < calculateAvailableStock(0, 0) || newQty < prod.reservedQty) {
            throw new Error(`Insufficient available stock for ${prod.name}.`);
          }
          prod.quantity = newQty;

          const lineTotal = Math.round(item.quantity * item.unitPrice * 100) / 100;
          insertItem.run(
            saleId,
            item.productId,
            prod.name,
            prod.sku,
            item.quantity,
            item.unitPrice,
            prod.purchasePrice,
            lineTotal
          );
          updateStock.run(newQty, now, item.productId);
          insertMove.run(
            bid,
            item.productId,
            -item.quantity,
            prevQty,
            newQty,
            `Sold on ${invoiceNumber}`,
            invoiceNumber,
            req.authUser!.id,
            now
          );
          createAlertNotificationIfNeeded(item.productId, bid);
        }

        db.prepare(
          `INSERT INTO notifications (business_id, type, title, message, related_module, is_read, created_at)
           VALUES (?, 'sale', ?, ?, 'sales', 0, ?)`
        ).run(
          bid,
          `New Sale Invoice: ${invoiceNumber}`,
          `${customerName} · ${parsedItems.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0)} items · Total ${totals.totalAmount.toFixed(2)}`,
          now
        );

        logAudit({
          businessId: bid,
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'CREATE_SALE',
          entityType: 'sale',
          entityId: saleId,
          summary: `Created ${invoiceNumber} for ${customerName} (${totals.totalAmount.toFixed(2)}, ${finalStatus})`,
        });

        return { id: saleId, invoiceNumber };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }

      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to record sale.' });
    }
  }
);

app.patch(
  '/api/sales/:id/payment',
  requireAuth,
  requirePermission('canCreateSales'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const paymentDelta = Number(req.body?.amount ?? 0);
    if (!Number.isFinite(paymentDelta) || paymentDelta <= 0) {
      res.status(400).json({ error: 'Payment amount must be greater than zero.' });
      return;
    }

    const result = withTransaction(() => {
      const sale = db
        .prepare('SELECT * FROM sales WHERE id = ? AND business_id = ?')
        .get(id, bid) as Record<string, unknown> | undefined;
      if (!sale) return { error: 'Sale not found.', status: 404 as const };
      if (!isActiveSale({ status: String(sale.status) as 'paid' | 'pending' | 'partial' | 'refunded' | 'cancelled' })) {
        return { error: 'Cannot record payment on a cancelled or refunded invoice.', status: 400 as const };
      }

      const totalAmount = Number(sale.total_amount);
      const prevPaid = Number(sale.amount_paid ?? 0);
      const nextPaid = Math.min(totalAmount, Math.round((prevPaid + paymentDelta) * 100) / 100);
      const nextStatus = nextPaid >= totalAmount ? 'paid' : 'partial';

      db.prepare('UPDATE sales SET amount_paid = ?, status = ? WHERE id = ? AND business_id = ?').run(
        nextPaid,
        nextStatus,
        id,
        bid
      );

      logAudit({
        businessId: bid,
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: 'RECORD_SALE_PAYMENT',
        entityType: 'sale',
        entityId: id,
        summary: `Recorded payment of ${paymentDelta.toFixed(2)} on ${sale.invoice_number} (${nextStatus})`,
      });
      return { ok: true as const, amountPaid: nextPaid, status: nextStatus };
    });

    if ('error' in result) {
      res.status(typeof result.status === 'number' ? result.status : 400).json({ error: result.error });
      return;
    }
    res.json(result);
  }
);

app.patch(
  '/api/sales/:id/status',
  requireAuth,
  requirePermission('canCreateSales'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const nextStatus = String(req.body?.status ?? '');
    if (!['paid', 'pending', 'partial', 'refunded', 'cancelled'].includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid invoice status.' });
      return;
    }

    const result = withTransaction(() => {
      const sale = db
        .prepare('SELECT * FROM sales WHERE id = ? AND business_id = ?')
        .get(id, bid) as Record<string, unknown> | undefined;
      if (!sale) return { error: 'Sale not found.', status: 404 as const };
      const prevStatus = String(sale.status);
      if (prevStatus === nextStatus) return { ok: true as const };

      const wasActive = prevStatus !== 'refunded' && prevStatus !== 'cancelled';
      const becomesInactive = nextStatus === 'refunded' || nextStatus === 'cancelled';

      if (!wasActive && !becomesInactive) {
        return {
          error: 'Cancelled or refunded invoices cannot be reopened directly.',
          status: 400 as const,
        };
      }

      const now = new Date().toISOString();
      if (wasActive && becomesInactive) {
        const items = db
          .prepare('SELECT * FROM sale_items WHERE sale_id = ?')
          .all(id) as Array<Record<string, unknown>>;
        for (const item of items) {
          const pid = Number(item.product_id);
          const qty = Number(item.quantity);
          const prod = db
            .prepare('SELECT quantity FROM products WHERE id = ? AND business_id = ?')
            .get(pid, bid) as { quantity: number } | undefined;
          if (prod) {
            const newQty = prod.quantity + qty;
            db.prepare('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?').run(
              newQty,
              now,
              pid
            );
            db.prepare(
              `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
               VALUES (?, ?, 'return', ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              bid,
              pid,
              qty,
              prod.quantity,
              newQty,
              `${nextStatus === 'cancelled' ? 'Cancelled' : 'Refunded'} ${sale.invoice_number}`,
              String(sale.invoice_number),
              req.authUser!.id,
              now
            );
            createAlertNotificationIfNeeded(pid, bid);
          }
        }
      }

      const nextAmountPaid =
        nextStatus === 'paid'
          ? Number(sale.total_amount)
          : nextStatus === 'pending' || nextStatus === 'cancelled'
          ? 0
          : Number(sale.amount_paid ?? 0);

      db.prepare('UPDATE sales SET status = ?, amount_paid = ? WHERE id = ? AND business_id = ?').run(
        nextStatus,
        nextAmountPaid,
        id,
        bid
      );

      logAudit({
        businessId: bid,
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: `SALE_${nextStatus.toUpperCase()}`,
        entityType: 'sale',
        entityId: id,
        summary: `Marked ${sale.invoice_number} as ${nextStatus}`,
      });
      return { ok: true as const };
    });

    if ('error' in result) {
      res.status(result.status ?? 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  }
);

// ==================== PURCHASES ====================
app.get('/api/purchases', requireAuth, (req: AuthenticatedRequest, res) => {
  const bid = req.businessId!;
  const poRows = db
    .prepare(
      `SELECT po.*, u.name AS created_by_name
       FROM purchases po
       LEFT JOIN users u ON u.id = po.user_id
       WHERE po.business_id = ?
       ORDER BY po.created_at DESC, po.id DESC`
    )
    .all(bid) as Array<Record<string, unknown>>;

  const itemRows = db
    .prepare(
      `SELECT pi.*
       FROM purchase_items pi
       JOIN purchases po ON po.id = pi.purchase_id
       WHERE po.business_id = ?
       ORDER BY pi.id ASC`
    )
    .all(bid) as Array<Record<string, unknown>>;

  const itemsByPo = new Map<number, Array<Record<string, unknown>>>();
  for (const item of itemRows) {
    const pid = Number(item.purchase_id);
    if (!itemsByPo.has(pid)) itemsByPo.set(pid, []);
    itemsByPo.get(pid)!.push({
      id: Number(item.id),
      purchaseId: pid,
      productId: Number(item.product_id),
      productName: String(item.product_name),
      sku: String(item.sku),
      quantity: Number(item.quantity),
      receivedQty: Number(item.received_qty ?? 0),
      unitCost: Number(item.unit_cost),
      lineTotal: Number(item.line_total),
    });
  }

  res.json(
    poRows.map((r) => ({
      id: Number(r.id),
      poNumber: String(r.po_number),
      supplierId: r.supplier_id === null ? null : Number(r.supplier_id),
      supplierName: String(r.supplier_name),
      status: String(r.status),
      subtotal: Number(r.subtotal ?? r.total_amount),
      discountAmount: Number(r.discount_amount ?? 0),
      taxRate: Number(r.tax_rate ?? 0),
      taxAmount: Number(r.tax_amount ?? 0),
      totalAmount: Number(r.total_amount),
      expectedDate: r.expected_date ? String(r.expected_date) : null,
      receivedAt: r.received_at ? String(r.received_at) : null,
      notes: String(r.notes ?? ''),
      createdByName: r.created_by_name ? String(r.created_by_name) : 'Operations',
      items: itemsByPo.get(Number(r.id)) ?? [],
      createdAt: String(r.created_at),
    }))
  );
});

app.post(
  '/api/purchases',
  requireAuth,
  requirePermission('canManagePurchases'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const supplierId = req.body?.supplierId ? Number(req.body.supplierId) : null;
    const status = ['draft', 'pending', 'ordered', 'received'].includes(req.body?.status)
      ? String(req.body.status)
      : 'ordered';
    const expectedDate = req.body?.expectedDate ? String(req.body.expectedDate) : null;
    const discountAmount = Math.max(0, Number(req.body?.discountAmount ?? 0));
    const taxRate = Math.max(0, Math.min(50, Number(req.body?.taxRate ?? 0)));
    const notes = String(req.body?.notes ?? '').trim();
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!supplierId) {
      res.status(400).json({ error: 'Please select a supplier for this purchase order.' });
      return;
    }
    if (rawItems.length === 0) {
      res.status(400).json({ error: 'Add at least one product line item.' });
      return;
    }

    const parsedItems = rawItems.map((it: Record<string, unknown>) => ({
      productId: Number(it.productId),
      quantity: Math.trunc(Number(it.quantity)),
      unitCost: Number(it.unitCost),
    }));

    for (const item of parsedItems) {
      if (
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unitCost) ||
        item.unitCost < 0
      ) {
        res.status(400).json({
          error: 'All purchase quantities must be positive and unit costs non-negative.',
        });
        return;
      }
    }

    try {
      const result = withTransaction(() => {
        const sup = db
          .prepare('SELECT company_name FROM suppliers WHERE id = ? AND business_id = ?')
          .get(supplierId, bid) as { company_name: string } | undefined;
        if (!sup) return { error: 'Selected supplier not found.', status: 404 as const };

        const totals = calculatePurchaseTotalsWithTaxDiscount(
          parsedItems,
          discountAmount,
          taxRate
        );
        const countRow = db
          .prepare('SELECT COALESCE(MAX(id), 0) + 101 AS nextNum FROM purchases')
          .get() as { nextNum: number };
        const poNumber = `PO-${new Date().getFullYear()}-${String(countRow.nextNum).padStart(4, '0')}`;
        const now = new Date().toISOString();
        const receivedAt = status === 'received' ? now : null;

        const inserted = db
          .prepare(
            `INSERT INTO purchases (business_id, po_number, supplier_id, supplier_name, status, subtotal, discount_amount, tax_rate, tax_amount, total_amount, expected_date, received_at, notes, user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            bid,
            poNumber,
            supplierId,
            sup.company_name,
            status,
            totals.subtotal,
            totals.discountAmount,
            taxRate,
            totals.taxAmount,
            totals.totalAmount,
            expectedDate,
            receivedAt,
            notes,
            req.authUser!.id,
            now
          );

        const purchaseId = Number(inserted.lastInsertRowid);
        const insertItem = db.prepare(
          `INSERT INTO purchase_items (purchase_id, product_id, product_name, sku, quantity, received_qty, unit_cost, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );

        for (const item of parsedItems) {
          const prod = db
            .prepare('SELECT id, name, sku, quantity FROM products WHERE id = ? AND business_id = ?')
            .get(item.productId, bid) as
            | { id: number; name: string; sku: string; quantity: number }
            | undefined;
          if (!prod) throw new Error('One or more selected products no longer exist.');

          const lineTotal = Math.round(item.quantity * item.unitCost * 100) / 100;
          const initialReceived = status === 'received' ? item.quantity : 0;
          insertItem.run(
            purchaseId,
            prod.id,
            prod.name,
            prod.sku,
            item.quantity,
            initialReceived,
            item.unitCost,
            lineTotal
          );

          if (status === 'received') {
            const newQty = prod.quantity + item.quantity;
            db.prepare('UPDATE products SET quantity = ?, purchase_price = ?, updated_at = ? WHERE id = ?').run(
              newQty,
              item.unitCost,
              now,
              prod.id
            );
            db.prepare(
              `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
               VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              bid,
              prod.id,
              item.quantity,
              prod.quantity,
              newQty,
              `Received PO ${poNumber}`,
              poNumber,
              req.authUser!.id,
              now
            );
            createAlertNotificationIfNeeded(prod.id, bid);
          }
        }

        if (status === 'received') {
          db.prepare(
            `INSERT INTO notifications (business_id, type, title, message, related_module, is_read, created_at)
             VALUES (?, 'purchase', ?, ?, 'purchases', 0, ?)`
          ).run(
            bid,
            `Stock Received: ${poNumber}`,
            `${sup.company_name} delivery checked into inventory (${totals.totalAmount.toFixed(2)}).`,
            now
          );
        }

        logAudit({
          businessId: bid,
          userId: req.authUser!.id,
          userName: req.authUser!.name,
          action: 'CREATE_PURCHASE',
          entityType: 'purchase',
          entityId: purchaseId,
          summary: `Created ${poNumber} for ${sup.company_name} (${totals.totalAmount.toFixed(2)}, ${status})`,
        });

        return { id: purchaseId, poNumber };
      });

      if ('error' in result) {
        res.status(result.status ?? 400).json({ error: result.error });
        return;
      }

      res.status(201).json(result);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : 'Failed to create purchase order.' });
    }
  }
);

app.post(
  '/api/purchases/:id/receive',
  requireAuth,
  requirePermission('canManagePurchases'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const requestedItems = Array.isArray(req.body?.items)
      ? (req.body.items as Array<{ purchaseItemId: number; receiveQty: number }>)
      : null;

    const result = withTransaction(() => {
      const po = db
        .prepare('SELECT * FROM purchases WHERE id = ? AND business_id = ?')
        .get(id, bid) as Record<string, unknown> | undefined;
      if (!po) return { error: 'Purchase order not found.', status: 404 as const };

      const prevStatus = String(po.status);
      if (prevStatus === 'received' || prevStatus === 'cancelled') {
        return {
          error: `Purchase order ${po.po_number} is already ${prevStatus}.`,
          status: 400 as const,
        };
      }

      const poItems = db
        .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
        .all(id) as Array<Record<string, unknown>>;
      if (poItems.length === 0) {
        return { error: 'Purchase order has no items.', status: 400 as const };
      }

      const qtyMap = new Map<number, number>();
      if (requestedItems && requestedItems.length > 0) {
        for (const r of requestedItems) {
          const itemId = Number(r.purchaseItemId);
          const q = Math.trunc(Number(r.receiveQty));
          if (q > 0) qtyMap.set(itemId, q);
        }
      } else {
        for (const item of poItems) {
          const rem = Number(item.quantity) - Number(item.received_qty ?? 0);
          if (rem > 0) qtyMap.set(Number(item.id), rem);
        }
      }

      if (qtyMap.size === 0) {
        return { error: 'Enter at least 1 unit to receive.', status: 400 as const };
      }

      const now = new Date().toISOString();
      let totalReceivedThisBatch = 0;

      for (const item of poItems) {
        const itemId = Number(item.id);
        const receiveNow = qtyMap.get(itemId) ?? 0;
        if (receiveNow <= 0) continue;

        const ordered = Number(item.quantity);
        const alreadyReceived = Number(item.received_qty ?? 0);
        const remaining = ordered - alreadyReceived;
        if (receiveNow > remaining) {
          return {
            error: `Cannot receive ${receiveNow} units of ${item.sku}; only ${remaining} remaining.`,
            status: 400 as const,
          };
        }

        const pid = Number(item.product_id);
        const unitCost = Number(item.unit_cost);
        const prod = db
          .prepare('SELECT quantity FROM products WHERE id = ? AND business_id = ?')
          .get(pid, bid) as { quantity: number } | undefined;

        if (prod) {
          const newQty = prod.quantity + receiveNow;
          db.prepare('UPDATE products SET quantity = ?, purchase_price = ?, updated_at = ? WHERE id = ?').run(
            newQty,
            unitCost,
            now,
            pid
          );
          db.prepare(
            `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
             VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            bid,
            pid,
            receiveNow,
            prod.quantity,
            newQty,
            `Received PO ${po.po_number}`,
            String(po.po_number),
            req.authUser!.id,
            now
          );
          createAlertNotificationIfNeeded(pid, bid);
        }

        db.prepare('UPDATE purchase_items SET received_qty = ? WHERE id = ?').run(
          alreadyReceived + receiveNow,
          itemId
        );
        totalReceivedThisBatch += receiveNow;
      }

      const refreshedItems = db
        .prepare('SELECT quantity, received_qty FROM purchase_items WHERE purchase_id = ?')
        .all(id) as Array<{ quantity: number; received_qty: number }>;
      const allDone = refreshedItems.every((i) => Number(i.received_qty) >= Number(i.quantity));
      const nextStatus = allDone ? 'received' : 'partially_received';
      const receivedAt = allDone ? now : po.received_at ? String(po.received_at) : null;

      db.prepare('UPDATE purchases SET status = ?, received_at = ? WHERE id = ? AND business_id = ?').run(
        nextStatus,
        receivedAt,
        id,
        bid
      );

      db.prepare(
        `INSERT INTO notifications (business_id, type, title, message, related_module, is_read, created_at)
         VALUES (?, 'purchase', ?, ?, 'purchases', 0, ?)`
      ).run(
        bid,
        `${allDone ? 'Stock Received' : 'Partial Receipt'}: ${po.po_number}`,
        `Checked in ${totalReceivedThisBatch} unit(s) from ${po.supplier_name}.`,
        now
      );

      logAudit({
        businessId: bid,
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: allDone ? 'RECEIVE_PURCHASE' : 'PARTIAL_RECEIVE_PURCHASE',
        entityType: 'purchase',
        entityId: id,
        summary: `Received ${totalReceivedThisBatch} unit(s) on ${po.po_number} (${nextStatus})`,
      });

      return { ok: true as const, status: nextStatus };
    });

    if ('error' in result) {
      res.status(typeof result.status === 'number' ? result.status : 400).json({ error: result.error });
      return;
    }
    res.json(result);
  }
);

app.patch(
  '/api/purchases/:id/status',
  requireAuth,
  requirePermission('canManagePurchases'),
  (req: AuthenticatedRequest, res) => {
    const bid = req.businessId!;
    const id = Number(req.params.id);
    const nextStatus = String(req.body?.status ?? '');
    if (
      !['draft', 'pending', 'ordered', 'partially_received', 'received', 'cancelled'].includes(
        nextStatus
      )
    ) {
      res.status(400).json({ error: 'Invalid purchase order status.' });
      return;
    }

    const result = withTransaction(() => {
      const po = db
        .prepare('SELECT * FROM purchases WHERE id = ? AND business_id = ?')
        .get(id, bid) as Record<string, unknown> | undefined;
      if (!po) return { error: 'Purchase order not found.', status: 404 as const };

      const prevStatus = String(po.status);
      if (prevStatus === 'received' && nextStatus !== 'received') {
        return {
          error: 'Received purchase orders cannot revert status after stock intake.',
          status: 400 as const,
        };
      }
      if (prevStatus === nextStatus) return { ok: true as const };

      const now = new Date().toISOString();
      let receivedAt = po.received_at ? String(po.received_at) : null;

      if (nextStatus === 'received' && prevStatus !== 'received') {
        receivedAt = now;
        const items = db
          .prepare('SELECT * FROM purchase_items WHERE purchase_id = ?')
          .all(id) as Array<Record<string, unknown>>;
        for (const item of items) {
          const pid = Number(item.product_id);
          const ordered = Number(item.quantity);
          const alreadyReceived = Number(item.received_qty ?? 0);
          const remaining = Math.max(0, ordered - alreadyReceived);
          if (remaining === 0) continue;

          const unitCost = Number(item.unit_cost);
          const prod = db
            .prepare('SELECT quantity FROM products WHERE id = ? AND business_id = ?')
            .get(pid, bid) as { quantity: number } | undefined;
          if (prod) {
            const newQty = prod.quantity + remaining;
            db.prepare('UPDATE products SET quantity = ?, purchase_price = ?, updated_at = ? WHERE id = ?').run(
              newQty,
              unitCost,
              now,
              pid
            );
            db.prepare(
              `INSERT INTO stock_movements (business_id, product_id, type, quantity_delta, previous_qty, new_qty, reason, reference_code, user_id, created_at)
               VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              bid,
              pid,
              remaining,
              prod.quantity,
              newQty,
              `Received PO ${po.po_number}`,
              String(po.po_number),
              req.authUser!.id,
              now
            );
            createAlertNotificationIfNeeded(pid, bid);
          }
          db.prepare('UPDATE purchase_items SET received_qty = ? WHERE id = ?').run(
            ordered,
            Number(item.id)
          );
        }

        db.prepare(
          `INSERT INTO notifications (business_id, type, title, message, related_module, is_read, created_at)
           VALUES (?, 'purchase', ?, ?, 'purchases', 0, ?)`
        ).run(
          bid,
          `Stock Received: ${po.po_number}`,
          `Inventory updated from ${po.supplier_name}.`,
          now
        );
      }

      db.prepare('UPDATE purchases SET status = ?, received_at = ? WHERE id = ? AND business_id = ?').run(
        nextStatus,
        receivedAt,
        id,
        bid
      );

      logAudit({
        businessId: bid,
        userId: req.authUser!.id,
        userName: req.authUser!.name,
        action: `PURCHASE_${nextStatus.toUpperCase()}`,
        entityType: 'purchase',
        entityId: id,
        summary: `Updated ${po.po_number} status to ${nextStatus}`,
      });

      return { ok: true as const };
    });

    if ('error' in result) {
      res.status(result.status ?? 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  }
);

// ==================== CALENDAR ====================
app.get('/api/calendar', requireAuth, (req: AuthenticatedRequest, res) => {
  const manual = db
    .prepare('SELECT * FROM calendar_events WHERE business_id = ? ORDER BY event_date ASC, id DESC')
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    manual.map((r) => ({
      id: Number(r.id),
      title: String(r.title),
      eventDate: String(r.event_date),
      eventType: String(r.event_type),
      notes: String(r.notes ?? ''),
      completed: Number(r.completed) === 1,
      source: 'manual' as const,
      createdAt: String(r.created_at),
    }))
  );
});

app.post('/api/calendar', requireAuth, (req: AuthenticatedRequest, res) => {
  const bid = req.businessId!;
  const title = String(req.body?.title ?? '').trim();
  const eventDate = String(req.body?.eventDate ?? '').trim();
  const eventType = ['reminder', 'delivery', 'purchase', 'sale', 'stock_audit'].includes(
    req.body?.eventType
  )
    ? String(req.body.eventType)
    : 'reminder';
  const notes = String(req.body?.notes ?? '').trim();

  if (!title || !eventDate) {
    res.status(400).json({ error: 'Title and date are required.' });
    return;
  }

  const inserted = db
    .prepare(
      'INSERT INTO calendar_events (business_id, title, event_date, event_type, notes) VALUES (?, ?, ?, ?, ?)'
    )
    .run(bid, title, eventDate, eventType, notes);

  res.status(201).json({ id: Number(inserted.lastInsertRowid) });
});

app.put('/api/calendar/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const bid = req.businessId!;
  const id = Number(req.params.id);
  const existing = db
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND business_id = ?')
    .get(id, bid) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Calendar event not found.' });
    return;
  }

  const title =
    req.body?.title !== undefined ? String(req.body.title).trim() : String(existing.title);
  const eventDate =
    req.body?.eventDate !== undefined
      ? String(req.body.eventDate).trim()
      : String(existing.event_date);
  const eventType =
    req.body?.eventType !== undefined &&
    ['reminder', 'delivery', 'purchase', 'sale', 'stock_audit'].includes(req.body.eventType)
      ? String(req.body.eventType)
      : String(existing.event_type);
  const notes =
    req.body?.notes !== undefined ? String(req.body.notes).trim() : String(existing.notes ?? '');
  const completed =
    req.body?.completed !== undefined ? (req.body.completed ? 1 : 0) : Number(existing.completed);

  if (!title || !eventDate) {
    res.status(400).json({ error: 'Title and date are required.' });
    return;
  }

  db.prepare(
    'UPDATE calendar_events SET title = ?, event_date = ?, event_type = ?, notes = ?, completed = ? WHERE id = ? AND business_id = ?'
  ).run(title, eventDate, eventType, notes, completed, id, bid);

  res.json({ ok: true });
});

app.delete('/api/calendar/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM calendar_events WHERE id = ? AND business_id = ?').run(
    id,
    req.businessId!
  );
  res.json({ ok: true });
});

// ==================== NOTIFICATIONS ====================
app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      'SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC, id DESC LIMIT 150'
    )
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      type: String(r.type),
      title: String(r.title),
      message: String(r.message),
      relatedModule: String(r.related_module),
      isRead: Number(r.is_read) === 1,
      createdAt: String(r.created_at),
    }))
  );
});

app.patch('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const isRead = req.body?.isRead === false ? 0 : 1;
  db.prepare('UPDATE notifications SET is_read = ? WHERE id = ? AND business_id = ?').run(
    isRead,
    id,
    req.businessId!
  );
  res.json({ ok: true });
});

app.post('/api/notifications/mark-all-read', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE business_id = ?').run(req.businessId!);
  res.json({ ok: true });
});

app.delete('/api/notifications/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM notifications WHERE id = ? AND business_id = ?').run(
    id,
    req.businessId!
  );
  res.json({ ok: true });
});

// ==================== SETTINGS, USERS & AUDIT LOGS ====================
app.get('/api/settings', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json(getBusinessSettings(req.businessId!));
});

app.put('/api/settings', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const bid = req.businessId!;
  const companyName = String(req.body?.companyName ?? '').trim() || 'StockWise Operations';
  const logoUrl = String(req.body?.logoUrl ?? '');
  const email = String(req.body?.email ?? '').trim();
  const phone = String(req.body?.phone ?? '').trim();
  const address = String(req.body?.address ?? '').trim();
  const currency = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'].includes(req.body?.currency)
    ? String(req.body.currency)
    : 'USD';
  const taxRate = Math.max(0, Math.min(50, Number(req.body?.taxRate ?? 0)));
  const theme = req.body?.theme === 'dark' ? 'dark' : 'light';
  const dateFormat = ['MMM DD, YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'].includes(req.body?.dateFormat)
    ? String(req.body.dateFormat)
    : 'MMM DD, YYYY';
  const language = String(req.body?.language ?? 'en').trim() || 'en';
  const lowStockAlertsEnabled = req.body?.lowStockAlertsEnabled === false ? 0 : 1;

  if (!isValidImageUrl(logoUrl)) {
    res.status(400).json({ error: 'Invalid logo image format or size.' });
    return;
  }

  db.prepare(
    `UPDATE businesses
     SET name = ?, logo_url = ?, email = ?, phone = ?, address = ?, currency = ?, tax_rate = ?, theme = ?, date_format = ?, language = ?, low_stock_alerts_enabled = ?
     WHERE id = ?`
  ).run(
    companyName,
    logoUrl,
    email,
    phone,
    address,
    currency,
    taxRate,
    theme,
    dateFormat,
    language,
    lowStockAlertsEnabled,
    bid
  );

  logAudit({
    businessId: bid,
    userId: req.authUser!.id,
    userName: req.authUser!.name,
    action: 'UPDATE_SETTINGS',
    entityType: 'business',
    entityId: bid,
    summary: `Updated business settings (${companyName}, ${currency}, tax ${taxRate}%)`,
  });

  res.json(getBusinessSettings(bid));
});

app.patch('/api/settings/theme', requireAuth, (req: AuthenticatedRequest, res) => {
  const theme = req.body?.theme === 'dark' ? 'dark' : 'light';
  db.prepare('UPDATE businesses SET theme = ? WHERE id = ?').run(theme, req.businessId!);
  res.json({ theme });
});

app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM users ORDER BY created_at ASC')
    .all() as Array<Record<string, unknown>>;
  res.json(rows.map(mapUserRow));
});

app.post('/api/users', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const role = req.body?.role === 'admin' ? 'admin' : 'staff';
  const permissions = req.body?.permissions ?? DEFAULT_STAFF_PERMISSIONS;

  if (!name || !email || !email.includes('@')) {
    res.status(400).json({ error: 'Valid name and email are required.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  try {
    const inserted = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, permissions, active)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .run(
        name,
        email,
        hashPassword(password),
        role,
        JSON.stringify(role === 'admin' ? ADMIN_PERMISSIONS : permissions)
      );
    const id = Number(inserted.lastInsertRowid);
    logAudit({
      businessId: req.businessId!,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'CREATE_USER',
      entityType: 'user',
      entityId: id,
      summary: `Created ${role} user ${name} (${email})`,
    });
    res.status(201).json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create user.';
    res.status(400).json({ error: msg.includes('UNIQUE') ? 'User email already exists.' : msg });
  }
});

app.put('/api/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const name = String(req.body?.name ?? existing.name).trim();
  const role =
    req.body?.role !== undefined
      ? req.body.role === 'admin'
        ? 'admin'
        : 'staff'
      : existing.role === 'admin'
      ? 'admin'
      : 'staff';
  const active =
    req.body?.active !== undefined ? (req.body.active ? 1 : 0) : Number(existing.active);
  const permissions =
    role === 'admin'
      ? ADMIN_PERMISSIONS
      : req.body?.permissions ?? JSON.parse(String(existing.permissions || '{}'));
  const newPassword = req.body?.password ? String(req.body.password) : '';

  if (id === req.authUser!.id && active === 0) {
    res.status(400).json({ error: 'You cannot deactivate your own active administrator account.' });
    return;
  }

  if (newPassword && newPassword.length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters.' });
    return;
  }

  if (newPassword) {
    db.prepare(
      'UPDATE users SET name = ?, role = ?, permissions = ?, active = ?, password_hash = ? WHERE id = ?'
    ).run(name, role, JSON.stringify(permissions), active, hashPassword(newPassword), id);
  } else {
    db.prepare(
      'UPDATE users SET name = ?, role = ?, permissions = ?, active = ? WHERE id = ?'
    ).run(name, role, JSON.stringify(permissions), active, id);
  }

  logAudit({
    businessId: req.businessId!,
    userId: req.authUser!.id,
    userName: req.authUser!.name,
    action: newPassword ? 'RESET_USER_PASSWORD' : 'UPDATE_USER',
    entityType: 'user',
    entityId: id,
    summary: `Updated user ${name} (${role}, ${active ? 'active' : 'suspended'})`,
  });

  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (id === req.authUser!.id) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }
  const existing = db.prepare('SELECT name, email FROM users WHERE id = ?').get(id) as
    | { name: string; email: string }
    | undefined;
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (existing) {
    logAudit({
      businessId: req.businessId!,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'DELETE_USER',
      entityType: 'user',
      entityId: id,
      summary: `Deleted user ${existing.name} (${existing.email})`,
    });
  }
  res.json({ ok: true });
});

app.get('/api/audit-logs', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM audit_logs
       WHERE business_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 250`
    )
    .all(req.businessId!) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: Number(r.id),
      userId: r.user_id === null ? null : Number(r.user_id),
      userName: String(r.user_name ?? 'System'),
      action: String(r.action),
      entityType: String(r.entity_type),
      entityId: String(r.entity_id ?? ''),
      summary: String(r.summary),
      createdAt: String(r.created_at),
    }))
  );
});

// ==================== STOCKWISE AI & KNOWLEDGE BASE ROUTES ====================
const VALID_DOC_TYPES = new Set<DocumentType>(['manual', 'guide', 'policy', 'faq', 'upload', 'other']);

function normalizeDocumentType(raw: unknown): DocumentType {
  const s = String(raw ?? 'guide').trim().toLowerCase() as DocumentType;
  return VALID_DOC_TYPES.has(s) ? s : 'guide';
}

app.get('/api/ai/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const bid = req.businessId!;
  const docs = listDocuments(bid);
  const processedDocumentCount = docs.filter((d) => d.status === 'processed').length;
  const failedDocumentCount = docs.filter((d) => d.status === 'failed').length;
  const chunkCountRow = db
    .prepare('SELECT COUNT(*) as c FROM ai_document_chunks WHERE business_id = ?')
    .get(bid) as { c: number };

  res.json({
    geminiConfigured: isGeminiConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
    chatModel: getConfiguredChatModel(),
    embeddingModel: getConfiguredEmbeddingModel(),
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    documentCount: docs.length,
    processedDocumentCount,
    failedDocumentCount,
    chunkCount: Number(chunkCountRow?.c ?? 0),
  });
});

app.get('/api/ai/conversations', requireAuth, (req: AuthenticatedRequest, res) => {
  const items = listConversations(req.authUser!.id, req.businessId!);
  res.json(items);
});

app.post('/api/ai/conversations', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title : 'New Conversation';
    const created = await createConversation(req.authUser!.id, req.businessId!, title);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create conversation.' });
  }
});

app.patch('/api/ai/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id ?? '');
  const title = String(req.body?.title ?? '').trim();
  if (!title) {
    res.status(400).json({ error: 'Conversation title cannot be empty.' });
    return;
  }
  const updated = await renameConversation(id, req.authUser!.id, req.businessId!, title);
  if (!updated) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  res.json(updated);
});

app.delete('/api/ai/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id ?? '');
  const deleted = await deleteConversation(id, req.authUser!.id, req.businessId!);
  if (!deleted) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/ai/conversations/:id/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id ?? '');
  const messages = listMessagesForConversation(id, req.authUser!.id, req.businessId!);
  if (!messages) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  res.json(messages);
});

app.post('/api/ai/chat', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const businessId = req.businessId!;

  const limitCheck = checkChatRateLimit(userId);
  if (!limitCheck.allowed) {
    res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds));
    res.status(429).json({
      code: 'RATE_LIMITED',
      error: `Too many AI requests. Please wait ${limitCheck.retryAfterSeconds} seconds before sending another question.`,
    });
    return;
  }

  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const conversationId =
    typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
      ? req.body.conversationId.trim()
      : undefined;
  const detailMode = req.body?.detailMode === 'detailed' ? 'detailed' : 'concise';

  try {
    const result = await runStockWiseRagChat({
      userId,
      businessId,
      conversationId,
      message,
      detailMode,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof GeminiServiceError) {
      res.status(err.statusCode).json({ code: err.code, error: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : 'StockWise AI failed to process your request.';
    const status = msg.includes('not found or access denied')
      ? 404
      : msg.includes('enter a message') || msg.includes('limit')
      ? 400
      : 500;
    res.status(status).json({ error: msg });
  }
});

// Admin Knowledge Base routes
app.get('/api/ai/documents', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  res.json(listDocuments(req.businessId!, search));
});

app.get('/api/ai/documents/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
  const doc = getDocumentById(req.businessId!, String(req.params.id ?? ''));
  if (!doc) {
    res.status(404).json({ error: 'Knowledge document not found.' });
    return;
  }
  const chunks = getDocumentChunks(req.businessId!, doc.id);
  res.json({ document: doc, chunks });
});

app.post('/api/ai/documents', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const title = String(req.body?.title ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  const documentType = normalizeDocumentType(req.body?.documentType);
  const rawContent = String(req.body?.rawContent ?? '').trim();

  if (!title || !rawContent) {
    res.status(400).json({ error: 'Document title and content are required.' });
    return;
  }

  try {
    const doc = await createOrUpdateDocumentRecord({
      businessId: req.businessId!,
      title,
      description,
      documentType,
      source: 'admin_editor',
      rawContent,
    });
    const ingestion = isGeminiConfigured()
      ? await ingestDocument(req.businessId!, doc.id)
      : { status: 'pending' as const, chunkCount: 0 };

    logAudit({
      businessId: req.businessId!,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'CREATE_AI_DOCUMENT',
      entityType: 'ai_document',
      entityId: doc.id,
      summary: `Created knowledge document "${title}" (${ingestion.status})`,
    });

    res.status(201).json({
      document: getDocumentById(req.businessId!, doc.id),
      ingestion,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create document.' });
  }
});

app.post('/api/ai/documents/upload', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const filename = String(req.body?.filename ?? '').trim();
  const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : '';
  const base64Data = String(req.body?.base64Data ?? '').trim();
  const titleInput = String(req.body?.title ?? '').trim();
  const description = String(req.body?.description ?? '').trim();
  const documentType = normalizeDocumentType(req.body?.documentType ?? 'upload');

  if (!filename || !base64Data) {
    res.status(400).json({ error: 'Filename and file contents are required.' });
    return;
  }

  const pureBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const buffer = Buffer.from(pureBase64, 'base64');
  const validation = validateDocumentUpload({
    filename,
    mimeType,
    sizeBytes: buffer.byteLength,
  });

  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const extracted = await extractTextFromDocumentBuffer(buffer, validation.extension);
    if (!extracted) {
      res.status(400).json({ error: 'No readable text could be extracted from this file.' });
      return;
    }

    const docTitle = titleInput || filename.replace(/\.[^.]+$/, '');
    const provisional = await createOrUpdateDocumentRecord({
      businessId: req.businessId!,
      title: docTitle,
      description: description || `Uploaded file (${filename})`,
      documentType,
      source: filename,
      rawContent: extracted,
      metadata: {
        originalFilename: filename,
        mimeType,
        sizeBytes: buffer.byteLength,
      },
    });

    const storagePath = await uploadRawFileToStorage({
      businessId: req.businessId!,
      documentId: provisional.id,
      filename,
      buffer,
      contentType: mimeType || 'application/octet-stream',
    });

    await createOrUpdateDocumentRecord({
      businessId: req.businessId!,
      id: provisional.id,
      title: docTitle,
      description: description || `Uploaded file (${filename})`,
      documentType,
      source: filename,
      storagePath,
      rawContent: extracted,
      metadata: {
        originalFilename: filename,
        mimeType,
        sizeBytes: buffer.byteLength,
      },
    });

    const ingestion = isGeminiConfigured()
      ? await ingestDocument(req.businessId!, provisional.id)
      : { status: 'pending' as const, chunkCount: 0 };

    logAudit({
      businessId: req.businessId!,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'UPLOAD_AI_DOCUMENT',
      entityType: 'ai_document',
      entityId: provisional.id,
      summary: `Uploaded "${filename}" into Knowledge Base (${ingestion.status})`,
    });

    res.status(201).json({
      document: getDocumentById(req.businessId!, provisional.id),
      ingestion,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Document upload failed.' });
  }
});

app.put('/api/ai/documents/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id ?? '');
  const existing = getDocumentById(req.businessId!, id);
  if (!existing) {
    res.status(404).json({ error: 'Knowledge document not found.' });
    return;
  }

  const title = String(req.body?.title ?? existing.title).trim();
  const description = String(req.body?.description ?? existing.description).trim();
  const documentType =
    req.body?.documentType !== undefined
      ? normalizeDocumentType(req.body.documentType)
      : existing.documentType;
  const rawContent =
    req.body?.rawContent !== undefined ? String(req.body.rawContent).trim() : existing.rawContent ?? '';

  if (!title || !rawContent) {
    res.status(400).json({ error: 'Document title and content cannot be empty.' });
    return;
  }

  try {
    await createOrUpdateDocumentRecord({
      businessId: req.businessId!,
      id,
      title,
      description,
      documentType,
      source: existing.source,
      sourceKey: existing.sourceKey,
      storagePath: existing.storagePath,
      rawContent,
      metadata: existing.metadata,
    });

    const ingestion = isGeminiConfigured()
      ? await ingestDocument(req.businessId!, id)
      : { status: 'pending' as const, chunkCount: 0 };

    logAudit({
      businessId: req.businessId!,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'UPDATE_AI_DOCUMENT',
      entityType: 'ai_document',
      entityId: id,
      summary: `Updated knowledge document "${title}" (${ingestion.status})`,
    });

    res.json({
      document: getDocumentById(req.businessId!, id),
      ingestion,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update document.' });
  }
});

app.post('/api/ai/documents/seed', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await seedSampleKnowledgeBase(req.businessId!, {
      embedImmediately: isGeminiConfigured(),
    });
    logAudit({
      businessId: req.businessId!,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'SEED_AI_KNOWLEDGE',
      entityType: 'ai_document',
      entityId: 'sample_docs',
      summary: `Seeded sample knowledge docs (created ${result.createdCount}, existing ${result.existingCount}, embedded ${result.processedCount})`,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to seed sample docs.' });
  }
});

app.post('/api/ai/documents/:id/reprocess', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id ?? '');
  const existing = getDocumentById(req.businessId!, id);
  if (!existing) {
    res.status(404).json({ error: 'Knowledge document not found.' });
    return;
  }
  if (!isGeminiConfigured()) {
    res.status(503).json({
      code: 'MISSING_KEY',
      error: 'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Secrets to generate embeddings.',
    });
    return;
  }

  try {
    const ingestion = await ingestDocument(req.businessId!, id, { force: true });
    logAudit({
      businessId: req.businessId!,
      userId: req.authUser!.id,
      userName: req.authUser!.name,
      action: 'REPROCESS_AI_DOCUMENT',
      entityType: 'ai_document',
      entityId: id,
      summary: `Reprocessed "${existing.title}" (${ingestion.status}, ${ingestion.chunkCount} chunks)`,
    });
    res.json({
      document: getDocumentById(req.businessId!, id),
      ingestion,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Reprocessing failed.' });
  }
});

app.delete('/api/ai/documents/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id ?? '');
  const existing = getDocumentById(req.businessId!, id);
  if (!existing) {
    res.status(404).json({ error: 'Knowledge document not found.' });
    return;
  }
  await deleteDocumentRecord(req.businessId!, id);
  logAudit({
    businessId: req.businessId!,
    userId: req.authUser!.id,
    userName: req.authUser!.name,
    action: 'DELETE_AI_DOCUMENT',
    entityType: 'ai_document',
    entityId: id,
    summary: `Deleted knowledge document "${existing.title}"`,
  });
  res.json({ ok: true });
});

export { app };

// ==================== VITE / STATIC SERVING ====================
async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const distDir = path.resolve(process.cwd(), 'dist');

  if (process.env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StockWise server listening on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'test') {
  startServer();
}
