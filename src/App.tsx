import { useCallback, useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import type { AppRouteView } from './components/Navbar';
import { LandingView } from './views/LandingView';
import { CitizenRegisterView } from './views/CitizenRegisterView';
import { TicketStatusView } from './views/TicketStatusView';
import { PublicDisplayView } from './views/PublicDisplayView';
import { QrPosterView } from './views/QrPosterView';
import { StaffPortalView } from './views/StaffPortalView';
import { queueApi, useRealtimeSubscription } from './lib/api';
import {
  getSavedCitizenReceipts,
  getStoredStaffToken,
  removeCitizenReceipt,
  saveCitizenReceipt,
  setStoredStaffToken,
} from './lib/storage';
import type {
  AppRuntimeConfig,
  AuthenticatedStaffUser,
  CitizenTicketReceipt,
  PublicQueueState,
} from './types/queue';

const VALID_VIEWS = new Set<AppRouteView>([
  'home',
  'register',
  'ticket',
  'display',
  'qr',
  'staff',
]);

function parseRouteFromWindow(): {
  view: AppRouteView;
  arrivedViaQr: boolean;
  fullscreen: boolean;
} {
  if (typeof window === 'undefined') {
    return { view: 'home', arrivedViaQr: false, fullscreen: false };
  }
  const params = new URLSearchParams(window.location.search);
  const rawView = (params.get('view') || '').toLowerCase() as AppRouteView;
  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();

  let view: AppRouteView = 'home';
  if (VALID_VIEWS.has(rawView)) {
    view = rawView;
  } else if (VALID_VIEWS.has(pathname as AppRouteView)) {
    view = pathname as AppRouteView;
  }

  return {
    view,
    arrivedViaQr: params.get('source') === 'qr',
    fullscreen: params.get('fullscreen') === '1',
  };
}

export default function App() {
  const initialRoute = parseRouteFromWindow();
  const [currentView, setCurrentView] = useState<AppRouteView>(initialRoute.view);
  const [arrivedViaQr, setArrivedViaQr] = useState<boolean>(initialRoute.arrivedViaQr);
  const [displayFullscreen, setDisplayFullscreen] = useState<boolean>(initialRoute.fullscreen);

  const [runtimeConfig, setRuntimeConfig] = useState<AppRuntimeConfig | null>(null);
  const [publicState, setPublicState] = useState<PublicQueueState | null>(null);

  const [receipts, setReceipts] = useState<CitizenTicketReceipt[]>(() =>
    getSavedCitizenReceipts()
  );
  const [activeTicketId, setActiveTicketId] = useState<string | null>(
    () => getSavedCitizenReceipts()[0]?.ticket_id || null
  );

  const [staffToken, setStaffToken] = useState<string | null>(() => getStoredStaffToken());
  const [staffUser, setStaffUser] = useState<AuthenticatedStaffUser | null>(null);

  const navigateTo = useCallback(
    (nextView: AppRouteView, options?: { fullscreen?: boolean }) => {
      setCurrentView(nextView);
      const nextFs = options?.fullscreen ?? false;
      setDisplayFullscreen(nextFs);
      if (nextView !== 'register') {
        setArrivedViaQr(false);
      }

      const url = new URL(window.location.href);
      url.pathname = '/';
      if (nextView === 'home') {
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('view', nextView);
      }
      url.searchParams.delete('source');
      if (nextFs && nextView === 'display') {
        url.searchParams.set('fullscreen', '1');
      } else {
        url.searchParams.delete('fullscreen');
      }
      window.history.pushState({}, '', url.toString());
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    []
  );

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseRouteFromWindow();
      setCurrentView(parsed.view);
      setArrivedViaQr(parsed.arrivedViaQr);
      setDisplayFullscreen(parsed.fullscreen);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Load initial public state and runtime config
  useEffect(() => {
    queueApi
      .getConfig()
      .then(setRuntimeConfig)
      .catch(() => undefined);

    queueApi
      .getPublicState()
      .then(setPublicState)
      .catch(() => undefined);
  }, []);

  // Verify stored staff session token on boot
  useEffect(() => {
    if (!staffToken) {
      setStaffUser(null);
      return;
    }
    queueApi
      .getMe(staffToken)
      .then((res) => {
        setStaffUser(res.user);
      })
      .catch(() => {
        setStoredStaffToken(null);
        setStaffToken(null);
        setStaffUser(null);
      });
  }, [staffToken]);

  const publicConnectionStatus = useRealtimeSubscription({
    channel: 'public',
    onPublicState: setPublicState,
  });

  const handleCitizenRegistered = (receipt: CitizenTicketReceipt) => {
    const updated = saveCitizenReceipt(receipt);
    setReceipts(updated);
    setActiveTicketId(receipt.ticket_id);
    navigateTo('ticket');
  };

  const handleRemoveReceipt = (ticketId: string) => {
    const updated = removeCitizenReceipt(ticketId);
    setReceipts(updated);
    setActiveTicketId(updated[0]?.ticket_id || null);
  };

  const handleStaffLogin = (token: string, user: AuthenticatedStaffUser) => {
    setStoredStaffToken(token);
    setStaffToken(token);
    setStaffUser(user);
  };

  const handleStaffLogout = useCallback(() => {
    setStoredStaffToken(null);
    setStaffToken(null);
    setStaffUser(null);
  }, []);

  const hideChrome = currentView === 'display' && displayFullscreen;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {!hideChrome && (
        <Navbar
          currentView={currentView}
          onNavigate={(view) => navigateTo(view)}
          staffUser={staffUser}
          savedTicketCount={receipts.length}
        />
      )}

      <main className="flex-1">
        {currentView === 'home' && (
          <LandingView
            publicState={publicState}
            connectionStatus={publicConnectionStatus}
            savedTicketCount={receipts.length}
            onNavigate={(view) => navigateTo(view)}
          />
        )}

        {currentView === 'register' && (
          <CitizenRegisterView
            publicState={publicState}
            arrivedViaQr={arrivedViaQr}
            onRegistered={handleCitizenRegistered}
            onViewPublicDisplay={() => navigateTo('display')}
          />
        )}

        {currentView === 'ticket' && (
          <TicketStatusView
            receipts={receipts}
            activeTicketId={activeTicketId}
            onSelectTicket={setActiveTicketId}
            onRemoveReceipt={handleRemoveReceipt}
            onRegisterNew={() => navigateTo('register')}
            onOpenPublicDisplay={() => navigateTo('display')}
            onPublicStateUpdate={setPublicState}
          />
        )}

        {currentView === 'display' && (
          <PublicDisplayView
            publicState={publicState}
            connectionStatus={publicConnectionStatus}
            fullscreenMode={displayFullscreen}
            onToggleFullscreenMode={() =>
              navigateTo('display', { fullscreen: !displayFullscreen })
            }
            onExitDisplay={() => navigateTo('home')}
          />
        )}

        {currentView === 'qr' && (
          <QrPosterView
            runtimeConfig={runtimeConfig}
            onOpenRegistrationPreview={() => navigateTo('register')}
          />
        )}

        {currentView === 'staff' && (
          <StaffPortalView
            authToken={staffToken}
            staffUser={staffUser}
            onLoginSuccess={handleStaffLogin}
            onLogout={handleStaffLogout}
            onPublicStateUpdate={setPublicState}
          />
        )}
      </main>

      {!hideChrome && currentView !== 'display' && (
        <footer className="border-t border-slate-200 bg-white print:hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-slate-500">
            <p>
              Panabo City Hall Civil Registry Queue Management System · Educational Queue
              Prototype (Queue Registration Only)
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => navigateTo('display')}
                className="hover:text-slate-900 underline-offset-4 hover:underline"
              >
                Public Lobby Display
              </button>
              <button
                type="button"
                onClick={() => navigateTo('qr')}
                className="hover:text-slate-900 underline-offset-4 hover:underline"
              >
                Printable QR Code
              </button>
              <button
                type="button"
                onClick={() => navigateTo('staff')}
                className="hover:text-slate-900 underline-offset-4 hover:underline"
              >
                Staff Sign-In
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
