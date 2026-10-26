import { useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Check, Copy, ExternalLink, Printer } from 'lucide-react';
import type { AppRuntimeConfig } from '../types/queue';

interface QrPosterViewProps {
  runtimeConfig: AppRuntimeConfig | null;
  onOpenRegistrationPreview: () => void;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function QrPosterView({
  runtimeConfig,
  onOpenRegistrationPreview,
}: QrPosterViewProps) {
  const envPublicUrl = normalizeBaseUrl(
    (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || ''
  );
  const serverAppUrl = normalizeBaseUrl(runtimeConfig?.app_url || '');
  const browserOrigin =
    typeof window !== 'undefined' ? normalizeBaseUrl(window.location.origin) : '';

  const defaultBaseUrl = envPublicUrl || serverAppUrl || browserOrigin;
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const effectiveBaseUrl = normalizeBaseUrl(customBaseUrl) || defaultBaseUrl;

  const isLocalhostUrl = useMemo(() => {
    try {
      const parsed = new URL(effectiveBaseUrl);
      return (
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '0.0.0.0'
      );
    } catch {
      return true;
    }
  }, [effectiveBaseUrl]);

  const isValidHttpsOrOrigin = useMemo(() => {
    try {
      const parsed = new URL(effectiveBaseUrl);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }, [effectiveBaseUrl]);

  const registrationQrUrl = isValidHttpsOrOrigin
    ? `${effectiveBaseUrl}/?view=register&source=qr`
    : `${browserOrigin}/?view=register&source=qr`;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(registrationQrUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
      {/* Screen-only Configuration & Controls */}
      <div className="print:hidden space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">
              QR-Based Queue Joining · Lobby Poster Utility
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-0.5">
              Registration QR Code &amp; Print Poster
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenRegistrationPreview}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              <span>Test Form</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              <span>Print Lobby Poster</span>
            </button>
          </div>
        </div>

        {isLocalhostUrl && (
          <div
            role="status"
            className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-sm"
          >
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold">
                Localhost URL Detected — Do Not Print for Lobby Use Yet
              </p>
              <p className="text-xs sm:text-sm leading-relaxed">
                Phones scanning a <span className="font-mono">localhost</span> QR code will not
                reach your computer. Deploy the application over HTTPS first (where{' '}
                <span className="font-mono">APP_URL</span> or{' '}
                <span className="font-mono">VITE_PUBLIC_APP_URL</span> is automatically populated)
                or enter your verified deployed HTTPS domain below before printing.
              </p>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-8 space-y-1.5">
              <label
                htmlFor="qr-base-url-override"
                className="block text-sm font-semibold text-slate-900"
              >
                Deployed Base URL Configuration (HTTPS)
              </label>
              <input
                id="qr-base-url-override"
                type="url"
                placeholder={defaultBaseUrl || 'https://your-deployed-service.run.app'}
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                className="w-full px-3.5 py-2 text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900 min-h-10"
              />
              <p className="text-xs text-slate-500">
                Defaults automatically to <span className="font-mono">VITE_PUBLIC_APP_URL</span>{' '}
                or your browser&apos;s deployed origin. The QR code encodes only the public
                registration route—never personal data or private ticket tokens.
              </p>
            </div>
            <div className="md:col-span-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyUrl()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors min-h-10 whitespace-nowrap shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    <span>Copied Registration Link</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    <span>Copy Registration Link</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Printable Civic Lobby Poster */}
      <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 print:border-0 print:p-4 max-w-2xl mx-auto text-center space-y-8">
        <div className="space-y-2 pb-6 border-b border-slate-200">
          <p className="text-xs sm:text-sm font-semibold text-slate-600">
            Republic of the Philippines · City Government of Panabo
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
            Office of the City Civil Registrar
          </h2>
          <p className="text-base font-medium text-blue-900">
            Scan to Join the Service Queue
          </p>
        </div>

        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="p-5 bg-white border-2 border-slate-900 rounded-xl inline-block">
            <QRCodeSVG
              value={registrationQrUrl}
              size={240}
              level="M"
              marginSize={2}
              title="Panabo City Hall Civil Registry Queue Registration QR Code"
            />
          </div>
          <p className="text-xs font-mono text-slate-600 break-all max-w-md">
            {registrationQrUrl}
          </p>
        </div>

        <div className="text-left bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-2.5">
          <h3 className="text-sm font-bold text-slate-900">How to Get Your Queue Number:</h3>
          <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1.5">
            <li>Open your phone camera and scan the QR code above (no app download required).</li>
            <li>
              Enter your display name and select Birth, Marriage, or Death Certificate.
            </li>
            <li>
              Save your <span className="font-mono font-semibold">Q-XXX</span> number and watch
              the lobby television display.
            </li>
          </ol>
        </div>

        <div className="pt-4 border-t border-slate-200 text-xs text-slate-500 space-y-1 leading-relaxed">
          <p>
            Need assistance or do not have a smartphone? Please approach the Civil Registry
            assistance desk for staff-assisted walk-in registration.
          </p>
          <p>
            Notice: Queue registration assigns an in-person turn only and does not submit an
            online certificate application.
          </p>
        </div>
      </div>
    </div>
  );
}
