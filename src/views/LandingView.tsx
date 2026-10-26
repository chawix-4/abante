import { ArrowRight, QrCode, Monitor, ShieldCheck, Ticket } from 'lucide-react';
import { CATEGORY_LABELS, SessionStatus } from '../types/queue';
import type { PublicQueueState } from '../types/queue';
import type { AppRouteView } from '../components/Navbar';
import type { RealtimeConnectionStatus } from '../lib/api';

interface LandingViewProps {
  publicState: PublicQueueState | null;
  connectionStatus: RealtimeConnectionStatus;
  savedTicketCount: number;
  onNavigate: (view: AppRouteView) => void;
}

export function LandingView({
  publicState,
  connectionStatus,
  savedTicketCount,
  onNavigate,
}: LandingViewProps) {
  const isRegistrationOpen =
    !publicState || publicState.session.status === SessionStatus.Open;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 space-y-14">
      {/* Split Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-600">
              City Government of Panabo · Office of the City Civil Registrar
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 leading-tight max-w-2xl">
              Panabo City Hall Civil Registry Queue Management System
            </h1>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
              Join the in-person service queue for Birth, Marriage, and Death Certificate
              requests, receive a unique queue number, and monitor live counter progress from
              your phone or the lobby display.
            </p>
            <p className="text-sm text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 max-w-2xl leading-relaxed">
              <strong className="font-semibold text-slate-900">Important Scope Notice:</strong>{' '}
              This service is strictly for in-person queue registration at Panabo City Hall. It
              does not submit an online certificate application, verify identity documents, or
              provide online certificate delivery.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('register')}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 transition-colors min-h-12 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
            >
              <span>Join the Queue</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>

            {savedTicketCount > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('ticket')}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 text-base font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-12 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
              >
                <Ticket className="w-4 h-4 text-slate-600" aria-hidden="true" />
                <span>Check My Ticket ({savedTicketCount})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onNavigate('qr')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 text-base font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-12 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
            >
              <QrCode className="w-4 h-4 text-slate-600" aria-hidden="true" />
              <span>Scan / Print QR</span>
            </button>
          </div>
        </div>

        {/* Live Lobby Queue Summary Surface (Single-Elevation, Zero PII) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <span className="text-sm font-semibold text-slate-900">
                Live Civil Registry Queue
              </span>
              <span className="text-xs text-slate-600 tabular-nums">
                {connectionStatus === 'connected'
                  ? 'Live updates active'
                  : 'Syncing queue state...'}
              </span>
            </div>

            <div className="py-8 text-center border-b border-slate-200">
              <p className="text-xs font-medium text-slate-500">Now Serving at Counter</p>
              <p className="mt-2 text-5xl sm:text-6xl font-bold font-mono tabular-nums tracking-tight text-slate-900">
                {publicState?.now_serving ? publicState.now_serving.display_number : '—'}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {publicState?.now_serving
                  ? CATEGORY_LABELS[publicState.now_serving.request_category]
                  : 'Waiting for staff to call next ticket'}
              </p>
            </div>

            <div className="pt-5 grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-slate-500">Waiting in Queue</p>
                <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                  {publicState ? publicState.total_waiting : '0'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Registration Status</p>
                <p
                  className={`mt-1 text-base font-semibold ${
                    isRegistrationOpen ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {isRegistrationOpen ? 'Open for Registration' : 'Registration Closed'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500 tabular-nums">
              Session Date: {publicState?.session.date || 'Today'}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('display')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-900 hover:underline whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900 rounded"
            >
              <Monitor className="w-4 h-4" aria-hidden="true" />
              <span>Open Lobby TV Display</span>
            </button>
          </div>
        </div>
      </section>

      {/* Unified Queue & Accessibility Information */}
      <section className="border-t border-slate-200 pt-12">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-slate-900">
            How the Civil Registry Queue Works
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600">
            All three certificate request types share one unified sequence so turns remain clear,
            fair, and verifiable for everyone in the waiting area.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-2">
            <h3 className="text-base font-bold text-slate-900">
              01. Register Once via Phone or Desk
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Enter your display name and choose Birth Certificate, Marriage Certificate, or Death
              Certificate. Citizens without a smartphone may ask counter staff for walk-in
              registration.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-bold text-slate-900">
              02. One Unified Queue Sequence
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              A unique queue number (such as <span className="font-mono">Q-001</span>) is assigned
              atomically in sequence. Request categories help staff prepare forms without splitting
              citizens into confusing separate lines.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-bold text-slate-900">
              03. Privacy & PWD Priority Policy
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Public monitors display queue numbers only—never personal names or disability
              status. Optional PWD priority requests are verified in person by authorized staff
              according to office-approved rules.
            </p>
          </div>
        </div>
      </section>

      {/* Minimal Privacy & Prototype Disclosure */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-start gap-3 max-w-3xl">
          <ShieldCheck className="w-5 h-5 text-blue-900 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-900">
              Minimum Data Collection & Public Service Accountability
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              This educational queue-management prototype never asks for dates of birth,
              government identification numbers, medical diagnoses, document scans, or details of
              individuals named on civil registry records.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('staff')}
          className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
        >
          Authorized Staff Sign-In
        </button>
      </section>
    </div>
  );
}
