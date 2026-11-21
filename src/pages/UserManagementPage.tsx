import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Plus,
  Pencil,
  KeyRound,
  Trash2,
  Search,
  History,
  Lock,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Modal } from '../components/ui/Modal';
import { StatusBadge } from '../components/ui/StatusBadge';
import type { AuditLogEntry, StaffPermissions, User, UserRole } from '../types';

interface UserManagementPageProps {
  user: User;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const DEFAULT_PERMS: StaffPermissions = {
  canEditProducts: true,
  canAdjustInventory: true,
  canCreateSales: true,
  canManagePurchases: false,
  canManageContacts: true,
  canExportReports: true,
};

const PERMISSION_LABELS: Array<[keyof StaffPermissions, string]> = [
  ['canEditProducts', 'Add & Edit Products / Categories'],
  ['canAdjustInventory', 'Record Stock Adjustments'],
  ['canCreateSales', 'Issue & Manage Sales Invoices'],
  ['canManagePurchases', 'Manage Purchase Orders'],
  ['canManageContacts', 'Manage Suppliers & Customers'],
  ['canExportReports', 'Export CSV & Reports'],
];

export function UserManagementPage({ user, onToast }: UserManagementPageProps) {
  const isAdmin = user.role === 'admin';
  const [usersList, setUsersList] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('staff');
  const [formPerms, setFormPerms] = useState<StaffPermissions>(DEFAULT_PERMS);
  const [savingUser, setSavingUser] = useState(false);

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  const [auditSearch, setAuditSearch] = useState('');

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [uRes, logsRes] = await Promise.all([
        apiRequest<User[]>('/api/users'),
        apiRequest<AuditLogEntry[]>('/api/audit-logs'),
      ]);
      setUsersList(uRes);
      setAuditLogs(logsRes);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to load team directory.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, onToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.userName.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-10 text-center max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] flex items-center justify-center mx-auto mb-3">
          <Lock className="w-5 h-5 text-[#89919A]" />
        </div>
        <h2 className="text-base font-bold font-display">Administrator Access Required</h2>
        <p className="text-xs text-[#89919A] mt-1.5">
          Only workspace administrators can create team accounts, modify permissions, reset passwords,
          or inspect the system audit trail.
        </p>
      </div>
    );
  }

  function openCreateModal() {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('staff');
    setFormPerms(DEFAULT_PERMS);
    setUserModalOpen(true);
  }

  function openEditModal(target: User) {
    setEditingUser(target);
    setFormName(target.name);
    setFormEmail(target.email);
    setFormPassword('');
    setFormRole(target.role);
    setFormPerms(target.permissions);
    setUserModalOpen(true);
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    try {
      if (editingUser) {
        await apiRequest(`/api/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: formName.trim(),
            role: formRole,
            permissions: formPerms,
            active: editingUser.active,
          }),
        });
        onToast('success', `Updated permissions for ${formName.trim()}.`);
      } else {
        await apiRequest('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            name: formName.trim(),
            email: formEmail.trim(),
            password: formPassword,
            role: formRole,
            permissions: formPerms,
          }),
        });
        onToast('success', `Created account for ${formName.trim()}.`);
      }
      setUserModalOpen(false);
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to save user.');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < 6) {
      onToast('error', 'Temporary password must be at least 6 characters.');
      return;
    }
    setResetting(true);
    try {
      await apiRequest(`/api/users/${resetTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({ password: resetPassword }),
      });
      onToast('success', `Password reset for ${resetTarget.name}.`);
      setResetTarget(null);
      setResetPassword('');
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to reset password.');
    } finally {
      setResetting(false);
    }
  }

  async function toggleUserActive(u: User) {
    try {
      await apiRequest(`/api/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !u.active }),
      });
      onToast('success', `${u.name} is now ${!u.active ? 'active' : 'suspended'}.`);
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to update status.');
    }
  }

  async function deleteUser(u: User) {
    try {
      await apiRequest(`/api/users/${u.id}`, { method: 'DELETE' });
      onToast('success', `Removed user ${u.name}.`);
      await loadData();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Failed to delete user.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Team Directory */}
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#28815F] dark:text-[#C5F36B]" />
            <div>
              <h2 className="text-base font-bold font-display">Team Directory &amp; Access Control</h2>
              <p className="text-xs text-[#89919A]">
                Manage Administrators, Staff accounts, granular permissions, and password resets.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="h-10 px-4 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Team Member</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="h-10 bg-[#F5F5F0] dark:bg-[#15191E] border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                <th className="px-4">User</th>
                <th className="px-4">Role</th>
                <th className="px-4">Permissions</th>
                <th className="px-4">Status</th>
                <th className="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
              {usersList.map((u) => {
                const enabledCount =
                  u.role === 'admin'
                    ? 6
                    : Object.values(u.permissions || {}).filter(Boolean).length;
                return (
                  <tr key={u.id} className="h-14 hover:bg-[#F5F5F0]/60 dark:hover:bg-[#29323C]/50">
                    <td className="px-4">
                      <p className="font-semibold text-[#15191E] dark:text-white">{u.name}</p>
                      <p className="text-[11px] text-[#89919A]">{u.email}</p>
                    </td>
                    <td className="px-4">
                      <StatusBadge variant={u.role} />
                    </td>
                    <td className="px-4 text-[#89919A]">
                      {u.role === 'admin' ? 'Full workspace access' : `${enabledCount} / 6 scopes enabled`}
                    </td>
                    <td className="px-4">
                      <span
                        className={`text-xs font-semibold ${
                          u.active ? 'text-[#28815F] dark:text-[#68B88A]' : 'text-[#B4232A] dark:text-[#E56B6F]'
                        }`}
                      >
                        {u.active ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(u)}
                          aria-label={`Edit ${u.name}`}
                          className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(u);
                            setResetPassword('');
                          }}
                          aria-label={`Reset password for ${u.name}`}
                          title="Reset password"
                          className="p-1.5 rounded-lg hover:bg-[#F5F5F0] dark:hover:bg-[#29323C] cursor-pointer"
                        >
                          <KeyRound className="w-4 h-4" />
                        </button>
                        {u.id !== user.id && (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleUserActive(u)}
                              className="px-2.5 py-1 rounded-md border border-[#E2E4DF] dark:border-[#29323C] font-semibold cursor-pointer whitespace-nowrap"
                            >
                              {u.active ? 'Suspend' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteUser(u)}
                              aria-label={`Delete ${u.name}`}
                              className="p-1.5 rounded-lg text-[#B4232A] dark:text-[#E56B6F] hover:bg-[#E56B6F]/15 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="bg-white dark:bg-[#202832] rounded-2xl border border-[#E2E4DF] dark:border-[#29323C] p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-[#89919A]" />
            <div>
              <h2 className="text-base font-bold font-display">Workspace Audit Trail</h2>
              <p className="text-xs text-[#89919A]">
                Chronological security and operational log for the active business.
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#89919A] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Filter audit logs"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Search user, action, summary..."
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#F5F5F0] dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[#F5F5F0] dark:bg-[#15191E]">
              <tr className="h-9 border-b border-[#E2E4DF] dark:border-[#29323C] text-[11px] font-semibold uppercase tracking-wider text-[#89919A]">
                <th className="px-3">Timestamp</th>
                <th className="px-3">Actor</th>
                <th className="px-3">Action</th>
                <th className="px-3">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E4DF] dark:divide-[#29323C]">
              {loading && filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[#89919A]">
                    Loading audit events...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[#89919A]">
                    No audit events match your filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="h-11">
                    <td className="px-3 text-[#89919A] whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-3 font-semibold whitespace-nowrap">{log.userName}</td>
                    <td className="px-3 font-mono text-[11px] whitespace-nowrap">{log.action}</td>
                    <td className="px-3 text-[#525A63] dark:text-[#C5CBD3]">{log.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit User Modal */}
      <Modal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        title={editingUser ? `Edit User · ${editingUser.name}` : 'Add Team Member'}
        subtitle="Configure role and operational scopes."
      >
        <form onSubmit={handleSaveUser} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Role</label>
              <select
                value={formRole}
                onChange={(e) => setFormRole(e.target.value as UserRole)}
                className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
              >
                <option value="staff">Staff (Scoped)</option>
                <option value="admin">Admin (Full Access)</option>
              </select>
            </div>
            {!editingUser && (
              <>
                <div>
                  <label className="block text-xs font-semibold mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Temporary Password *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
                  />
                </div>
              </>
            )}
          </div>

          {formRole === 'staff' && (
            <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#15191E] space-y-2">
              <p className="text-xs font-semibold">Staff Operational Permissions</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {PERMISSION_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(formPerms[key])}
                      onChange={(e) =>
                        setFormPerms((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                      className="rounded border-[#89919A]"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setUserModalOpen(false)}
              className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingUser}
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
            >
              {savingUser ? 'Saving...' : editingUser ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Admin Password Reset Modal */}
      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={resetTarget ? `Reset Password · ${resetTarget.name}` : 'Reset Password'}
        subtitle={resetTarget?.email}
      >
        <form onSubmit={handleResetPassword} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold mb-1">New Temporary Password *</label>
            <input
              type="password"
              required
              minLength={6}
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="w-full h-10 px-3 rounded-lg bg-white dark:bg-[#15191E] border border-[#E2E4DF] dark:border-[#29323C] text-sm"
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              className="h-10 px-4 rounded-lg border border-[#E2E4DF] dark:border-[#29323C] text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={resetting}
              className="h-10 px-5 rounded-lg bg-[#C5F36B] hover:bg-[#B4E555] text-[#15191E] text-xs font-semibold cursor-pointer"
            >
              {resetting ? 'Updating...' : 'Set New Password'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
