import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import type { StaffPermissions, User, UserRole } from '../src/types.ts';

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  canEditProducts: true,
  canAdjustInventory: true,
  canCreateSales: true,
  canManagePurchases: false,
  canManageContacts: true,
  canExportReports: true,
};

export const ADMIN_PERMISSIONS: StaffPermissions = {
  canEditProducts: true,
  canAdjustInventory: true,
  canCreateSales: true,
  canManagePurchases: true,
  canManageContacts: true,
  canExportReports: true,
};

export interface AuthenticatedRequest extends Request {
  authUser?: User;
  sessionTokenHash?: string;
  businessId?: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  if (!salt || !originalHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(tokenHash, userId, expiresAt);

  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAge = 7 * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `sw_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    'sw_session=; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=0'
  );
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

export function parsePermissions(raw: string | null | undefined, role: UserRole): StaffPermissions {
  if (role === 'admin') return { ...ADMIN_PERMISSIONS };
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      canEditProducts: Boolean(parsed.canEditProducts ?? DEFAULT_STAFF_PERMISSIONS.canEditProducts),
      canAdjustInventory: Boolean(parsed.canAdjustInventory ?? DEFAULT_STAFF_PERMISSIONS.canAdjustInventory),
      canCreateSales: Boolean(parsed.canCreateSales ?? DEFAULT_STAFF_PERMISSIONS.canCreateSales),
      canManagePurchases: Boolean(parsed.canManagePurchases ?? DEFAULT_STAFF_PERMISSIONS.canManagePurchases),
      canManageContacts: Boolean(parsed.canManageContacts ?? DEFAULT_STAFF_PERMISSIONS.canManageContacts),
      canExportReports: Boolean(parsed.canExportReports ?? DEFAULT_STAFF_PERMISSIONS.canExportReports),
    };
  } catch {
    return { ...DEFAULT_STAFF_PERMISSIONS };
  }
}

export function mapUserRow(row: Record<string, unknown>): User {
  const role = (row.role === 'admin' ? 'admin' : 'staff') as UserRole;
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    role,
    permissions: parsePermissions(String(row.permissions ?? '{}'), role),
    active: Number(row.active) === 1,
    createdAt: String(row.created_at),
  };
}

export function extractTokenFromRequest(req: Request): { token: string | null; viaCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return { token: bearer, viaCookie: false };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.sw_session) {
    return { token: cookies.sw_session, viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

export function verifyCsrfForCookieMutation(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (req.headers['x-requested-with'] === 'StockWise') return true;

  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
  if (origin && host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

export function resolveRequestedBusinessId(req: Request): number {
  const raw = req.headers['x-business-id'];
  const parsed = raw ? Number(raw) : 1;
  if (Number.isInteger(parsed) && parsed > 0) {
    const exists = db.prepare('SELECT id FROM businesses WHERE id = ?').get(parsed) as { id?: number } | undefined;
    if (exists?.id) return exists.id;
  }
  const first = db.prepare('SELECT id FROM businesses ORDER BY id ASC LIMIT 1').get() as { id?: number } | undefined;
  return first?.id ?? 1;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const { token, viaCookie } = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  if (viaCookie && !verifyCsrfForCookieMutation(req)) {
    res.status(403).json({ error: 'Forbidden: CSRF verification failed.' });
    return;
  }

  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(401).json({ error: 'Session invalid or expired. Please sign in again.' });
    return;
  }

  const expiresAt = new Date(String(row.expires_at)).getTime();
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  if (Number(row.active) !== 1) {
    res.status(403).json({ error: 'Account has been deactivated by an administrator.' });
    return;
  }

  req.authUser = mapUserRow(row);
  req.sessionTokenHash = tokenHash;
  req.businessId = resolveRequestedBusinessId(req);
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser || req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access required for this action.' });
    return;
  }
  next();
}

export function requirePermission(perm: keyof StaffPermissions) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.authUser.role === 'admin' || req.authUser.permissions[perm]) {
      next();
      return;
    }
    res.status(403).json({ error: 'You do not have permission to perform this action.' });
  };
}
