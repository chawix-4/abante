import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  LogOut,
  PhoneForwarded,
  Search,
  SkipForward,
  UserPlus,
  X,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  PriorityPolicyMode,
  PriorityVerificationStatus,
  RegistrationSource,
  RequestCategory,
  SessionStatus,
  STATUS_LABELS,
  TicketStatus,
  UserRole,
} from '../types/queue';
import type {
  AuthenticatedStaffUser,
  PublicQueueState,
  QueueTicket,
  StaffQueueState,
} from '../types/queue';
import {
  ApiRequestError,
  createIdempotencyKey,
  queueApi,
  useRealtimeSubscription,
} from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StaffLoginCard } from '../components/StaffLoginCard';
import { AdminPanel } from '../components/AdminPanel';

interface StaffPortalViewProps {
  authToken: string | null;
  staffUser: AuthenticatedStaffUser | null;
  onLoginSuccess: (token: string, user: AuthenticatedStaffUser) => void;
  onLogout: () => void;
  onPublicStateUpdate: (state: PublicQueueState) => void;
}

type QueueStatusFilter = 'waiting' | 'completed' | 'all';
type PriorityFilter = 'all' | 'pwd_pending' | 'pwd_verified';

export function StaffPortalView({
  authToken,
  staffUser,
  onLoginSuccess,
  onLogout,
  onPublicStateUpdate,
}: StaffPortalViewProps) {
  const [activeTab, setActiveTab] = useState<'operations' | 'admin'>('operations');
  const [staffState, setStaffState] = useState<StaffQueueState | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Walk-in registration drawer state
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInCategory, setWalkInCategory] = useState<RequestCategory>(RequestCategory.Birth);
  const [walkInPwdRequested, setWalkInPwdRequested] = useState(false);
  const [walkInVerifyNow, setWalkInVerifyNow] = useState(false);
  const [walkInIdemKey, setWalkInIdemKey] = useState(() => createIdempotencyKey('walkin'));

  // Search & Non-Mutating View Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>('waiting');
  const [categoryFilter, setCategoryFilter] = useState<RequestCategory | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');

  // Consequential Action Confirmation Dialog
  const [pendingTransition, setPendingTransition] = useState<{
    ticket: QueueTicket;
    targetStatus: TicketStatus.Served | TicketStatus.Skipped;
  } | null>(null);

  const loadStaffState = useCallback(async () => {
    if (!authToken) return;
    setLoadingInitial(true);
    setErrorMessage(null);
    try {
      const state = await queueApi.getStaffState(authToken);
      setStaffState(state);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        onLogout();
        return;
      }
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Unable to load queue dashboard.'
      );
    } finally {
      setLoadingInitial(false);
    }
  }, [authToken, onLogout]);

  useEffect(() => {
    if (authToken && staffUser) {
      void loadStaffState();
    } else {
      setStaffState(null);
      setActiveTab('operations');
    }
  }, [authToken, staffUser, loadStaffState]);

  const wsStatus = useRealtimeSubscription({
    channel: authToken && staffUser ? 'staff' : 'public',
    authToken,
    onStaffState: (next) => {
      setStaffState(next);
    },
    onPublicState: onPublicStateUpdate,
    onAuthExpired: () => {
      onLogout();
    },
  });

  const handleSignOut = async () => {
    if (authToken) {
      try {
        await queueApi.logoutStaff(authToken);
      } catch {
        // Proceed with local sign-out regardless
      }
    }
    onLogout();
  };

  const handleCallNext = async () => {
    if (!authToken || busyAction) return;
    setBusyAction('call_next');
    setErrorMessage(null);
    try {
      const updated = await queueApi.callNextTicket(
        authToken,
        createIdempotencyKey('call_next')
      );
      setStaffState(updated);
    } catch (err) {
      setErrorMessage(err instanceof ApiRequestError ? err.message : 'Could not call next ticket.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmTicketTransition = async () => {
    if (!authToken || !pendingTransition || busyAction) return;
    setBusyAction(`transition_${pendingTransition.ticket.ticket_id}`);
    setErrorMessage(null);
    try {
      const updated = await queueApi.updateTicketStatus(
        authToken,
        pendingTransition.ticket.ticket_id,
        pendingTransition.targetStatus,
        createIdempotencyKey('status_change')
      );
      setStaffState(updated);
      setPendingTransition(null);
    } catch (err) {
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Status update failed.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handlePriorityDecision = async (
    ticketId: string,
    decision: 'verify' | 'decline'
  ) => {
    if (!authToken || busyAction) return;
    setBusyAction(`prio_${ticketId}`);
    setErrorMessage(null);
    try {
      const updated = await queueApi.decideTicketPriority(
        authToken,
        ticketId,
        decision,
        createIdempotencyKey('prio')
      );
      setStaffState(updated);
    } catch (err) {
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Priority verification update failed.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleRegistration = async () => {
    if (!authToken || !staffState || busyAction) return;
    const isCurrentlyOpen = staffState.session.status === SessionStatus.Open;
    setBusyAction('toggle_reg');
    setErrorMessage(null);
    try {
      const updated = await queueApi.setRegistrationOpen(authToken, !isCurrentlyOpen);
      setStaffState(updated);
    } catch (err) {
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Failed to update registration status.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleWalkInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!authToken || busyAction) return;

    const trimmed = walkInName.replace(/\s+/g, ' ').trim();
    if (trimmed.length < 2) {
      setErrorMessage('Walk-in citizen display name must be at least 2 characters.');
      return;
    }

    setBusyAction('walkin');
    setErrorMessage(null);
    try {
      await queueApi.registerWalkIn(
        authToken,
        {
          display_name: trimmed,
          request_category: walkInCategory,
          priority_requested: walkInPwdRequested,
          verify_immediately: walkInPwdRequested && walkInVerifyNow,
        },
        walkInIdemKey
      );
      setWalkInName('');
      setWalkInPwdRequested(false);
      setWalkInVerifyNow(false);
      setWalkInIdemKey(createIdempotencyKey('walkin'));
      setWalkInOpen(false);
      await loadStaffState();
    } catch (err) {
      setErrorMessage(
        err instanceof ApiRequestError ? err.message : 'Walk-in registration failed.'
      );
      if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
        setWalkInIdemKey(createIdempotencyKey('walkin'));
      }
    } finally {
      setBusyAction(null);
    }
  };

  const filteredTickets = useMemo(() => {
    if (!staffState) return [];
    const q = searchQuery.trim().toLowerCase();

    return staffState.tickets.filter((t) => {
      if (statusFilter === 'waiting' && t.status !== TicketStatus.Waiting) {
        return false;
      }
      if (
        statusFilter === 'completed' &&
        t.status !== TicketStatus.Served &&
        t.status !== TicketStatus.Skipped
      ) {
        return false;
      }
      if (categoryFilter !== 'all' && t.request_category !== categoryFilter) {
        return false;
      }
      if (
        priorityFilter === 'pwd_pending' &&
        t.priority_status !== PriorityVerificationStatus.Pending
      ) {
        return false;
      }
      if (priorityFilter === 'pwd_verified' && !t.priority_verified) {
        return false;
      }
      if (q) {
        const matchNumber = t.display_number.toLowerCase().includes(q);
        const matchName = t.display_name.toLowerCase().includes(q);
        if (!matchNumber && !matchName) return false;
      }
      return true;
    });
  }, [staffState, searchQuery, statusFilter, categoryFilter, priorityFilter]);

  if (!authToken || !staffUser) {
    return <StaffLoginCard onLoginSuccess={onLoginSuccess} />;
  }

  const servingTicket = staffState?.currently_serving || null;
  const nextEligible = staffState?.next_eligible_ticket || null;
  const isRegOpen = staffState?.session.status === SessionStatus.Open;

  const formatSourceLabel = (src: RegistrationSource) => {
    switch (src) {
      case RegistrationSource.CitizenQR:
        return 'QR Scan';
      case RegistrationSource.StaffWalkIn:
        return 'Staff Walk-In';
      case RegistrationSource.DemoSeed:
        return 'Demo Data';
      case RegistrationSource.CitizenWeb:
      default:
        return 'Web Form';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Staff Workspace Top Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">{staffUser.display_name}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">Role: {staffUser.role}</span>
            <span aria-hidden="true">·</span>
            <span>
              {wsStatus === 'connected' ? 'Live sync connected' : 'Reconnecting live sync...'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
            Civil Registry Counter Console
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {staffUser.role === UserRole.Admin && (
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab('operations')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-9 ${
                  activeTab === 'operations'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Queue Operations
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('admin')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 min-h-9 ${
                  activeTab === 'admin'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Admin &amp; Audit
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-10 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 text-sm"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss error"
            className="p-1 text-red-700 hover:bg-red-100 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeTab === 'admin' && staffUser.role === UserRole.Admin ? (
        <AdminPanel
          authToken={authToken}
          currentUser={staffUser}
          staffState={staffState}
          onStaffStateUpdated={setStaffState}
        />
      ) : (
        <div className="space-y-8">
          {/* Session Status Strip & KPI Counts */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-600 tabular-nums">
                <span>
                  Session:{' '}
                  <strong className="font-mono text-slate-900">
                    {staffState?.session.session_id || 'Loading...'}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>Date: {staffState?.session.date || '—'}</span>
                <span aria-hidden="true">·</span>
                <span>
                  PWD Rule:{' '}
                  <strong className="text-slate-900">
                    {staffState?.session.priority_policy ===
                    PriorityPolicyMode.IncludeSelfDeclared
                      ? 'Self-Declared + Verified'
                      : 'Staff-Verified Only'}
                  </strong>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={!staffState || busyAction === 'toggle_reg'}
                  onClick={() => void handleToggleRegistration()}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors min-h-9 whitespace-nowrap shrink-0"
                >
                  {isRegOpen ? 'Close Public Registration' : 'Reopen Public Registration'}
                </button>

                <button
                  type="button"
                  onClick={() => setWalkInOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors min-h-9 whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{walkInOpen ? 'Hide Walk-In Form' : 'Register Walk-In Citizen'}</span>
                </button>
              </div>
            </div>

            {/* 4-Column Tabular Counts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <p className="text-xs font-medium text-slate-500">Waiting in Line</p>
                <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-slate-900">
                  {staffState ? staffState.counts.waiting : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Currently Serving</p>
                <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-emerald-700">
                  {staffState ? staffState.counts.serving : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Served (Completed)</p>
                <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-slate-900">
                  {staffState ? staffState.counts.served : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Skipped</p>
                <p className="mt-1 text-3xl font-bold font-mono tabular-nums text-amber-700">
                  {staffState ? staffState.counts.skipped : '—'}
                </p>
              </div>
            </div>
          </section>

          {/* Staff-Assisted Walk-In Registration Form */}
          {walkInOpen && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Staff-Assisted Walk-In Registration
                  </h2>
                  <p className="text-xs text-slate-600">
                    For citizens without a smartphone or needing assistance at the desk. Shares
                    the same unified queue sequence.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWalkInOpen(false)}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Close
                </button>
              </div>

              <form
                onSubmit={handleWalkInSubmit}
                className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end pt-2 border-t border-slate-200"
              >
                <div className="md:col-span-4 space-y-1">
                  <label
                    htmlFor="walkin-name"
                    className="block text-xs font-semibold text-slate-800"
                  >
                    Citizen Display Name *
                  </label>
                  <input
                    id="walkin-name"
                    type="text"
                    required
                    maxLength={60}
                    placeholder="e.g., Pedro Penduko"
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg min-h-10"
                  />
                </div>

                <div className="md:col-span-3 space-y-1">
                  <label
                    htmlFor="walkin-category"
                    className="block text-xs font-semibold text-slate-800"
                  >
                    Certificate Category *
                  </label>
                  <select
                    id="walkin-category"
                    value={walkInCategory}
                    onChange={(e) => setWalkInCategory(e.target.value as RequestCategory)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg min-h-10"
                  >
                    <option value={RequestCategory.Birth}>Birth Certificate</option>
                    <option value={RequestCategory.Marriage}>Marriage Certificate</option>
                    <option value={RequestCategory.Death}>Death Certificate</option>
                  </select>
                </div>

                <div className="md:col-span-3 space-y-1.5 pb-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={walkInPwdRequested}
                      onChange={(e) => {
                        setWalkInPwdRequested(e.target.checked);
                        if (!e.target.checked) setWalkInVerifyNow(false);
                      }}
                      className="w-4 h-4 rounded border-slate-400 text-blue-900"
                    />
                    <span>PWD Priority Requested</span>
                  </label>
                  {walkInPwdRequested && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-emerald-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={walkInVerifyNow}
                        onChange={(e) => setWalkInVerifyNow(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-400 text-emerald-700"
                      />
                      <span>Verified in person now</span>
                    </label>
                  )}
                </div>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={busyAction === 'walkin'}
                    className="w-full px-4 py-2 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 disabled:opacity-50 min-h-10 whitespace-nowrap shrink-0"
                  >
                    {busyAction === 'walkin' ? 'Issuing...' : 'Issue Ticket'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* Active Serving Counter & Call Next Control */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
            {loadingInitial && !staffState ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                Loading counter state...
              </p>
            ) : servingTicket ? (
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-800">
                    <span>Currently Serving at Counter</span>
                    {servingTicket.priority_verified && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>PWD Priority Verified</span>
                      </>
                    )}
                    {servingTicket.is_demo && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-700">Development Demo Record</span>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-baseline gap-4">
                    <span className="text-5xl sm:text-6xl font-bold font-mono tabular-nums text-slate-900">
                      {servingTicket.display_number}
                    </span>
                    <div>
                      <p className="text-xl font-bold text-slate-900">
                        {servingTicket.display_name}
                      </p>
                      <p className="text-sm text-slate-600">
                        {CATEGORY_LABELS[servingTicket.request_category]} · Called{' '}
                        {servingTicket.called_at
                          ? new Date(servingTicket.called_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'just now'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      setPendingTransition({
                        ticket: servingTicket,
                        targetStatus: TicketStatus.Served,
                      })
                    }
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors min-h-11 whitespace-nowrap shrink-0"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>Mark Served</span>
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      setPendingTransition({
                        ticket: servingTicket,
                        targetStatus: TicketStatus.Skipped,
                      })
                    }
                    className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 disabled:opacity-50 transition-colors min-h-11 whitespace-nowrap shrink-0"
                  >
                    <SkipForward className="w-4 h-4" aria-hidden="true" />
                    <span>Skip Ticket</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-1.5">
                  <h2 className="text-lg font-bold text-slate-900">
                    Counter Idle — No Ticket Currently Serving
                  </h2>
                  {nextEligible ? (
                    <p className="text-sm text-slate-600">
                      Next eligible ticket in authoritative order:{' '}
                      <strong className="font-mono font-bold text-slate-900">
                        {nextEligible.display_number}
                      </strong>{' '}
                      ({CATEGORY_LABELS[nextEligible.request_category]}
                      {nextEligible.priority_verified ? ' · PWD Priority Verified' : ''}). Calling
                      next moves this ticket immediately to Serving.
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">
                      The waiting list is currently empty. New citizen registrations will appear
                      automatically in real time.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!nextEligible || busyAction === 'call_next'}
                  onClick={() => void handleCallNext()}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 disabled:opacity-40 transition-colors min-h-12 whitespace-nowrap shrink-0"
                >
                  <PhoneForwarded className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {busyAction === 'call_next'
                      ? 'Calling...'
                      : nextEligible
                        ? `Call Next (${nextEligible.display_number})`
                        : 'No Waiting Tickets'}
                  </span>
                </button>
              </div>
            )}
          </section>

          {/* Waiting List & Session Queue Table */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Session Queue List</h2>
                <p className="text-xs text-slate-500">
                  Category, priority, and search filters refine this table view only and never
                  alter actual queue dispatch order.
                </p>
              </div>

              {/* Search Input */}
              <div className="relative w-full lg:w-72">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  aria-label="Search by queue number or citizen name"
                  placeholder="Search Q-001 or citizen name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 min-h-10"
                />
              </div>
            </div>

            {/* Interactive Segmented Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <div
                role="group"
                aria-label="Filter by status"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                {(
                  [
                    { id: 'waiting', label: `Waiting (${staffState?.counts.waiting || 0})` },
                    {
                      id: 'completed',
                      label: `Served / Skipped (${
                        (staffState?.counts.served || 0) + (staffState?.counts.skipped || 0)
                      })`,
                    },
                    { id: 'all', label: `All (${staffState?.counts.total || 0})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === tab.id
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div
                role="group"
                aria-label="Filter by category"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                {(
                  [
                    { id: 'all', label: 'All Categories' },
                    { id: RequestCategory.Birth, label: 'Birth' },
                    { id: RequestCategory.Marriage, label: 'Marriage' },
                    { id: RequestCategory.Death, label: 'Death' },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      categoryFilter === cat.id
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              <div
                role="group"
                aria-label="Filter by PWD priority"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                {(
                  [
                    { id: 'all', label: 'All Priority' },
                    { id: 'pwd_pending', label: 'PWD Pending Review' },
                    { id: 'pwd_verified', label: 'PWD Verified' },
                  ] as const
                ).map((pf) => (
                  <button
                    key={pf.id}
                    type="button"
                    onClick={() => setPriorityFilter(pf.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      priorityFilter === pf.id
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {pf.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Queue Data Table */}
            {filteredTickets.length === 0 ? (
              <div className="py-12 text-center border-t border-slate-200 space-y-2">
                <p className="text-sm font-medium text-slate-700">
                  No tickets match the current view filter.
                </p>
                <p className="text-xs text-slate-500">
                  Adjust the status or category filter above, or register a walk-in citizen.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-slate-200">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                      <th className="py-3 pr-3">Order</th>
                      <th className="py-3 px-3">Ticket</th>
                      <th className="py-3 px-3">Citizen Name (Staff Only)</th>
                      <th className="py-3 px-3">Category</th>
                      <th className="py-3 px-3">Registered</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">PWD Priority</th>
                      <th className="py-3 pl-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredTickets.map((ticket) => {
                      const isTerminal =
                        ticket.status === TicketStatus.Served ||
                        ticket.status === TicketStatus.Skipped;

                      return (
                        <tr key={ticket.ticket_id} className="hover:bg-slate-50/80">
                          <td className="py-3 pr-3 font-mono text-xs tabular-nums text-slate-500">
                            {ticket.queue_position !== null ? `#${ticket.queue_position}` : '—'}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                            {ticket.display_number}
                          </td>
                          <td className="py-3 px-3 font-medium text-slate-900">
                            <span>{ticket.display_name}</span>
                            {ticket.is_demo && (
                              <span className="ml-2 text-xs font-normal text-amber-700">
                                · Demo
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                            {CATEGORY_LABELS[ticket.request_category]}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                            {new Date(ticket.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            · {formatSourceLabel(ticket.registration_source)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`text-xs font-semibold ${
                                ticket.status === TicketStatus.Serving
                                  ? 'text-emerald-700'
                                  : ticket.status === TicketStatus.Skipped
                                    ? 'text-amber-700'
                                    : ticket.status === TicketStatus.Served
                                      ? 'text-slate-500'
                                      : 'text-slate-900'
                              }`}
                            >
                              {STATUS_LABELS[ticket.status]}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-700">
                            {ticket.priority_verified ? (
                              <div>
                                <span className="font-semibold text-emerald-800">
                                  PWD Verified
                                </span>
                                {ticket.priority_updated_by && (
                                  <span className="block text-[11px] text-slate-500">
                                    by {ticket.priority_updated_by}
                                  </span>
                                )}
                              </div>
                            ) : ticket.priority_status === PriorityVerificationStatus.Pending ? (
                              <span className="font-semibold text-amber-800">
                                Requested · Unverified
                              </span>
                            ) : ticket.priority_status === PriorityVerificationStatus.Declined ? (
                              <div>
                                <span className="text-slate-500">Declined</span>
                                {ticket.priority_updated_by && (
                                  <span className="block text-[11px] text-slate-400">
                                    by {ticket.priority_updated_by}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">Standard</span>
                            )}
                          </td>
                          <td className="py-3 pl-3 text-right whitespace-nowrap">
                            {isTerminal ? (
                              <span className="text-xs text-slate-400">Finalized</span>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                {(ticket.priority_requested ||
                                  ticket.priority_status !==
                                    PriorityVerificationStatus.None) &&
                                  !ticket.priority_verified && (
                                    <button
                                      type="button"
                                      disabled={Boolean(busyAction)}
                                      onClick={() =>
                                        void handlePriorityDecision(ticket.ticket_id, 'verify')
                                      }
                                      className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                                    >
                                      Verify PWD
                                    </button>
                                  )}

                                {ticket.priority_status ===
                                  PriorityVerificationStatus.Pending && (
                                  <button
                                    type="button"
                                    disabled={Boolean(busyAction)}
                                    onClick={() =>
                                      void handlePriorityDecision(ticket.ticket_id, 'decline')
                                    }
                                    className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    Decline
                                  </button>
                                )}

                                {ticket.priority_verified && (
                                  <button
                                    type="button"
                                    disabled={Boolean(busyAction)}
                                    onClick={() =>
                                      void handlePriorityDecision(ticket.ticket_id, 'decline')
                                    }
                                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    Revoke PWD
                                  </button>
                                )}

                                {ticket.status === TicketStatus.Waiting && (
                                  <button
                                    type="button"
                                    disabled={Boolean(busyAction)}
                                    onClick={() =>
                                      setPendingTransition({
                                        ticket,
                                        targetStatus: TicketStatus.Skipped,
                                      })
                                    }
                                    className="px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                                  >
                                    Skip
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Confirmation Dialog for Mark Served / Skip */}
      <ConfirmDialog
        open={pendingTransition !== null}
        title={
          pendingTransition?.targetStatus === TicketStatus.Served
            ? `Mark Ticket ${pendingTransition.ticket.display_number} as Served?`
            : `Skip Ticket ${pendingTransition?.ticket.display_number || ''}?`
        }
        description={
          pendingTransition?.targetStatus === TicketStatus.Served
            ? 'Once marked Served, this ticket is permanently completed and cannot be called again.'
            : 'Skipped tickets remain in the session audit log and cannot be called again through Call Next.'
        }
        details={
          pendingTransition
            ? [
                `Ticket Number: ${pendingTransition.ticket.display_number}`,
                `Citizen: ${pendingTransition.ticket.display_name}`,
                `Category: ${CATEGORY_LABELS[pendingTransition.ticket.request_category]}`,
              ]
            : undefined
        }
        confirmLabel={
          pendingTransition?.targetStatus === TicketStatus.Served
            ? 'Confirm Mark Served'
            : 'Confirm Skip Ticket'
        }
        tone={pendingTransition?.targetStatus === TicketStatus.Skipped ? 'danger' : 'primary'}
        loading={Boolean(busyAction)}
        onConfirm={() => void handleConfirmTicketTransition()}
        onCancel={() => setPendingTransition(null)}
      />
    </div>
  );
}
