import React, { useEffect, useState } from 'react';
import { Upload, Plus, Shield, KeyRound, Building2, ArrowRight } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { readImageFileAsDataUrl } from '../lib/format';
import { Modal } from '../components/ui/Modal';
import type { BusinessSettings, BusinessSummary, NavModuleId, User } from '../types';

interface SettingsPageProps {
  settings: BusinessSettings;
  businesses: BusinessSummary[];
  activeBusinessId: number;
  user: User;
  onUpdateSettings: (next: BusinessSettings) => void;
  onSwitchBusiness: (businessId: number) => void;
  onCreateBusiness: (name: string, currency: BusinessSettings['currency']) => Promise<void>;
  onToggleTheme: () => void;
  onNavigate: (module: NavModuleId) => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function SettingsPage({
  settings,
  businesses,
  activeBusinessId,
  user,
  onUpdateSettings,
  onSwitchBusiness,
  onCreateBusiness,
  onToggleTheme,
  onNavigate,
  onToast,
}: SettingsPageProps) {
  const isAdmin = user.role === 'admin';

  // Business Profile state
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl);
  const [email, setEmail] = useState(settings.email);
  const [phone, setPhone] = useState(settings.phone);
  const [address, setAddress] = useState(settings.address);
  const [currency, setCurrency] = useState<BusinessSettings['currency']>(settings.currency);
  const [taxRate, setTaxRate] = useState(String(settings.taxRate));
  const [dateFormat, setDateFormat] = useState<BusinessSettings['dateFormat']>(
    settings.dateFormat || 'MMM DD, YYYY'
  );
  const [language, setLanguage] = useState(settings.language || 'en');
  const [lowStockAlertsEnabled, setLowStockAlertsEnabled] = useState(
    settings.lowStockAlertsEnabled ?? true
  );
  const [savingProfile, setSavingProfile] = useState(false);

