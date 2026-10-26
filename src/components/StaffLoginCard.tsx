import { useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, KeyRound, Lock } from 'lucide-react';
import type { AuthenticatedStaffUser } from '../types/queue';
import { ApiRequestError, queueApi } from '../lib/api';

interface StaffLoginCardProps {
  onLoginSuccess: (token: string, user: AuthenticatedStaffUser) => void;
}

const PROTOTYPE_ACCOUNTS = [
  {
    label: 'Counter Staff Officer',
    roleLabel: 'Staff Role (Queue & Walk-Ins)',
    email: 'staff.civilregistry@panabo.local',
    password: 'StaffQueue2026!',
  },
  {
    label: 'Civil Registry Supervisor',
    roleLabel: 'Administrator Role (Session Reset, Policy & Audit)',
    email: 'admin.civilregistry@panabo.local',
    password: 'AdminQueue2026!',
  },
];

export function StaffLoginCard({ onLoginSuccess }: StaffLoginCardProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (!email.trim() || !password) {
      setErrorMessage('Enter both your authorized staff email and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await queueApi.loginStaff(email.trim(), password);
      onLoginSuccess(response.token, response.user);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Unable to sign in right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const fillPrototypeAccount = (accEmail: string, accPassword: string) => {
    setEmail(accEmail);
    setPassword(accPassword);
    setErrorMessage(null);
  };

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Protected Civil Registry Workspace</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Authorized Staff Sign-In</h1>
          <p className="text-sm text-slate-600">
            Sign in with an authorized Staff or Administrator account to manage queue operations.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-900 text-sm"
          >
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="staff-email" className="block text-sm font-semibold text-slate-900">
              Staff Email
            </label>
            <input
              id="staff-email"
              type="email"
              required
              autoComplete="username"
              placeholder="name@panabo.local"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              disabled={loading}
              className="w-full px-3.5 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 min-h-11"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="staff-password"
              className="block text-sm font-semibold text-slate-900"
            >
              Password
            </label>
            <input
              id="staff-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              disabled={loading}
              className="w-full px-3.5 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 min-h-11"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 disabled:opacity-60 transition-colors min-h-11"
          >
            {loading ? 'Verifying Credentials...' : 'Sign In to Staff Console'}
          </button>
        </form>
      </div>

      {/* Explicitly Labeled Development / Prototype Credentials Helper */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <KeyRound className="w-4 h-4 text-slate-500" aria-hidden="true" />
          <span>Prototype Evaluation Accounts (Development Mode Only)</span>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Use these pre-seeded server-verified accounts to test role-based permissions between
          Counter Staff and Civil Registry Administrators:
        </p>
        <div className="divide-y divide-slate-200 border-t border-slate-200">
          {PROTOTYPE_ACCOUNTS.map((acc) => (
            <div
              key={acc.email}
              className="py-3 flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{acc.label}</p>
                <p className="text-slate-500">{acc.roleLabel}</p>
                <p className="font-mono text-slate-600 truncate mt-0.5">{acc.email}</p>
              </div>
              <button
                type="button"
                onClick={() => fillPrototypeAccount(acc.email, acc.password)}
                className="px-3 py-1.5 font-medium text-blue-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 min-h-9"
              >
                Use Account
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
