import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import {
  CATEGORY_LABELS,
  RegistrationSource,
  RequestCategory,
  SessionStatus,
} from '../types/queue';
import type { CitizenTicketReceipt, PublicQueueState } from '../types/queue';
import { ApiRequestError, createIdempotencyKey, queueApi } from '../lib/api';

interface CitizenRegisterViewProps {
  publicState: PublicQueueState | null;
  arrivedViaQr: boolean;
  onRegistered: (receipt: CitizenTicketReceipt) => void;
  onViewPublicDisplay: () => void;
}

export function CitizenRegisterView({
  publicState,
  arrivedViaQr,
  onRegistered,
  onViewPublicDisplay,
}: CitizenRegisterViewProps) {
  const [displayName, setDisplayName] = useState('');
  const [category, setCategory] = useState<RequestCategory | ''>('');
  const [priorityRequested, setPriorityRequested] = useState(false);

  // Stable idempotency key per submission attempt so network retries never create duplicate tickets
  const [attemptKey, setAttemptKey] = useState(() => createIdempotencyKey('cit_reg'));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isClosed =
    publicState !== null && publicState.session.status !== SessionStatus.Open;

  const handleFieldChange = () => {
    if (errorMessage) {
      setErrorMessage(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = displayName.replace(/\s+/g, ' ').trim();
    if (trimmedName.length < 2) {
      setErrorMessage('Please enter your display name (at least 2 characters).');
      return;
    }
    if (trimmedName.length > 60) {
      setErrorMessage('Display name must be 60 characters or fewer.');
      return;
    }
    if (!category) {
      setErrorMessage(
        'Please choose a request category: Birth Certificate, Marriage Certificate, or Death Certificate.'
      );
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const receipt = await queueApi.registerCitizenTicket(
        {
          display_name: trimmedName,
          request_category: category,
          priority_requested: priorityRequested,
          registration_source: arrivedViaQr
            ? RegistrationSource.CitizenQR
            : RegistrationSource.CitizenWeb,
        },
        attemptKey
      );
      // Prepare a fresh idempotency key in case another family member registers later
      setAttemptKey(createIdempotencyKey('cit_reg'));
      onRegistered(receipt);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrorMessage(err.message);
        // Generate a fresh key only if validation/closed rejected it; keep same key on network error for safe retry
        if (err.status >= 400 && err.status < 500) {
          setAttemptKey(createIdempotencyKey('cit_reg'));
        }
      } else {
        setErrorMessage('Could not complete queue registration. Please retry.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="space-y-2 mb-6">
        <p className="text-xs font-medium text-slate-500">
          Panabo City Hall · Civil Registry Service Queue
          {arrivedViaQr ? ' · QR Registration' : ''}
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Join the Civil Registry Queue
        </h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
          Register for an in-person queue number. Do not enter certificate details, dates of
          birth, or government ID numbers on this form.
        </p>
      </div>

      {isClosed ? (
        <div
          role="status"
          className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-4"
        >
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-slate-900">
                Online Queue Registration Is Currently Closed
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                The Civil Registry Office has closed public queue registration for the current
                session. Citizens already holding an active ticket will continue to be served
                according to the lobby display.
              </p>
              <p className="text-sm text-slate-600 leading-relaxed">
                If you require urgent assistance, please inquire directly with the Civil Registry
                information desk at Panabo City Hall.
              </p>
            </div>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={onViewPublicDisplay}
              className="px-4 py-2.5 text-sm font-semibold text-blue-900 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              View Public Queue Display
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6"
        >
          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-3 p-4 rounded-lg bg-red-50 border border-red-200 text-red-900 text-sm"
            >
              <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">Registration could not be completed</p>
                <p>{errorMessage}</p>
              </div>
            </div>
          )}

          {/* 1. Citizen Display Name */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor="citizen-display-name"
                className="block text-sm font-semibold text-slate-900"
              >
                Your Name <span className="text-red-700">*</span>
              </label>
              <span className="text-xs text-slate-500 tabular-nums">
                {displayName.trim().length}/60
              </span>
            </div>
            <input
              id="citizen-display-name"
              name="display_name"
              type="text"
              required
              maxLength={60}
              autoComplete="name"
              placeholder="e.g., Maria Santos"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                handleFieldChange();
              }}
              disabled={submitting}
              aria-describedby="citizen-name-help"
              className="w-full px-3.5 py-2.5 text-base text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 focus:border-blue-900 disabled:bg-slate-100 min-h-11"
            />
            <p id="citizen-name-help" className="text-xs text-slate-500">
              Visible only to authorized counter staff when calling your turn. Never shown on the
              public television screen.
            </p>
          </div>

          {/* 2. Request Category (Metadata within the single unified queue) */}
          <fieldset className="space-y-3 pt-2 border-t border-slate-200">
            <legend className="text-sm font-semibold text-slate-900 pt-2">
              Certificate Request Category <span className="text-red-700">*</span>
            </legend>
            <p className="text-xs text-slate-500">
              Select the type of civil registry record you are requesting. All categories share
              one unified queue sequence.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  RequestCategory.Birth,
                  RequestCategory.Marriage,
                  RequestCategory.Death,
                ] as const
              ).map((cat) => {
                const selected = category === cat;
                return (
                  <label
                    key={cat}
                    className={`relative flex items-center gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors min-h-12 ${
                      selected
                        ? 'border-blue-900 bg-blue-50/60 text-slate-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="request_category"
                      value={cat}
                      checked={selected}
                      disabled={submitting}
                      onChange={() => {
                        setCategory(cat);
                        handleFieldChange();
                      }}
                      className="w-4 h-4 text-blue-900 border-slate-400 focus:ring-blue-900 shrink-0"
                    />
                    <span className="text-sm font-medium">{CATEGORY_LABELS[cat]}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* 3. Optional PWD Priority Request */}
          <div className="pt-4 border-t border-slate-200 space-y-2">
            <label
              htmlFor="pwd-priority-checkbox"
              className="flex items-start gap-3 cursor-pointer select-none"
            >
              <input
                id="pwd-priority-checkbox"
                type="checkbox"
                checked={priorityRequested}
                disabled={submitting}
                onChange={(e) => setPriorityRequested(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-400 text-blue-900 focus:ring-blue-900 shrink-0"
              />
              <span className="space-y-1">
                <span className="block text-sm font-semibold text-slate-900">
                  Request Person with Disability (PWD) priority consideration (optional)
                </span>
                <span className="block text-xs text-slate-600 leading-relaxed">
                  Please check this box if you are a Person with Disability requesting priority
                  service. Do not submit medical details or upload ID cards online—authorized
                  counter staff verify priority eligibility in person in accordance with approved
                  Civil Registry Office policy.
                </span>
              </span>
            </label>
          </div>

          {/* Submit Action */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              <span>Duplicate-click protected · Instant ticket receipt</span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 text-base font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 disabled:opacity-60 transition-colors min-h-12 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
            >
              {submitting ? 'Assigning Queue Number...' : 'Get Queue Ticket'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
