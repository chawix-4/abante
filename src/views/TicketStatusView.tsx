import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Monitor,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  PriorityVerificationStatus,
  STATUS_LABELS,
  TicketStatus,
} from '../types/queue';
import type {
  CitizenTicketReceipt,
  CitizenTicketStatusPayload,
  PublicQueueState,
} from '../types/queue';
import { ApiRequestError, queueApi, useRealtimeSubscription } from '../lib/api';

interface TicketStatusViewProps {
  receipts: CitizenTicketReceipt[];
  activeTicketId: string | null;
  onSelectTicket: (ticketId: string) => void;
  onRemoveReceipt: (ticketId: string) => void;
  onRegisterNew: () => void;
  onOpenPublicDisplay: () => void;
  onPublicStateUpdate: (state: PublicQueueState) => void;
}

export function TicketStatusView({
  receipts,
  activeTicketId,
  onSelectTicket,
  onRemoveReceipt,
  onRegisterNew,
  onOpenPublicDisplay,
  onPublicStateUpdate,
}: TicketStatusViewProps) {
  const selectedReceipt =
    receipts.find((r) => r.ticket_id === activeTicketId) || receipts[0] || null;

  const [ticketData, setTicketData] = useState<CitizenTicketStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchTicketStatus = useCallback(async () => {
    if (!selectedReceipt) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const payload = await queueApi.getCitizenTicketStatus(
        selectedReceipt.ticket_id,
        selectedReceipt.citizen_token
      );
      setTicketData(payload);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Unable to load your ticket status right now.');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedReceipt]);

  useEffect(() => {
    void fetchTicketStatus();
  }, [fetchTicketStatus]);

  const connectionStatus = useRealtimeSubscription({
    channel: selectedReceipt ? 'ticket' : 'public',
    ticketId: selectedReceipt?.ticket_id || null,
    citizenToken: selectedReceipt?.citizen_token || null,
    onTicketState: (updated) => {
      setTicketData(updated);
      setErrorMessage(null);
    },
    onPublicState: onPublicStateUpdate,
  });

  if (!selectedReceipt) {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold text-slate-900">No Active Ticket on This Device</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            You have not registered a queue ticket on this browser yet, or your previous receipt
            was cleared.
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRegisterNew}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 transition-colors min-h-11 whitespace-nowrap shrink-0"
            >
              Join the Queue
            </button>
            <button
              type="button"
              onClick={onOpenPublicDisplay}
              className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-11 whitespace-nowrap shrink-0"
            >
              View Public Display
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderStatusGuidance = (ticket: CitizenTicketStatusPayload) => {
    if (!ticket.is_active_session) {
      return {
        heading: 'Previous Queue Session Closed',
        detail:
          'This ticket belongs to an earlier session that has already been closed by the Civil Registry Office.',
        toneClass: 'text-slate-700 bg-slate-100 border-slate-200',
      };
    }

    switch (ticket.status) {
      case TicketStatus.Serving:
        return {
          heading: 'Now Serving — Please Proceed to the Civil Registry Counter',
          detail:
            'Your queue number has been called. Present any required supporting documents directly to the counter officer.',
          toneClass: 'text-emerald-900 bg-emerald-50 border-emerald-200',
        };
      case TicketStatus.Served:
        return {
          heading: 'Service Completed',
          detail:
            'This queue ticket has been marked Served and is complete. Thank you for visiting Panabo City Hall.',
          toneClass: 'text-slate-800 bg-slate-100 border-slate-200',
        };
      case TicketStatus.Skipped:
        return {
          heading: 'Ticket Marked Skipped',
          detail:
            'Your number was called while you were unavailable. Skipped tickets are not called again automatically—please speak with staff at the assistance desk or register a new ticket if registration is open.',
          toneClass: 'text-amber-900 bg-amber-50 border-amber-200',
        };
      case TicketStatus.Waiting:
      default:
        return {
          heading: 'Waiting in Queue — Watch the Public Display',
          detail:
            'Stay within the Civil Registry waiting area and watch the public television display for your queue number. Exact waiting times vary by transaction complexity and are not guaranteed.',
          toneClass: 'text-blue-950 bg-blue-50/70 border-blue-200',
        };
    }
  };

  const guidance = ticketData ? renderStatusGuidance(ticketData) : null;

  const renderPrioritySummary = (ticket: CitizenTicketStatusPayload) => {
    if (!ticket.priority_requested && !ticket.priority_verified) {
      return 'Standard Queue Order';
    }
    if (ticket.priority_status === PriorityVerificationStatus.Verified || ticket.priority_verified) {
      return 'PWD Priority Verified by Staff';
    }
    if (ticket.priority_status === PriorityVerificationStatus.Declined) {
      return 'Standard Queue Order (Priority Not Approved)';
    }
    return 'PWD Priority Requested · Pending In-Person Staff Verification';
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
      {/* Multi-ticket selector if family/companion registered more than one ticket */}
      {receipts.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-xs font-medium text-slate-500 whitespace-nowrap shrink-0">
            Saved Tickets:
          </span>
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {receipts.map((rec) => {
              const active = rec.ticket_id === selectedReceipt.ticket_id;
              return (
                <button
                  key={rec.ticket_id}
                  type="button"
                  onClick={() => onSelectTicket(rec.ticket_id)}
                  className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {rec.display_number}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Panabo City Hall · Civil Registry Ticket Confirmation
            </p>
            <h1 className="text-lg font-bold text-slate-900 mt-0.5">Your Queue Ticket</h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>
              {connectionStatus === 'connected' ? 'Live status synced' : 'Reconnecting...'}
            </span>
            <button
              type="button"
              onClick={() => void fetchTicketStatus()}
              aria-label="Refresh ticket status"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg min-w-9 min-h-9 inline-flex items-center justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 text-sm"
          >
            <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-semibold">Status check failed</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => void fetchTicketStatus()}
              className="px-3 py-1.5 text-xs font-semibold bg-white border border-red-300 rounded-md hover:bg-red-100 whitespace-nowrap shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Prominent Ticket Number Display */}
        <div className="py-6 text-center border-b border-slate-200">
          <p className="text-xs font-medium text-slate-500">Assigned Queue Number</p>
          <p className="mt-2 text-6xl sm:text-7xl font-bold font-mono tabular-nums tracking-tight text-slate-900">
            {ticketData?.display_number || selectedReceipt.display_number}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-600">
            <span className="font-medium text-slate-900">
              {
                CATEGORY_LABELS[
                  ticketData?.request_category || selectedReceipt.request_category
                ]
              }
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-800">
              Status: {ticketData ? STATUS_LABELS[ticketData.status] : 'Loading...'}
            </span>
          </div>
        </div>

        {/* Status Banner */}
        {ticketData && guidance && (
          <div className={`p-4 rounded-lg border space-y-1.5 ${guidance.toneClass}`}>
            <div className="flex items-center gap-2">
              {ticketData.status === TicketStatus.Serving ? (
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              ) : (
                <Clock className="w-5 h-5 shrink-0" aria-hidden="true" />
              )}
              <p className="text-sm font-bold">{guidance.heading}</p>
            </div>
            <p className="text-xs sm:text-sm leading-relaxed">{guidance.detail}</p>
          </div>
        )}

        {/* Key Metadata Grid */}
        {ticketData && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div>
              <p className="text-xs text-slate-500">Currently Serving</p>
              <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
                {ticketData.now_serving_number || '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tickets Ahead of You</p>
              <p className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
                {ticketData.status === TicketStatus.Waiting && ticketData.ahead_count !== null
                  ? ticketData.ahead_count
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Priority Classification</p>
              <p className="mt-1 text-xs sm:text-sm font-medium text-slate-800 leading-snug">
                {renderPrioritySummary(ticketData)}
              </p>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenPublicDisplay}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              <Monitor className="w-4 h-4" aria-hidden="true" />
              <span>Open Public Display</span>
            </button>
            <button
              type="button"
              onClick={onRegisterNew}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Register Separate Request</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onRemoveReceipt(selectedReceipt.ticket_id)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-red-700 rounded-lg transition-colors min-h-10 whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Forget Receipt on Shared Device</span>
          </button>
        </div>
      </div>
    </div>
  );
}