  // Create Business modal
  const [bizModalOpen, setBizModalOpen] = useState(false);
  const [newBizName, setNewBizName] = useState('');
  const [newBizCurrency, setNewBizCurrency] = useState<BusinessSettings['currency']>('USD');
  const [creatingBiz, setCreatingBiz] = useState(false);

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setLogoUrl(settings.logoUrl);
    setEmail(settings.email);
    setPhone(settings.phone);
    setAddress(settings.address);
    setCurrency(settings.currency);
    setTaxRate(String(settings.taxRate));
    setDateFormat(settings.dateFormat || 'MMM DD, YYYY');
    setLanguage(settings.language || 'en');
    setLowStockAlertsEnabled(settings.lowStockAlertsEnabled ?? true);
  }, [settings]);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setLogoUrl(dataUrl);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Logo upload failed.');
    }
  }

  async function handleSaveBusiness(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const updated = await apiRequest<BusinessSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          companyName: companyName.trim(),
          logoUrl,
          email: email.trim(),
          phone: phone.trim(),
          address: address.trim(),
          currency,
          taxRate: Number(taxRate) || 0,
          theme: settings.theme,
          dateFormat,
          language,
          lowStockAlertsEnabled,
        }),
      });
      onUpdateSettings(updated);
      onToast('success', 'Business settings saved.');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleCreateBizSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newBizName.trim()) return;
    setCreatingBiz(true);
    try {
      await onCreateBusiness(newBizName.trim(), newBizCurrency);
      setBizModalOpen(false);
      setNewBizName('');
    } finally {
      setCreatingBiz(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      onToast('error', 'New password must be at least 6 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      onToast('success', 'Password updated successfully.');
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Password change failed.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Multi-Business Manager */}
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-[#28815F] dark:text-[#C5F36B]" />
            <div>
              <h2 className="text-base font-bold font-display">Business Workspaces</h2>
              <p className="text-xs text-[#89919A]">
                Switch between company workspaces or create an isolated store/warehouse ledger.
              </p>
            </div>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setBizModalOpen(true)}
              className="h-9 px-3.5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Business</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {businesses.map((biz) => {
            const active = biz.id === activeBusinessId;
            return (
              <button
                key={biz.id}
                type="button"
                onClick={() => !active && onSwitchBusiness(biz.id)}
                className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                  active
                    ? 'border-[#15191E] bg-[#15191E] text-white dark:border-[#C5F36B] dark:bg-[#C5F36B]/15'
                    : 'border-[#E2E4DF] dark:border-[#29323C] hover:bg-[#F5F5F0] dark:hover:bg-[#29323C]/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold truncate">{biz.name}</p>
                  <span className="text-[11px] font-mono opacity-80 shrink-0">{biz.currency}</span>
                </div>
                <p
                  className={`text-[11px] mt-1 ${
                    active ? 'text-[#C5F36B]' : 'text-[#89919A]'
                  }`}
                >
                  {active ? 'Active Workspace' : 'Click to switch'}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Business Profile & Currency/Tax/Format */}
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold font-display">
              Business Profile, Localization &amp; Alerts
            </h2>
            <p className="text-xs text-[#89919A]">
              Configure organization branding, currency, tax rate, date format, and stock alerts.
            </p>
          </div>
          {!isAdmin && (
            <span className="text-xs text-[#89919A]">View only (Admin required to edit)</span>
          )}
        </div>

        <form onSubmit={handleSaveBusiness} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1">Company Name</label>
              <input
                type="text"
                disabled={!isAdmin}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Company Logo</label>
              <div className="flex items-center gap-3">
                <label
                  className={`h-10 px-3.5 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-2 ${
                    isAdmin ? 'cursor-pointer hover:bg-[#F5F5F0] dark:hover:bg-[#29323C]' : 'opacity-50'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload Logo</span>
                  <input
                    type="file"
                    disabled={!isAdmin}
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </label>
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt="Company logo"
                    className="w-10 h-10 rounded-lg object-cover border border-[#E2E4DF]"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Contact Email</label>
              <input
                type="email"
                disabled={!isAdmin}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Phone</label>
              <input
                type="text"
                disabled={!isAdmin}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm disabled:opacity-60"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">Business Address</label>
              <input
                type="text"
                disabled={!isAdmin}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Currency</label>
              <select
                disabled={!isAdmin}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as BusinessSettings['currency'])}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm disabled:opacity-60"
              >
                <option value="USD">USD ($) — US Dollar</option>
                <option value="EUR">EUR (€) — Euro</option>
                <option value="GBP">GBP (£) — British Pound</option>
                <option value="INR">INR (₹) — Indian Rupee</option>
                <option value="CAD">CAD ($) — Canadian Dollar</option>
                <option value="AUD">AUD ($) — Australian Dollar</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Default Sales Tax (%)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="50"
                disabled={!isAdmin}
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm tabular-nums disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Date Format</label>
              <select
                disabled={!isAdmin}
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value as BusinessSettings['dateFormat'])}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm disabled:opacity-60"
              >
                <option value="MMM DD, YYYY">MMM DD, YYYY (e.g., Nov 21, 2026)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO 8601)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (European)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Workspace Language</label>
              <select
                disabled={!isAdmin}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm disabled:opacity-60"
              >
                <option value="en">English (US / Global)</option>
                <option value="en-GB">English (UK)</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer pt-1">
            <input
              type="checkbox"
              disabled={!isAdmin}
              checked={lowStockAlertsEnabled}
              onChange={(e) => setLowStockAlertsEnabled(e.target.checked)}
              className="rounded border-[#89919A]"
            />
            <span>Automatically trigger Low-Stock &amp; Out-of-Stock alert notifications</span>
          </label>

          {isAdmin && (
            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={savingProfile}
                className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
              >
                {savingProfile ? 'Saving...' : 'Save Business Settings'}
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Theme & Password Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <h2 className="text-base font-semibold font-display mb-1">Theme Preference</h2>
          <p className="text-xs text-[#89919A] mb-4">
            Switch between Warm Off-White Light and Deep Charcoal Dark modes.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => settings.theme !== 'light' && onToggleTheme()}
              className={`flex-1 h-11 rounded-xl border text-xs font-semibold cursor-pointer ${
                settings.theme === 'light'
                  ? 'border-[#15191E] bg-[#15191E] text-[#C5F36B]'
                  : 'border-[#E2E4DF] dark:border-[#29323C]'
              }`}
            >
              Warm Off-White Light
            </button>
            <button
              type="button"
              onClick={() => settings.theme !== 'dark' && onToggleTheme()}
              className={`flex-1 h-11 rounded-xl border text-xs font-semibold cursor-pointer ${
                settings.theme === 'dark'
                  ? 'border-[#C5F36B] bg-[#C5F36B] text-[#15191E]'
                  : 'border-[#E2E4DF] dark:border-[#29323C]'
              }`}
            >
              Deep Charcoal Dark
            </button>
          </div>

          {isAdmin && (
            <div className="mt-5 pt-4 border-t border-[#E2E4DF] dark:border-[#29323C] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <Shield className="w-4 h-4 text-[#28815F] dark:text-[#C5F36B]" />
                <span className="font-semibold">Team Roles, Passwords &amp; Audit Logs</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('users')}
                className="h-8 px-3 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <span>Open User Management</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-[#28815F] dark:text-[#C5F36B]" />
            <h2 className="text-base font-semibold font-display">Account &amp; Password</h2>
          </div>
          <p className="text-xs text-[#89919A] mb-4">
            Signed in as <strong>{user.name}</strong> ({user.email})
          </p>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <input
              type="password"
              required
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="New password (min 6 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
            <button
              type="submit"
              disabled={savingPassword}
              className="h-9 px-4 rounded-lg bg-[#15191E] dark:bg-[#29323C] text-white text-xs font-semibold cursor-pointer"
            >
              {savingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>

      {/* Create New Business Workspace Modal */}
      <Modal
        open={bizModalOpen}
        onClose={() => setBizModalOpen(false)}
        title="Create Business Workspace"
        subtitle="Creates a separate multi-tenant inventory, sales, and supplier ledger."
      >
        <form onSubmit={handleCreateBizSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold mb-1">Business Name *</label>
            <input
              type="text"
              required
              value={newBizName}
              onChange={(e) => setNewBizName(e.target.value)}
              placeholder="e.g., StockWise EU Warehouse"
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Default Currency</label>
            <select
              value={newBizCurrency}
              onChange={(e) => setNewBizCurrency(e.target.value as BusinessSettings['currency'])}
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="INR">INR (₹)</option>
              <option value="CAD">CAD ($)</option>
              <option value="AUD">AUD ($)</option>
            </select>
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setBizModalOpen(false)}
              className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingBiz}
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
            >
              {creatingBiz ? 'Creating...' : 'Create Business'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
