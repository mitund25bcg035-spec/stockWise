import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookOpenText,
  Building2,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { NAV_ITEMS } from './Sidebar';
import { formatCurrency } from '../../lib/format';
import type {
  BusinessSettings,
  BusinessSummary,
  Category,
  Customer,
  NavModuleId,
  Product,
  Purchase,
  Sale,
  Supplier,
  User,
} from '../../types';

export type QuickCreateAction =
  | 'add_product'
  | 'new_sale'
  | 'adjust_stock'
  | 'new_po'
  | 'add_supplier';

interface HeaderProps {
  activeModule: NavModuleId;
  onSelectModule: (id: NavModuleId) => void;
  unreadCount: number;
  settings: BusinessSettings;
  businesses: BusinessSummary[];
  activeBusinessId: number;
  onSwitchBusiness: (businessId: number) => void;
  onToggleTheme: () => void;
  onOpenMobileMenu: () => void;
  onOpenQuickAction: (action: QuickCreateAction) => void;
  onLogout: () => void;
  user: User;
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  customers: Customer[];
  sales: Sale[];
  purchases: Purchase[];
}

export function Header({
  activeModule,
  onSelectModule,
  unreadCount,
  settings,
  businesses,
  activeBusinessId,
  onSwitchBusiness,
  onToggleTheme,
  onOpenMobileMenu,
  onOpenQuickAction,
  onLogout,
  user,
  products,
  categories,
  suppliers,
  customers,
  sales,
  purchases,
}: HeaderProps) {
  const currentNav = NAV_ITEMS.find((n) => n.id === activeModule);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const quickRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setQuickOpen(false);
        setProfileOpen(false);
      }
    }
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 20);
    }
  }, [searchOpen]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) {
        setQuickOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{
      id: string;
      module: NavModuleId;
      group: string;
      title: string;
      subtitle: string;
    }> = [];

    for (const p of products) {
      if (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
      ) {
        results.push({
          id: `prod-${p.id}`,
          module: 'products',
          group: 'Product',
          title: p.name,
          subtitle: `${p.sku} · ${p.quantity} on hand · ${formatCurrency(p.sellingPrice, settings.currency)}`,
        });
      }
    }
    for (const c of categories) {
      if (c.name.toLowerCase().includes(q)) {
        results.push({
          id: `cat-${c.id}`,
          module: 'categories',
          group: 'Category',
          title: c.name,
          subtitle: `${c.productCount ?? 0} SKUs assigned`,
        });
      }
    }
    for (const s of suppliers) {
      if (
        s.companyName.toLowerCase().includes(q) ||
        s.contactName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      ) {
        results.push({
          id: `sup-${s.id}`,
          module: 'suppliers',
          group: 'Supplier',
          title: s.companyName,
          subtitle: s.contactName || s.email || 'Vendor directory',
        });
      }
    }
    for (const c of customers) {
      if (
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      ) {
        results.push({
          id: `cust-${c.id}`,
          module: 'customers',
          group: 'Customer',
          title: c.name,
          subtitle: c.company || c.email || 'Customer account',
        });
      }
    }
    for (const s of sales) {
      if (
        s.invoiceNumber.toLowerCase().includes(q) ||
        s.customerName.toLowerCase().includes(q)
      ) {
        results.push({
          id: `sale-${s.id}`,
          module: 'sales',
          group: 'Sale Invoice',
          title: s.invoiceNumber,
          subtitle: `${s.customerName} · ${formatCurrency(s.totalAmount, settings.currency)}`,
        });
      }
    }
    for (const po of purchases) {
      if (
        po.poNumber.toLowerCase().includes(q) ||
        po.supplierName.toLowerCase().includes(q)
      ) {
        results.push({
          id: `po-${po.id}`,
          module: 'purchases',
          group: 'Purchase Order',
          title: po.poNumber,
          subtitle: `${po.supplierName} · ${formatCurrency(po.totalAmount, settings.currency)}`,
        });
      }
    }

    return results.slice(0, 14);
  }, [searchQuery, products, categories, suppliers, customers, sales, purchases, settings.currency]);

  const canSale = user.role === 'admin' || user.permissions.canCreateSales;
  const canProd = user.role === 'admin' || user.permissions.canEditProducts;
  const canAdjust = user.role === 'admin' || user.permissions.canAdjustInventory;
  const canPO = user.role === 'admin' || user.permissions.canManagePurchases;
  const canContact = user.role === 'admin' || user.permissions.canManageContacts;

  return (
    <>
      <header className="h-16 px-4 sm:px-6 lg:px-8 bg-white dark:bg-[#202832] border-b border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-between gap-3 shrink-0 no-print">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
            className="lg:hidden w-9 h-9 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] shrink-0"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-[#89919A] hidden sm:inline">
              {currentNav?.section ?? 'Workspace'}
            </span>
            <span className="text-[#89919A]/50 hidden sm:inline" aria-hidden="true">
              /
            </span>
            <h1 className="font-semibold text-[#15191E] dark:text-white font-display truncate">
              {currentNav?.label ?? 'Dashboard'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Global Search Trigger */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Global search"
            className="h-9 px-2.5 sm:px-3 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-[#F5F5F0] dark:bg-[#15191E] hover:border-[#89919A] text-xs text-[#89919A] flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden md:inline">Search catalog, orders...</span>
            <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-mono rounded bg-white dark:bg-[#29323C] text-[#89919A] border border-[#E2E4DF] dark:border-[#29323C]">
              ⌘K
            </kbd>
          </button>

          {/* Business Selector */}
          {businesses.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] bg-white dark:bg-[#15191E]">
              <Building2 className="w-3.5 h-3.5 text-[#89919A] shrink-0" />
              <select
                aria-label="Select business workspace"
                value={activeBusinessId}
                onChange={(e) => onSwitchBusiness(Number(e.target.value))}
                className="bg-transparent text-xs font-medium text-[#15191E] dark:text-white focus:outline-none cursor-pointer max-w-[200px]"
              >
                {businesses.map((b) => (
                  <option key={b.id} value={b.id} className="bg-white dark:bg-[#202832]">
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Quick-Create Action Dropdown */}
          {(canSale || canProd || canAdjust || canPO || canContact) && (
            <div className="relative" ref={quickRef}>
              <button
                type="button"
                onClick={() => setQuickOpen((v) => !v)}
                aria-label="Quick create action"
                className="h-9 px-3 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Quick Create</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              {quickOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] shadow-lg py-1.5 z-40">
                  {canSale && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickOpen(false);
                        onOpenQuickAction('new_sale');
                      }}
                      className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                    >
                      New Sale Invoice
                    </button>
                  )}
                  {canProd && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickOpen(false);
                        onOpenQuickAction('add_product');
                      }}
                      className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                    >
                      Add New Product
                    </button>
                  )}
                  {canPO && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickOpen(false);
                        onOpenQuickAction('new_po');
                      }}
                      className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                    >
                      Create Purchase Order
                    </button>
                  )}
                  {canAdjust && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickOpen(false);
                        onOpenQuickAction('adjust_stock');
                      }}
                      className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                    >
                      Stock Adjustment
                    </button>
                  )}
                  {canContact && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickOpen(false);
                        onOpenQuickAction('add_supplier');
                      }}
                      className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                    >
                      Add Supplier
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-9 h-9 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] transition-colors cursor-pointer"
          >
            {settings.theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Notification Bell */}
          <button
            type="button"
            onClick={() => onSelectModule('notifications')}
            aria-label={`Notifications (${unreadCount} unread)`}
            className="relative w-9 h-9 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-center text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-md bg-[#E56B6F] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* User Profile Menu */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => setProfileOpen((v) => !v)}
              aria-label="User profile menu"
              className="hidden sm:flex items-center gap-2 pl-2 pr-2.5 h-9 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span className="w-6 h-6 rounded-md bg-[#15191E] dark:bg-[#C5F36B] text-[#C5F36B] dark:text-[#15191E] text-[11px] font-bold flex items-center justify-center">
                {user.name
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <span className="text-xs font-medium text-[#15191E] dark:text-white">
                {user.name}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#89919A]" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] shadow-lg py-1.5 z-40">
                <div className="px-3.5 py-2 border-b border-[#E2E4DF] dark:border-[#29323C]">
                  <p className="text-xs font-semibold text-[#15191E] dark:text-white truncate">
                    {user.name}
                  </p>
                  <p className="text-[11px] text-[#89919A] truncate">
                    {user.role.toUpperCase()} · {user.email}
                  </p>
                </div>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onSelectModule('knowledge_base');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpenText className="w-3.5 h-3.5 text-[#89919A]" />
                    <span>AI Knowledge Base</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    onSelectModule('users');
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] flex items-center gap-2 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#89919A]" />
                  <span>User Management</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    onSelectModule('settings');
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#15191E] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] flex items-center gap-2 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5 text-[#89919A]" />
                  <span>Workspace Settings</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    onLogout();
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-[#E56B6F] hover:bg-[#E56B6F]/10 flex items-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Global Search Command Palette Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-[#15191E]/70 backdrop-blur-[2px] no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Global workspace search"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSearchOpen(false);
          }}
        >
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 h-13 border-b border-[#E2E4DF] dark:border-[#29323C]">
              <Search className="w-4 h-4 text-[#89919A] shrink-0" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products, SKUs, categories, suppliers, customers, invoices, POs..."
                className="flex-1 bg-transparent text-sm text-[#15191E] dark:text-white placeholder:text-[#89919A] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close global search"
                className="p-1 text-[#89919A] hover:text-[#15191E] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {!searchQuery.trim() ? (
                <div className="px-4 py-8 text-center text-xs text-[#89919A]">
                  Type a product name, SKU, invoice number, supplier, or customer name to jump directly.
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-[#89919A]">
                  No records match &ldquo;{searchQuery}&rdquo;.
                </div>
              ) : (
                <div className="space-y-1">
                  {searchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectModule(item.module);
                        setSearchOpen(false);
                        setSearchQuery('');
                      }}
                      className="w-full px-3 py-2.5 rounded-xl text-left hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#15191E] dark:text-white truncate">
                          {item.title}
                        </p>
                        <p className="text-[11px] text-[#89919A] truncate">{item.subtitle}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-[#F5F5F0] dark:bg-[#15191E] text-[10px] font-semibold text-[#89919A] shrink-0">
                        {item.group}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
