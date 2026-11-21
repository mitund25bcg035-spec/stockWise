import React, { useCallback, useEffect, useState } from 'react';
import {
  apiRequest,
  getActiveBusinessId,
  setActiveBusinessId,
  setInMemoryAuthToken,
} from './lib/api';
import { AuthScreen } from './components/auth/AuthScreen';
import { Sidebar } from './components/layout/Sidebar';
import { Header, type QuickCreateAction } from './components/layout/Header';
import { ToastContainer, type ToastMessage } from './components/ui/Toast';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { CustomersPage } from './pages/CustomersPage';
import { SalesPage } from './pages/SalesPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ReportsPage } from './pages/ReportsPage';
import { CalendarPage } from './pages/CalendarPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { SettingsPage } from './pages/SettingsPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { StockWiseChatbot } from './components/ai/StockWiseChatbot';
import type {
  BusinessSettings,
  BusinessSummary,
  CalendarEvent,
  Category,
  Customer,
  NavModuleId,
  NotificationItem,
  Product,
  Purchase,
  Sale,
  StockMovement,
  Supplier,
  User,
} from './types';

const DEFAULT_SETTINGS: BusinessSettings = {
  businessId: 1,
  companyName: 'StockWise Operations',
  logoUrl: '',
  email: 'operations@stockwise.io',
  phone: '+1 (415) 890-4410',
  address: '740 Market Street, Suite 400, San Francisco, CA 94103',
  currency: 'USD',
  taxRate: 8.5,
  theme: 'light',
  dateFormat: 'MMM DD, YYYY',
  language: 'en',
  lowStockAlertsEnabled: true,
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([]);
  const [activeBusinessIdState, setActiveBusinessIdState] = useState<number>(
    () => getActiveBusinessId() ?? 1
  );
  const [settings, setSettings] = useState<BusinessSettings>(DEFAULT_SETTINGS);

  const [activeModule, setActiveModule] = useState<NavModuleId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickModal, setQuickModal] = useState<QuickCreateAction | null>(null);

  const [dataLoading, setDataLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-1), { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  const loadWorkspaceData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [
        prods,
        cats,
        sups,
        custs,
        moves,
        sls,
        pos,
        cal,
        notifs,
        cfg,
        bizList,
      ] = await Promise.all([
        apiRequest<Product[]>('/api/products'),
        apiRequest<Category[]>('/api/categories'),
        apiRequest<Supplier[]>('/api/suppliers'),
        apiRequest<Customer[]>('/api/customers'),
        apiRequest<StockMovement[]>('/api/inventory/movements'),
        apiRequest<Sale[]>('/api/sales'),
        apiRequest<Purchase[]>('/api/purchases'),
        apiRequest<CalendarEvent[]>('/api/calendar'),
        apiRequest<NotificationItem[]>('/api/notifications'),
        apiRequest<BusinessSettings>('/api/settings'),
        apiRequest<BusinessSummary[]>('/api/businesses'),
      ]);

      setProducts(prods);
      setCategories(cats);
      setSuppliers(sups);
      setCustomers(custs);
      setMovements(moves);
      setSales(sls);
      setPurchases(pos);
      setCalendarEvents(cal);
      setNotifications(notifs);
      setSettings(cfg);
      setBusinesses(bizList);
      setActiveBusinessIdState(cfg.businessId);
      setActiveBusinessId(cfg.businessId);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to load workspace data.');
    } finally {
      setDataLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const status = await apiRequest<{
          needsSetup: boolean;
          user: User | null;
          settings: BusinessSettings | null;
          businesses?: BusinessSummary[];
        }>('/api/auth/status');
        setNeedsSetup(status.needsSetup);
        if (status.businesses) setBusinesses(status.businesses);
        if (status.user && status.settings) {
          setUser(status.user);
          setSettings(status.settings);
          setActiveBusinessIdState(status.settings.businessId);
          setActiveBusinessId(status.settings.businessId);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    }
    bootstrap();
  }, []);

  useEffect(() => {
    if (user) {
      loadWorkspaceData();
    }
  }, [user, loadWorkspaceData]);

  async function handleSwitchBusiness(nextBusinessId: number) {
    setActiveBusinessId(nextBusinessId);
    setActiveBusinessIdState(nextBusinessId);
    await loadWorkspaceData();
    const target = businesses.find((b) => b.id === nextBusinessId);
    if (target) {
      addToast('success', `Switched to "${target.name}".`);
    }
  }

  async function handleCreateBusiness(name: string, currency: BusinessSettings['currency']) {
    try {
      const res = await apiRequest<{
        business: BusinessSummary;
        businesses: BusinessSummary[];
        settings: BusinessSettings;
      }>('/api/businesses', {
        method: 'POST',
        body: JSON.stringify({ name, currency }),
      });
      setBusinesses(res.businesses);
      setActiveBusinessId(res.business.id);
      setActiveBusinessIdState(res.business.id);
      setSettings(res.settings);
      await loadWorkspaceData();
      addToast('success', `Created workspace "${res.business.name}".`);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to create business.');
      throw err;
    }
  }

  async function handleToggleTheme() {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    setSettings((prev) => ({ ...prev, theme: nextTheme }));
    try {
      await apiRequest('/api/settings/theme', {
        method: 'PATCH',
        body: JSON.stringify({ theme: nextTheme }),
      });
    } catch {
      // ignore background theme persistence error
    }
  }

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setInMemoryAuthToken(null);
    setUser(null);
    setNeedsSetup(false);
    setActiveModule('dashboard');
  }

  function handleQuickAction(action: QuickCreateAction) {
    setQuickModal(action);
    if (action === 'add_product') setActiveModule('products');
    if (action === 'new_sale') setActiveModule('sales');
    if (action === 'adjust_stock') setActiveModule('inventory');
    if (action === 'new_po') setActiveModule('purchases');
    if (action === 'add_supplier') setActiveModule('suppliers');
  }

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F0] dark:bg-[#15191E]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg border-2 border-[#15191E] dark:border-[#C5F36B] border-t-transparent animate-spin" />
          <p className="text-xs font-medium text-[#89919A]">Loading StockWise...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthScreen
          needsSetup={needsSetup}
          onAuthenticated={(authUser, authSettings, authBusinesses) => {
            setUser(authUser);
            setSettings(authSettings);
            setBusinesses(authBusinesses);
            setActiveBusinessIdState(authSettings.businessId);
            setActiveBusinessId(authSettings.businessId);
            setNeedsSetup(false);
          }}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const unreadNotifications = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="min-h-screen flex bg-[#F5F5F0] dark:bg-[#15191E] text-[#15191E] dark:text-[#F5F5F0]">
      <Sidebar
        activeModule={activeModule}
        onSelectModule={setActiveModule}
        unreadCount={unreadNotifications}
        user={user}
        settings={settings}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          unreadCount={unreadNotifications}
          settings={settings}
          businesses={businesses}
          activeBusinessId={activeBusinessIdState}
          onSwitchBusiness={handleSwitchBusiness}
          onToggleTheme={handleToggleTheme}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenQuickAction={handleQuickAction}
          onLogout={handleLogout}
          user={user}
          products={products}
          categories={categories}
          suppliers={suppliers}
          customers={customers}
          sales={sales}
          purchases={purchases}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {dataLoading && products.length === 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded-2xl bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] animate-pulse"
                  />
                ))}
              </div>
              <div className="h-72 rounded-2xl bg-white dark:bg-[#202832] border border-[#E2E4DF] dark:border-[#29323C] animate-pulse" />
            </div>
          ) : (
            <>
              {activeModule === 'dashboard' && (
                <DashboardPage
                  products={products}
                  categories={categories}
                  suppliers={suppliers}
                  customers={customers}
                  sales={sales}
                  movements={movements}
                  calendarEvents={calendarEvents}
                  settings={settings}
                  user={user}
                  onNavigate={setActiveModule}
                  onOpenQuickAction={handleQuickAction}
                />
              )}

              {activeModule === 'products' && (
                <ProductsPage
                  products={products}
                  categories={categories}
                  suppliers={suppliers}
                  movements={movements}
                  settings={settings}
                  user={user}
                  initialOpenCreate={quickModal === 'add_product'}
                  onClearInitialCreate={() => setQuickModal(null)}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'inventory' && (
                <InventoryPage
                  products={products}
                  movements={movements}
                  settings={settings}
                  user={user}
                  initialOpenAdjust={quickModal === 'adjust_stock'}
                  onClearInitialAdjust={() => setQuickModal(null)}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'categories' && (
                <CategoriesPage
                  categories={categories}
                  products={products}
                  settings={settings}
                  user={user}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'suppliers' && (
                <SuppliersPage
                  suppliers={suppliers}
                  products={products}
                  purchases={purchases}
                  settings={settings}
                  user={user}
                  initialOpenCreate={quickModal === 'add_supplier'}
                  onClearInitialCreate={() => setQuickModal(null)}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'customers' && (
                <CustomersPage
                  customers={customers}
                  sales={sales}
                  settings={settings}
                  user={user}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'sales' && (
                <SalesPage
                  sales={sales}
                  products={products}
                  customers={customers}
                  settings={settings}
                  user={user}
                  initialOpenCreate={quickModal === 'new_sale'}
                  onClearInitialCreate={() => setQuickModal(null)}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'purchases' && (
                <PurchasesPage
                  purchases={purchases}
                  suppliers={suppliers}
                  products={products}
                  settings={settings}
                  user={user}
                  initialOpenCreate={quickModal === 'new_po'}
                  onClearInitialCreate={() => setQuickModal(null)}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'analytics' && (
                <AnalyticsPage
                  products={products}
                  categories={categories}
                  suppliers={suppliers}
                  sales={sales}
                  purchases={purchases}
                  settings={settings}
                />
              )}

              {activeModule === 'reports' && (
                <ReportsPage
                  products={products}
                  categories={categories}
                  sales={sales}
                  purchases={purchases}
                  movements={movements}
                  suppliers={suppliers}
                  customers={customers}
                  settings={settings}
                  user={user}
                  onToast={addToast}
                />
              )}

              {activeModule === 'calendar' && (
                <CalendarPage
                  events={calendarEvents}
                  purchases={purchases}
                  sales={sales}
                  settings={settings}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'notifications' && (
                <NotificationsPage
                  notifications={notifications}
                  onNavigate={setActiveModule}
                  onRefresh={loadWorkspaceData}
                  onToast={addToast}
                />
              )}

              {activeModule === 'knowledge_base' && (
                <KnowledgeBasePage
                  user={user}
                  activeBusinessId={activeBusinessIdState}
                  onToast={addToast}
                />
              )}

              {activeModule === 'users' && (
                <UserManagementPage user={user} onToast={addToast} />
              )}

              {activeModule === 'settings' && (
                <SettingsPage
                  settings={settings}
                  businesses={businesses}
                  activeBusinessId={activeBusinessIdState}
                  user={user}
                  onUpdateSettings={setSettings}
                  onSwitchBusiness={handleSwitchBusiness}
                  onCreateBusiness={handleCreateBusiness}
                  onToggleTheme={handleToggleTheme}
                  onNavigate={setActiveModule}
                  onToast={addToast}
                />
              )}
            </>
          )}
        </main>
      </div>

      <StockWiseChatbot
        user={user}
        activeBusinessId={activeBusinessIdState}
        settings={settings}
        onNavigate={setActiveModule}
        onToast={addToast}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
