import type { CitizenTicketReceipt } from '../types/queue';

const CITIZEN_RECEIPTS_KEY = 'panabo_cr_citizen_receipts_v1';
const STAFF_TOKEN_KEY = 'panabo_cr_staff_token_v1';

export function getSavedCitizenReceipts(): CitizenTicketReceipt[] {
  try {
    const raw = window.localStorage.getItem(CITIZEN_RECEIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CitizenTicketReceipt =>
        Boolean(item && typeof item.ticket_id === 'string' && typeof item.citizen_token === 'string')
    );
  } catch {
    return [];
  }
}

export function saveCitizenReceipt(receipt: CitizenTicketReceipt): CitizenTicketReceipt[] {
  try {
    const existing = getSavedCitizenReceipts().filter((r) => r.ticket_id !== receipt.ticket_id);
    const updated = [receipt, ...existing].slice(0, 10);
    window.localStorage.setItem(CITIZEN_RECEIPTS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [receipt];
  }
}

export function removeCitizenReceipt(ticketId: string): CitizenTicketReceipt[] {
  try {
    const updated = getSavedCitizenReceipts().filter((r) => r.ticket_id !== ticketId);
    window.localStorage.setItem(CITIZEN_RECEIPTS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function getStoredStaffToken(): string | null {
  try {
    return window.localStorage.getItem(STAFF_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredStaffToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(STAFF_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(STAFF_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota / iframe restrictions
  }
}
