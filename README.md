# Panabo City Hall Civil Registry Queue Management System

A standalone, responsive digital queue management application for the **Office of the City Civil Registrar of Panabo City Hall**, supporting **Birth Certificate**, **Marriage Certificate**, and **Death Certificate** service requests within one unified queue sequence.

> **Important Scope Disclaimer:** This application is an educational in-person queue-management prototype. It assigns queue numbers and manages counter turns only—it does **not** accept online certificate applications, government ID uploads, medical records, or payments.

---

## Standalone Zero-API Architecture

This application runs completely standalone in the browser with **no external APIs, API keys, or cloud databases required**, while preserving real-time multi-tab synchronization and strict queue lifecycle rules:

- **Framework:** React 19 + TypeScript + Tailwind CSS v4 + Vite (`src/`).
- **Standalone Queue Engine (`src/lib/localQueueEngine.ts`):**
  - **Real-Time Multi-Tab Sync:** Uses `BroadcastChannel` and `localStorage` events so actions in the **Staff Console** or **Citizen Registration** view update the **Public Lobby Display** and **Citizen Ticket** tabs immediately without manual refresh.
  - **Atomic Queue Numbering:** Uses the browser Web Locks API (`navigator.locks`) with a serial transaction fallback and `Idempotency-Key` deduplication so rapid or concurrent registrations across tabs always receive unique sequential numbers (`Q-001`, `Q-002`, ...).
  - **Single-Serving & Terminal State Protection:** Enforces at most one `Serving` ticket at a time and permanently prevents `Served` or `Skipped` tickets from being called again.
  - **Configurable PWD Priority Policy:** Keeps `priority_requested` and `priority_verified` separate, records which authorized staff member verified/declined priority and when, and places verified PWD tickets ahead of standard waiting tickets while preserving first-come, first-served order within each group.
  - **Role-Based Access Control (RBAC):** Salted SHA-256 password verification and session tokens enforce separation between `Staff` and `Administrator` permissions.
  - **Zero-PII Public Display:** The Public Display projection strips citizen names, receipt tokens, PWD indicators, and audit logs.

---

## Running Locally

```bash
npm install
npm run dev
```

Build static production files:
```bash
npm run build
```

---

## Prototype Staff & Administrator Accounts

| Role | Email | Password | Capabilities |
| :--- | :--- | :--- | :--- |
| **Staff** | `staff.civilregistry@panabo.local` | `StaffQueue2026!` | View waiting list, Call Next, Mark Served, Skip, verify/decline PWD priority, register walk-ins, open/pause public registration |
| **Staff** | `officer2.civilregistry@panabo.local` | `Registry2026!` | Counter Staff operations |
| **Administrator** | `admin.civilregistry@panabo.local` | `AdminQueue2026!` | All Staff actions + Close & Reset Queue Session (`Q-001`), configure PWD priority policy, manage Staff/Admin accounts, view Audit Logs & Session History, seed `[DEMO]` data |
