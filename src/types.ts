export type UserRole = 'admin' | 'staff';

export type NavModuleId =
  | 'dashboard'
  | 'products'
  | 'inventory'
  | 'categories'
  | 'suppliers'
  | 'customers'
  | 'sales'
  | 'purchases'
  | 'analytics'
  | 'reports'
  | 'calendar'
  | 'notifications'
  | 'knowledge_base'
  | 'users'
  | 'settings';

export interface StaffPermissions {
  canEditProducts: boolean;
  canAdjustInventory: boolean;
  canCreateSales: boolean;
  canManagePurchases: boolean;
  canManageContacts: boolean;
  canExportReports: boolean;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  permissions: StaffPermissions;
  active: boolean;
  createdAt: string;
}

export interface BusinessSummary {
  id: number;
  name: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD';
}

export interface BusinessSettings {
  businessId: number;
  companyName: string;
  logoUrl: string;
  email: string;
  phone: string;
  address: string;
  currency: 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD';
  taxRate: number;
  theme: 'light' | 'dark';
  dateFormat: 'MMM DD, YYYY' | 'YYYY-MM-DD' | 'DD/MM/YYYY';
  language: string;
  lowStockAlertsEnabled: boolean;
}

export interface Category {
  id: number;
  name: string;
  description: string;
  color: string;
  productCount?: number;
  totalUnits?: number;
  totalValue?: number;
  createdAt: string;
}

export interface Supplier {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  notes: string;
  status: 'active' | 'archived';
  outstandingBalance: number;
  productCount?: number;
  purchaseCount?: number;
  totalSpend?: number;
  onTimeRate?: number;
  createdAt: string;
}

export interface Customer {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  notes: string;
  status: 'active' | 'archived';
  orderCount?: number;
  totalPurchases?: number;
  lastOrderDate?: string | null;
  createdAt: string;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  categoryId: number | null;
  categoryName?: string;
  supplierId: number | null;
  supplierName?: string;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
  reservedQty: number;
  minStock: number;
  maxStock: number;
  unit: string;
  status: 'active' | 'archived';
  description: string;
  imageUrl: string;
  updatedAt: string;
  createdAt: string;
}

export type StockMovementType =
  | 'stock_in'
  | 'stock_out'
  | 'adjustment'
  | 'sale'
  | 'purchase'
  | 'return'
  | 'damaged'
  | 'transfer';

export interface StockMovement {
  id: number;
  productId: number;
  productName?: string;
  productSku?: string;
  type: StockMovementType;
  quantityDelta: number;
  previousQty: number;
  newQty: number;
  reason: string;
  referenceCode: string;
  userId: number | null;
  userName?: string;
  createdAt: string;
}

export interface SaleItemInput {
  productId: number;
  quantity: number;
  unitPrice: number;
}

export interface SaleItem {
  id: number;
  saleId: number;
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
}

export type SaleStatus = 'paid' | 'pending' | 'partial' | 'refunded' | 'cancelled';

export interface Sale {
  id: number;
  invoiceNumber: string;
  customerId: number | null;
  customerName: string;
  customerEmail?: string;
  subtotal: number;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  paymentMethod: 'card' | 'bank_transfer' | 'cash' | 'invoice';
  status: SaleStatus;
  notes: string;
  createdByName?: string;
  items?: SaleItem[];
  createdAt: string;
}

export type PurchaseStatus =
  | 'draft'
  | 'pending'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseItemInput {
  productId: number;
  quantity: number;
  unitCost: number;
}

export interface PurchaseItem {
  id: number;
  purchaseId: number;
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
  receivedQty: number;
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: number;
  poNumber: string;
  supplierId: number | null;
  supplierName: string;
  status: PurchaseStatus;
  subtotal: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  expectedDate: string | null;
  receivedAt: string | null;
  notes: string;
  createdByName?: string;
  items?: PurchaseItem[];
  createdAt: string;
}

export type CalendarEventType = 'reminder' | 'delivery' | 'purchase' | 'sale' | 'stock_audit';

export interface CalendarEvent {
  id: number;
  title: string;
  eventDate: string;
  eventType: CalendarEventType;
  notes: string;
  completed: boolean;
  source?: 'manual' | 'purchase' | 'sale' | 'stock';
  createdAt: string;
}

export type NotificationType =
  | 'low_stock'
  | 'out_of_stock'
  | 'sale'
  | 'purchase'
  | 'stock_adjustment'
  | 'reminder';

export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  relatedModule: NavModuleId;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  userId: number | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export type DateRangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';

export type AiDocumentType = 'manual' | 'guide' | 'policy' | 'faq' | 'upload' | 'other';
export type AiDocumentStatus = 'pending' | 'processing' | 'processed' | 'failed';

export interface AiStatus {
  geminiConfigured: boolean;
  supabaseConfigured: boolean;
  chatModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  documentCount: number;
  processedDocumentCount: number;
  failedDocumentCount: number;
  chunkCount: number;
}

export interface AiDocument {
  id: string;
  businessId: number;
  title: string;
  description: string;
  documentType: AiDocumentType;
  source: string;
  sourceKey: string;
  storagePath: string;
  status: AiDocumentStatus;
  chunkCount: number;
  latestJobStatus: string | null;
  latestJobError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rawContent?: string;
}

export interface AiChunkPreview {
  id: string;
  chunkIndex: number;
  content: string;
  embeddingModel: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AiConversation {
  id: string;
  userId: number;
  businessId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSourceCitation {
  kind: 'documentation' | 'live_data';
  title: string;
  detail: string;
  similarity?: number;
  module?: NavModuleId;
}

export interface AiSuggestedLink {
  label: string;
  module: NavModuleId;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  userId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: {
    model?: string;
    detailMode?: 'concise' | 'detailed';
    sources?: ChatSourceCitation[];
    suggestedLinks?: AiSuggestedLink[];
    retrievedChunkCount?: number;
  };
  createdAt: string;
}

export interface AiChatResponse {
  conversation: AiConversation;
  userMessage: AiMessage;
  assistantMessage: AiMessage;
  sources: ChatSourceCitation[];
  suggestedLinks: AiSuggestedLink[];
  model: string;
}
