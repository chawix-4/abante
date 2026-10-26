import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  UserPlus,
} from 'lucide-react';
import {
  PriorityPolicyMode,
  RegistrationSource,
  RequestCategory,
  UserRole,
} from '../types/queue';
import type {
  AdminOverviewPayload,
  AuthenticatedStaffUser,
  StaffQueueState,
} from '../types/queue';
import { ApiRequestError, createIdempotencyKey, queueApi } from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminPanelProps {
  authToken: string;
  currentUser: AuthenticatedStaffUser;
  staffState: StaffQueueState | null;
  onStaffStateUpdated: (next: StaffQueueState) => void;
}

interface SecurityCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export function AdminPanel({
  authToken,
  currentUser,
  staffState,
  onStaffStateUpdated,
}: AdminPanelProps) {
  const [overview, setOverview] = useState<AdminOverviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Confirm Reset Session Dialog
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  // Add Staff Form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>(UserRole.Staff);

  // Security & Backend Diagnostics
  const [runningChecks, setRunningChecks] = useState(false);
  const [checkResults, setCheckResults] = useState<SecurityCheckResult[] | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await queueApi.getAdminOverview(authToken);
      setOverview(data);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Failed to load administrator overview.');
      }
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handlePolicyChange = async (policy: PriorityPolicyMode) => {
    if (actionBusy || staffState?.session.priority_policy === policy) return;
    setActionBusy(true);
    setErrorMessage(null);
    setFeedbackMessage(null);
    try {
      const updated = await queueApi.updatePriorityPolicy(authToken, policy);
      onStaffStateUpdated(updated);
      setFeedbackMessage('PWD priority ordering policy updated and recorded in audit log.');
      await loadOverview();
    } catch (err) {
      setErrorMessage(err instanceof ApiRequestError ? err.message : 'Policy update failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmSessionReset = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    setFeedbackMessage(null);
    try {
      const result = await queueApi.resetQueueSession(
        authToken,
        createIdempotencyKey('admin_reset')
      );
      onStaffStateUpdated(result.staff_state);
      setConfirmResetOpen(false);
      setFeedbackMessage(
        `Session ${result.archived_session_id} closed and archived. New session started at Q-001.`
      );
      await loadOverview();
    } catch (err) {
      setErrorMessage(err instanceof ApiRequestError ? err.message : 'Session reset failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateStaff = async (e: FormEvent) => {
    e.preventDefault();
    if (actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    setFeedbackMessage(null);
    try {
      await queueApi.manageStaffAccount(authToken, {
        action: 'create',
        email: newEmail.trim(),
        display_name: newName.trim(),
        password: newPassword,
        role: newRole,
      });
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setNewRole(UserRole.Staff);
      setFeedbackMessage('Authorized staff account created.');
      await loadOverview();
    } catch (err) {
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Could not create staff account.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleStaffActive = async (uid: string) => {
    if (actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    try {
      await queueApi.manageStaffAccount(authToken, { action: 'toggle_active', uid });
      await loadOverview();
    } catch (err) {
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Could not update staff status.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleChangeStaffRole = async (uid: string, role: UserRole) => {
    if (actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    try {
      await queueApi.manageStaffAccount(authToken, { action: 'change_role', uid, role });
      await loadOverview();
    } catch (err) {
      setErrorMessage(err instanceof ApiRequestError ? err.message : 'Could not change role.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSeedDemo = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setErrorMessage(null);
    setFeedbackMessage(null);
    try {
      const next = await queueApi.seedDemoData(authToken);
      onStaffStateUpdated(next);
      setFeedbackMessage(
        'Added 4 clearly labeled [DEMO] tickets to the active session for testing.'
      );
      await loadOverview();
    } catch (err) {
      setErrorMessage(err instanceof ApiRequestError ? err.message : 'Demo seed failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const runLiveSecurityVerification = async () => {
    if (runningChecks) return;
    setRunningChecks(true);
    const results: SecurityCheckResult[] = [];

    // 1. Verify Public Display Projection Zero-PII & Zero-PWD Status
    try {
      const pubState = await queueApi.getPublicState();
      const pubRaw = JSON.stringify(pubState);
      const leaksNameOrPwd =
        pubRaw.includes('display_name') ||
        pubRaw.includes('priority_requested') ||
        pubRaw.includes('priority_verified') ||
        pubRaw.includes('citizen_token');
      results.push({
        name: 'Public Display Zero-PII Projection',
        passed: !leaksNameOrPwd,
        detail: !leaksNameOrPwd
          ? 'Verified: Public display projection omits citizen display_name, citizen_token, and PWD status.'
          : 'Failed: Private fields detected in public projection.',
      });
    } catch {
      results.push({
        name: 'Public Display Zero-PII Projection',
        passed: false,
        detail: 'Error evaluating public display projection.',
      });
    }

    // 2. Verify Unauthenticated Staff Call-Next Rejection (401)
    try {
      await queueApi.callNextTicket('', createIdempotencyKey('sec_test_call'));
      results.push({
        name: 'Unauthenticated Staff Control Denial',
        passed: false,
        detail: 'Unexpectedly permitted Call Next without an active staff session.',
      });
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.status : 0;
      results.push({
        name: 'Unauthenticated Staff Control Denial',
        passed: code === 401,
        detail: `Queue engine rejected unauthenticated Call Next (code ${code}).`,
      });
    }

    // 3. Verify Unauthenticated Audit Read Denial (401)
    try {
      await queueApi.getAdminOverview('');
      results.push({
        name: 'Public Audit Log Protection',
        passed: false,
        detail: 'Unexpectedly permitted audit log read without Administrator session.',
      });
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.status : 0;
      results.push({
        name: 'Public Audit Log Protection',
        passed: code === 401,
        detail: `Queue engine blocked unauthenticated audit history access (code ${code}).`,
      });
    }

    // 4. Verify Input Validation (Rejects Blank Citizen Name)
    try {
      await queueApi.registerCitizenTicket(
        {
          display_name: '    ',
          request_category: RequestCategory.Birth,
          priority_requested: false,
          registration_source: RegistrationSource.CitizenWeb,
        },
        createIdempotencyKey('sec_test_blank')
      );
      results.push({
        name: 'Blank Name Validation Rejection',
        passed: false,
        detail: 'Unexpectedly accepted whitespace-only citizen name.',
      });
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.status : 0;
      const passed = code === 400 || code === 403;
      results.push({
        name: 'Blank Name Validation Rejection',
        passed,
        detail: `Queue engine rejected whitespace-only registration (code ${code}, no ticket created).`,
      });
    }

    setCheckResults(results);
    setRunningChecks(false);
  };

  const remainingWaiting = staffState?.counts.waiting || 0;
  const remainingServing = staffState?.counts.serving || 0;

  return (
    <div className="space-y-8">
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 text-sm"
        >
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {feedbackMessage && (
        <div
          role="status"
          className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-sm"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* 1. Session Closing & Reset + PWD Priority Policy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Session Reset Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-slate-900">
              Session Closing &amp; Sequence Reset
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Closing the active session archives its summary to Session History, preserves all
              existing ticket records and audit logs without deletion, and opens a new session
              restarting display numbers at <span className="font-mono font-semibold">Q-001</span>.
            </p>
            {staffState && (
              <div className="pt-2 text-xs text-slate-600 space-y-1 tabular-nums">
                <p>
                  Active Session ID:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {staffState.session.session_id}
                  </span>{' '}
                  · Next Number:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    Q-{String(staffState.session.next_number).padStart(3, '0')}
                  </span>
                </p>
                <p>
                   Archived Historical Tickets Preserved:{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {overview?.archived_tickets_count ?? 0}
                  </span>
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void handleSeedDemo()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              <Database className="w-4 h-4" aria-hidden="true" />
              <span>Seed [DEMO] Tickets</span>
            </button>

            <button
              type="button"
              disabled={actionBusy}
              onClick={() => setConfirmResetOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-50 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Close &amp; Start New Session</span>
            </button>
          </div>
        </section>

        {/* PWD Priority Policy Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-slate-900">
              Configurable PWD Priority Ordering Policy
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Determines how optional PWD priority requests affect <span className="font-semibold">Call Next</span>.
              Actual operational rules must be reviewed and approved by the Panabo City Civil
              Registry Office. Priority never interrupts a ticket already marked Serving.
            </p>
          </div>

          <div className="space-y-3">
            <label
              className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer ${
                staffState?.session.priority_policy === PriorityPolicyMode.VerifiedOnly
                  ? 'border-blue-900 bg-blue-50/50'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="pwd_policy"
                checked={staffState?.session.priority_policy === PriorityPolicyMode.VerifiedOnly}
                disabled={actionBusy}
                onChange={() => void handlePolicyChange(PriorityPolicyMode.VerifiedOnly)}
                className="mt-1 w-4 h-4 text-blue-900"
              />
              <div className="text-xs sm:text-sm">
                <p className="font-semibold text-slate-900">
                  Staff-Verified PWD Priority Only (Default)
                </p>
                <p className="text-slate-600 mt-0.5">
                  Self-declared PWD requests stay in regular arrival order until an authorized
                  staff member verifies eligibility in person.
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer ${
                staffState?.session.priority_policy === PriorityPolicyMode.IncludeSelfDeclared
                  ? 'border-blue-900 bg-blue-50/50'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="pwd_policy"
                checked={
                  staffState?.session.priority_policy === PriorityPolicyMode.IncludeSelfDeclared
                }
                disabled={actionBusy}
                onChange={() => void handlePolicyChange(PriorityPolicyMode.IncludeSelfDeclared)}
                className="mt-1 w-4 h-4 text-blue-900"
              />
              <div className="text-xs sm:text-sm">
                <p className="font-semibold text-slate-900">
                  Honor Self-Declared PWD Requests Unless Declined
                </p>
                <p className="text-slate-600 mt-0.5">
                  Places pending self-declared PWD requests in the priority tier ahead of standard
                  tickets while preserving first-come, first-served order within each group.
                </p>
              </div>
            </label>
          </div>
        </section>
      </div>

      {/* 2. Authorized Staff Access Management */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Authorized Staff Access</h2>
            <p className="text-sm text-slate-600">
              Role assignment is enforced server-side. Users cannot elevate their own role.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 min-h-9 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="overflow-x-auto border-t border-slate-200">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 pr-4">Staff Member</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Access State</th>
                <th className="py-3 pl-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(overview?.staff_accounts || []).map((acc) => {
                const isSelf = acc.uid === currentUser.uid;
                return (
                  <tr key={acc.uid} className="hover:bg-slate-50/80">
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      {acc.display_name}
                      {isSelf ? ' (You)' : ''}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{acc.email}</td>
                    <td className="py-3 px-4 text-slate-700 capitalize">{acc.role}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold ${
                          acc.active ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {acc.active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() =>
                            void handleChangeStaffRole(
                              acc.uid,
                              acc.role === UserRole.Admin ? UserRole.Staff : UserRole.Admin
                            )
                          }
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          Make {acc.role === UserRole.Admin ? 'Staff' : 'Admin'}
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy || isSelf}
                          onClick={() => void handleToggleStaffActive(acc.uid)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                        >
                          {acc.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add Staff Member Form */}
        <form
          onSubmit={handleCreateStaff}
          className="pt-5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
        >
          <div className="sm:col-span-3 space-y-1">
            <label htmlFor="new-staff-name" className="block text-xs font-semibold text-slate-700">
              Full Display Name
            </label>
            <input
              id="new-staff-name"
              type="text"
              required
              placeholder="Officer Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg min-h-10"
            />
          </div>
          <div className="sm:col-span-3 space-y-1">
            <label htmlFor="new-staff-email" className="block text-xs font-semibold text-slate-700">
              Staff Email
            </label>
            <input
              id="new-staff-email"
              type="email"
              required
              placeholder="officer@panabo.local"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg min-h-10"
            />
          </div>
          <div className="sm:col-span-3 space-y-1">
            <label htmlFor="new-staff-pass" className="block text-xs font-semibold text-slate-700">
              Initial Password (8+ chars)
            </label>
            <input
              id="new-staff-pass"
              type="password"
              required
              minLength={8}
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg min-h-10"
            />
          </div>
          <div className="sm:col-span-3 flex items-center gap-2">
            <select
              aria-label="New staff role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg min-h-10"
            >
              <option value={UserRole.Staff}>Staff</option>
              <option value={UserRole.Admin}>Admin</option>
            </select>
            <button
              type="submit"
              disabled={actionBusy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 disabled:opacity-50 min-h-10 whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              <span>Add</span>
            </button>
          </div>
        </form>
      </section>

      {/* 3. Finalized Session History */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Closed Queue Session History</h2>
          <p className="text-sm text-slate-600">
            Summary records preserved whenever an Administrator closes and resets a queue session.
          </p>
        </div>

        {!overview || overview.session_history.length === 0 ? (
          <p className="py-6 text-sm text-slate-500 border-t border-slate-200">
            No closed sessions recorded yet. Resetting the active session will archive its summary
            here.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 pr-4">Session ID</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Registered</th>
                  <th className="py-3 px-4 text-right">Served</th>
                  <th className="py-3 px-4 text-right">Skipped</th>
                  <th className="py-3 px-4 text-right">Unserved at Close</th>
                  <th className="py-3 pl-4">Closed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-xs tabular-nums">
                {overview.session_history.map((hist) => (
                  <tr key={hist.session_id}>
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">
                      {hist.session_id}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{hist.session_date}</td>
                    <td className="py-2.5 px-4 text-right text-slate-900">
                      {hist.total_registered}
                    </td>
                    <td className="py-2.5 px-4 text-right text-emerald-700">
                      {hist.total_served}
                    </td>
                    <td className="py-2.5 px-4 text-right text-amber-700">
                      {hist.total_skipped}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-600">
                      {hist.unserved_at_close}
                    </td>
                    <td className="py-2.5 pl-4 font-sans text-slate-700">{hist.closed_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Structured Audit Log (Zero Citizen PII) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Structured Audit Event Log</h2>
            <p className="text-sm text-slate-600">
              Idempotent server audit trail of status transitions, priority verifications, and
              admin actions (citizen names omitted for privacy).
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            Showing latest {overview?.audit_events.length || 0} events
          </span>
        </div>

        <div className="overflow-x-auto max-h-96 border-t border-slate-200">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 font-semibold text-slate-500">
                <th className="py-2.5 pr-3">Timestamp</th>
                <th className="py-2.5 px-3">Action Type</th>
                <th className="py-2.5 px-3">Actor</th>
                <th className="py-2.5 px-3">State Transition</th>
                <th className="py-2.5 pl-3">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 tabular-nums">
              {(overview?.audit_events || []).map((evt) => (
                <tr key={evt.event_id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 pr-3 font-mono text-slate-500 whitespace-nowrap">
                    {new Date(evt.event_timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {evt.action_type}
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                    {evt.actor_id} · {evt.actor_role}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                    {evt.previous_status || '—'} → {evt.new_status || '—'}
                  </td>
                  <td className="py-2.5 pl-3 font-mono text-slate-500">
                    {Object.entries(evt.metadata)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. Live Backend Security & Privacy Self-Test */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-blue-900 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Queue Rules &amp; Privacy Self-Test
              </h2>
              <p className="text-sm text-slate-600">
                Verifies zero-PII public display projection, role-based access protection, and
                input validation directly in the queue engine without modifying live tickets.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={runningChecks}
            onClick={() => void runLiveSecurityVerification()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 min-h-10 whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            <span>{runningChecks ? 'Running Checks...' : 'Run Security Checks'}</span>
          </button>
        </div>

        {checkResults && (
          <div className="pt-4 border-t border-slate-200 divide-y divide-slate-200">
            {checkResults.map((res, idx) => (
              <div key={idx} className="py-3 flex items-start justify-between gap-4 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{res.name}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{res.detail}</p>
                </div>
                <span
                  className={`text-xs font-bold whitespace-nowrap shrink-0 ${
                    res.passed ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {res.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmResetOpen}
        title="Close Current Session and Reset Queue Sequence?"
        description="This action finalizes the active queue session, preserves all existing tickets and audit logs in historical storage, and starts a new session beginning at Q-001."
        details={[
          `Active Session ID: ${staffState?.session.session_id || '—'}`,
          `Remaining Waiting Tickets: ${remainingWaiting}`,
          `Currently Serving Ticket: ${
            remainingServing > 0
              ? staffState?.currently_serving?.display_number || '1 active'
              : 'None'
          }`,
          `Served Today: ${staffState?.counts.served || 0} · Skipped: ${
            staffState?.counts.skipped || 0
          }`,
        ]}
        confirmLabel="Confirm Close & Reset to Q-001"
        tone="danger"
        loading={actionBusy}
        onConfirm={() => void handleConfirmSessionReset()}
        onCancel={() => setConfirmResetOpen(false)}
      />
    </div>
  );
}
