import React from 'react';
import {
  LayoutDashboard,
  Package,
  Boxes,
  FolderTree,
  Truck,
  Users,
  Receipt,
  ClipboardList,
  BarChart3,
  FileSpreadsheet,
  CalendarDays,
  Bell,
  ShieldCheck,
  Settings,
  BookOpenText,
  Layers,
  LogOut,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { BusinessSettings, NavModuleId, User } from '../../types';

export interface NavItemConfig {
  id: NavModuleId;
  label: string;
  section: 'Operations' | 'Commerce' | 'Intelligence' | 'Administration';
  icon: React.ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', section: 'Operations', icon: LayoutDashboard },
  { id: 'products', label: 'Products', section: 'Operations', icon: Package },
  { id: 'inventory', label: 'Inventory', section: 'Operations', icon: Boxes },
  { id: 'categories', label: 'Categories', section: 'Operations', icon: FolderTree },
  { id: 'suppliers', label: 'Suppliers', section: 'Commerce', icon: Truck },
  { id: 'customers', label: 'Customers', section: 'Commerce', icon: Users },
  { id: 'sales', label: 'Sales', section: 'Commerce', icon: Receipt },
  { id: 'purchases', label: 'Purchases', section: 'Commerce', icon: ClipboardList },
  { id: 'analytics', label: 'Analytics', section: 'Intelligence', icon: BarChart3 },
  { id: 'reports', label: 'Reports', section: 'Intelligence', icon: FileSpreadsheet },
  { id: 'calendar', label: 'Calendar', section: 'Intelligence', icon: CalendarDays },
  { id: 'notifications', label: 'Notifications', section: 'Intelligence', icon: Bell },
  { id: 'knowledge_base', label: 'AI Knowledge Base', section: 'Administration', icon: BookOpenText },
  { id: 'users', label: 'User Management', section: 'Administration', icon: ShieldCheck },
  { id: 'settings', label: 'Settings', section: 'Administration', icon: Settings },
];

interface SidebarProps {
  activeModule: NavModuleId;
  onSelectModule: (id: NavModuleId) => void;
  unreadCount: number;
  user: User;
  settings: BusinessSettings;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
}

export function Sidebar({
  activeModule,
  onSelectModule,
  unreadCount,
  user,
  settings,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  onLogout,
}: SidebarProps) {
  const sections: Array<NavItemConfig['section']> = [
    'Operations',
    'Commerce',
    'Intelligence',
    'Administration',
  ];

  const renderSidebarBody = (isMobileDrawer: boolean) => {
    const isMini = collapsed && !isMobileDrawer;

    return (
      <div
        className={`h-full ${
          isMini ? 'w-[76px]' : 'w-[260px]'
        } bg-[#15191E] text-white flex flex-col border-r border-[#29323C] select-none transition-[width] duration-200`}
      >
        {/* Brand Header */}
        <div
          className={`h-16 ${
            isMini ? 'px-3 justify-center' : 'px-4 justify-between'
          } flex items-center border-b border-[#29323C] shrink-0`}
        >
          <button
            type="button"
            onClick={() => {
              onSelectModule('dashboard');
              onCloseMobile();
            }}
            title={isMini ? `StockWise · ${settings.companyName}` : undefined}
            className="flex items-center gap-2.5 text-left min-w-0 cursor-pointer"
          >
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.companyName}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-lg object-cover bg-white shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-[#C5F36B] text-[#15191E] flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4" />
              </div>
            )}
            {!isMini && (
              <div className="min-w-0">
                <p className="text-sm font-bold text-white tracking-tight font-display truncate">
                  StockWise
                </p>
                <p className="text-[11px] text-[#89919A] truncate">{settings.companyName}</p>
              </div>
            )}
          </button>

          {!isMobileDrawer && !isMini && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="p-1.5 rounded-lg text-[#89919A] hover:text-white hover:bg-[#202832] transition-colors cursor-pointer shrink-0"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}

          {isMobileDrawer && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation menu"
              className="lg:hidden p-1.5 rounded-lg text-[#89919A] hover:text-white hover:bg-[#202832]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
          {sections.map((section) => {
            const items = NAV_ITEMS.filter((i) => i.section === section);
            return (
              <div key={section}>
                {!isMini ? (
                  <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#89919A]">
                    {section}
                  </p>
                ) : (
                  <div className="mx-3 my-1.5 h-px bg-[#29323C]" aria-hidden="true" />
                )}
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeModule === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectModule(item.id);
                            onCloseMobile();
                          }}
                          title={isMini ? item.label : undefined}
                          aria-label={item.label}
                          aria-current={isActive ? 'page' : undefined}
                          className={`relative w-full flex items-center ${
                            isMini ? 'justify-center px-2' : 'justify-between px-3'
                          } gap-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            isActive
                              ? 'bg-[#202832] text-white font-semibold'
                              : 'text-[#89919A] hover:text-white hover:bg-[#202832]/60'
                          }`}
                        >
                          {isActive && (
                            <span
                              className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#C5F36B]"
                              aria-hidden="true"
                            />
                          )}
                          <span className="flex items-center gap-2.5 min-w-0">
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive ? 'text-[#C5F36B]' : 'text-[#89919A]'
                              }`}
                            />
                            {!isMini && <span className="truncate">{item.label}</span>}
                          </span>
                          {!isMini && item.id === 'notifications' && unreadCount > 0 && (
                            <span className="px-1.5 py-0.5 min-w-[20px] text-center rounded-md bg-[#C5F36B] text-[#15191E] text-[10px] font-bold tabular-nums">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                          )}
                          {isMini && item.id === 'notifications' && unreadCount > 0 && (
                            <span className="absolute top-1.5 right-2.5 min-w-[14px] h-[14px] px-0.5 rounded bg-[#C5F36B] text-[#15191E] text-[9px] font-bold flex items-center justify-center tabular-nums">
                              {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Expand button when collapsed + Account Footer */}
        <div className="p-2.5 border-t border-[#29323C] shrink-0 space-y-2">
          {!isMobileDrawer && isMini && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="w-full h-9 rounded-lg flex items-center justify-center text-[#89919A] hover:text-white hover:bg-[#202832] transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          {isMini ? (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              title={`Sign out (${user.name})`}
              className="w-full h-9 rounded-lg flex items-center justify-center text-[#89919A] hover:text-[#E56B6F] hover:bg-[#202832] transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#202832]">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{user.name}</p>
                <p className="text-[11px] text-[#89919A] capitalize truncate">
                  {user.role} · {user.email}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                aria-label="Sign out"
                title="Sign out"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#89919A] hover:text-[#E56B6F] hover:bg-[#29323C] transition-colors shrink-0 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <aside className="hidden lg:block shrink-0 no-print">{renderSidebarBody(false)}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-[#15191E]/70 backdrop-blur-[2px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{renderSidebarBody(true)}</div>
        </div>
      )}
    </>
  );
}
