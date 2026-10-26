import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Maximize2, Minimize2, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { CATEGORY_LABELS, SessionStatus } from '../types/queue';
import type { PublicQueueState } from '../types/queue';
import type { RealtimeConnectionStatus } from '../lib/api';
import { playCivicTurnChime } from '../lib/sound';

interface PublicDisplayViewProps {
  publicState: PublicQueueState | null;
  connectionStatus: RealtimeConnectionStatus;
  fullscreenMode: boolean;
  onToggleFullscreenMode: () => void;
  onExitDisplay: () => void;
}

export function PublicDisplayView({
  publicState,
  connectionStatus,
  fullscreenMode,
  onToggleFullscreenMode,
  onExitDisplay,
}: PublicDisplayViewProps) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [highlightKey, setHighlightKey] = useState(0);
  const previousServingRef = useRef<string | null>(null);
  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const currentNumber = publicState?.now_serving?.display_number || null;

  useEffect(() => {
    if (currentNumber && currentNumber !== previousServingRef.current) {
      setHighlightKey((k) => k + 1);
      if (soundEnabled && previousServingRef.current !== null) {
        playCivicTurnChime();
      }
    }
    previousServingRef.current = currentNumber;
  }, [currentNumber, soundEnabled]);

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      playCivicTurnChime();
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-white flex flex-col justify-between p-6 sm:p-10 lg:p-12">
      {/* Top Display Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Panabo City Hall — Civil Registry Service Queue
          </h1>
          <p className="text-sm text-slate-400 mt-0.5 tracking-wide">
            Birth, Marriage, and Death Certificate Counter · Public Queue Monitor
          </p>
        </div>

        <div className="flex items-center gap-3">
          {connectionStatus !== 'connected' && (
            <div
              role="status"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950 border border-amber-700 text-amber-200 text-xs font-medium whitespace-nowrap shrink-0"
            >
              <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Connection interrupted — recovering live feed...</span>
            </div>
          )}

          <span className="text-lg font-mono font-semibold tabular-nums text-slate-300 px-2">
            {clockText}
          </span>

          <button
            type="button"
            onClick={handleToggleSound}
            aria-pressed={soundEnabled}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 transition-colors min-h-10 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {soundEnabled ? (
              <>
                <Volume2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                <span>Chime On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <span>Chime Muted</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onToggleFullscreenMode}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 transition-colors min-h-10 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {fullscreenMode ? (
              <>
                <Minimize2 className="w-4 h-4" aria-hidden="true" />
                <span>Show Nav</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4" aria-hidden="true" />
                <span>TV Mode</span>
              </>
            )}
          </button>

          {fullscreenMode && (
            <button
              type="button"
              onClick={onExitDisplay}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 transition-colors min-h-10 whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Exit</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split Monitor Grid */}
      <div className="my-auto py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
        {/* Dominant Focal Anchor: NOW SERVING */}
        <section
          aria-live="polite"
          aria-atomic="true"
          className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-8 sm:p-12 lg:p-16 flex flex-col justify-center items-center text-center"
        >
          <p className="text-base sm:text-xl font-semibold text-emerald-400 tracking-wide">
            Now Serving at Civil Registry Counter
          </p>

          <div key={highlightKey} className="my-6 animate-turn-highlight">
            <p className="text-7xl sm:text-8xl lg:text-[8.5rem] leading-none font-bold font-mono tabular-nums tracking-tight text-white">
              {publicState?.now_serving ? publicState.now_serving.display_number : '—'}
            </p>
          </div>

          <p className="text-xl sm:text-2xl font-medium text-slate-300 tracking-wide">
            {publicState?.now_serving
              ? CATEGORY_LABELS[publicState.now_serving.request_category]
              : 'Please wait for the next queue number to be called'}
          </p>
        </section>

        {/* Secondary Column: Upcoming Numbers & Total Waiting (Zero PII, Zero PWD status) */}
        <section
          aria-label="Upcoming queue numbers"
          className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-8 sm:p-10 flex flex-col justify-between"
        >
          <div>
            <div className="flex items-baseline justify-between gap-4 pb-5 border-b border-slate-800">
              <h2 className="text-lg sm:text-xl font-bold text-white">Upcoming in Queue</h2>
              <div className="text-right">
                <span className="text-xs text-slate-400 block">Total Waiting</span>
                <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-white">
                  {publicState ? publicState.total_waiting : 0}
                </span>
              </div>
            </div>

            {!publicState || publicState.upcoming.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-lg text-slate-400">No tickets currently waiting</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/90 mt-2">
                {publicState.upcoming.slice(0, 6).map((item, idx) => (
                  <li
                    key={`${item.display_number}-${idx}`}
                    className="py-3.5 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-mono tabular-nums text-slate-500 w-6">
                        #{idx + 1}
                      </span>
                      <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-100">
                        {item.display_number}
                      </span>
                    </div>
                    <span className="text-sm sm:text-base text-slate-400">
                      {CATEGORY_LABELS[item.request_category]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-slate-400">
            <span>
              Registration:{' '}
              <strong className="text-slate-200 font-semibold">
                {publicState?.session.status === SessionStatus.Open ? 'Open' : 'Closed'}
              </strong>
            </span>
            <span>Queue order reflects verified priority &amp; arrival sequence</span>
          </div>
        </section>
      </div>

      {/* Bottom Notice */}
      <div className="pt-4 border-t border-slate-900 flex flex-wrap items-center justify-between gap-4 text-xs sm:text-sm text-slate-400">
        <span>
          Privacy Notice: Citizen names and personal details are never shown on public displays.
        </span>
        <span>
          Prepare valid identification if requested at the counter when your number is called.
        </span>
      </div>
    </div>
  );
}
