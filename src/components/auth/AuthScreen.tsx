import React, { useState } from 'react';
import { Eye, EyeOff, Lock, ArrowRight, Layers, ShieldCheck, HelpCircle } from 'lucide-react';
import { apiRequest, setInMemoryAuthToken } from '../../lib/api';
import type { BusinessSettings, BusinessSummary, User } from '../../types';

interface AuthScreenProps {
  needsSetup: boolean;
  onAuthenticated: (
    user: User,
    settings: BusinessSettings,
    businesses: BusinessSummary[]
  ) => void;
}

export function AuthScreen({ needsSetup, onAuthenticated }: AuthScreenProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showResetHelp, setShowResetHelp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (needsSetup && !name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid work email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = needsSetup ? '/api/auth/setup' : '/api/auth/login';
      const payload = needsSetup
        ? { name: name.trim(), email: trimmedEmail, password }
        : { email: trimmedEmail, password };

      const res = await apiRequest<{
        token: string;
        user: User;
        settings: BusinessSettings;
        businesses: BusinessSummary[];
      }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setInMemoryAuthToken(res.token);
      onAuthenticated(res.user, res.settings, res.businesses ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F5F5F0] dark:bg-[#15191E]">
      {/* Left Structural Brand Column */}
      <div className="lg:col-span-5 bg-[#15191E] text-white p-8 lg:p-12 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#29323C]">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C5F36B] text-[#15191E] flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight font-display">StockWise</span>
          </div>

          <div className="mt-12 lg:mt-20 max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#C5F36B] mb-3">
              Inventory &amp; Business Intelligence
            </p>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight font-display text-white leading-tight [text-wrap:balance]">
              Operational clarity for every SKU, order, and warehouse movement.
            </h1>
            <p className="mt-4 text-sm text-[#89919A] leading-relaxed">
              Manage multi-business stock, supplier purchase orders, invoiced sales, valuation analytics, audit trails, and role-based team access from one unified platform.
            </p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-[#29323C] grid grid-cols-3 gap-4 text-xs">
          <div>
            <p className="text-[#89919A]">Modules</p>
            <p className="font-semibold text-white mt-0.5 tabular-nums">14 Integrated</p>
          </div>
          <div>
            <p className="text-[#89919A]">Access Control</p>
            <p className="font-semibold text-white mt-0.5">Role + Audit Log</p>
          </div>
          <div>
            <p className="text-[#89919A]">Ledger</p>
            <p className="font-semibold text-white mt-0.5">Atomic SQLite</p>
          </div>
        </div>
      </div>

      {/* Right Auth Form Column */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-8 shadow-sm">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#3C5811] dark:text-[#C5F36B] mb-2">
              {needsSetup ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>First-Run Workspace Claim</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Workspace Authentication</span>
                </>
              )}
            </div>
            <h2 className="text-2xl font-bold text-[#15191E] dark:text-white font-display">
              {needsSetup ? 'Initialize Admin Account' : 'Sign in to StockWise'}
            </h2>
            <p className="text-sm text-[#89919A] mt-1">
              {needsSetup
                ? 'Set up the primary administrator account to unlock your inventory ledger.'
                : 'Enter your assigned email and password to access the operations console.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 px-4 py-3 rounded-lg bg-[#E56B6F]/15 border border-[#E56B6F]/40 text-xs font-medium text-[#962226] dark:text-[#E56B6F]"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsSetup && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-semibold text-[#15191E] dark:text-white mb-1.5"
                >
                  Administrator Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                  className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm text-[#15191E] dark:text-white focus:outline-none focus:border-[#15191E] dark:focus:border-[#C5F36B]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-semibold text-[#15191E] dark:text-white mb-1.5"
              >
                Work Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm text-[#15191E] dark:text-white focus:outline-none focus:border-[#15191E] dark:focus:border-[#C5F36B]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-semibold text-[#15191E] dark:text-white"
                >
                  Password
                </label>
                {!needsSetup && (
                  <button
                    type="button"
                    onClick={() => setShowResetHelp((v) => !v)}
                    className="text-[11px] font-medium text-[#89919A] hover:text-[#15191E] dark:hover:text-[#C5F36B] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <HelpCircle className="w-3 h-3" />
                    <span>Forgot password?</span>
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={needsSetup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full h-10 pl-3 pr-10 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm text-[#15191E] dark:text-white focus:outline-none focus:border-[#15191E] dark:focus:border-[#C5F36B]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#89919A] hover:text-[#15191E] dark:hover:text-white p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {showResetHelp && !needsSetup && (
              <div className="p-3 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs text-[#89919A] leading-relaxed">
                Password resets are issued by your Workspace Administrator under{' '}
                <strong className="text-[#15191E] dark:text-white">User Management</strong>. If you are the primary admin, sign in with your configured{' '}
                <code className="font-mono text-[#15191E] dark:text-[#C5F36B]">ADMIN_PASSCODE</code> or contact your system owner.
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-2 rounded-lg bg-[#C5F36B] hover:bg-[#B7E959] text-[#15191E] font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
            >
              <span>
                {loading
                  ? 'Authenticating...'
                  : needsSetup
                  ? 'Claim Admin Workspace'
                  : 'Sign In'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
