import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
        <div className="flex items-start gap-3">
          {tone === 'danger' && (
            <div className="mt-0.5 text-red-700 shrink-0" aria-hidden="true">
              <AlertTriangle className="w-5 h-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-lg font-bold text-slate-900">
              {title}
            </h2>
            <p id="confirm-dialog-desc" className="mt-2 text-sm text-slate-600 leading-relaxed">
              {description}
            </p>
            {details && details.length > 0 && (
              <ul className="mt-3 pt-3 border-t border-slate-200 space-y-1.5 text-xs text-slate-700">
                {details.map((line, i) => (
                  <li key={i} className="tabular-nums">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 min-h-10 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 min-h-10 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 ${
              tone === 'danger'
                ? 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-700'
                : 'bg-blue-900 hover:bg-blue-950 focus-visible:outline-blue-900'
            }`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
