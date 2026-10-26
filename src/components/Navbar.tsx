import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import type { AuthenticatedStaffUser } from '../types/queue';

export type AppRouteView = 'home' | 'register' | 'ticket' | 'display' | 'qr' | 'staff';

interface NavbarProps {
  currentView: AppRouteView;
  onNavigate: (view: AppRouteView) => void;
  staffUser: AuthenticatedStaffUser | null;
  savedTicketCount: number;
}

export function Navbar({
  currentView,
  onNavigate,
  staffUser,
  savedTicketCount,
}: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: Array<{ id: AppRouteView; label: string }> = [
    { id: 'register', label: 'Join Queue' },
    { id: 'ticket', label: savedTicketCount > 0 ? `My Ticket (${savedTicketCount})` : 'My Ticket' },
    { id: 'display', label: 'Public Display' },
    { id: 'qr', label: 'QR Poster' },
    { id: 'staff', label: staffUser ? 'Staff Console' : 'Staff Sign-In' },
  ];

  const handleSelect = (view: AppRouteView) => {
    setMobileMenuOpen(false);
    onNavigate(view);
  };

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 print:hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-4 sm:px-6 lg:px-8 h-16">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleSelect('home')}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 hover:text-blue-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900 rounded"
        >
          Panabo Civil Registry
        </button>

        {/* Zone 2: Clean Single-Line Text Navigation Links */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-6 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900 ${
                  isActive
                    ? 'border-blue-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 Primary Action (Desktop) / Menu Toggle (Mobile) */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleSelect(currentView === 'register' ? 'ticket' : 'register')}
            className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-950 transition-colors whitespace-nowrap shrink-0 min-h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
          >
            {currentView === 'register' ? 'View My Ticket' : 'Get Queue Ticket'}
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Panel */}
      {mobileMenuOpen && (
        <nav
          id="mobile-nav-drawer"
          aria-label="Mobile navigation"
          className="md:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-4 space-y-1"
        >
          <button
            type="button"
            onClick={() => handleSelect('home')}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium min-h-11 ${
              currentView === 'home' ? 'bg-slate-100 text-slate-900 font-semibold' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            Overview
          </button>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium min-h-11 ${
                currentView === item.id
                  ? 'bg-slate-100 text-slate-900 font-semibold'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}
