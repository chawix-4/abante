import {
  PriorityPolicyMode,
  PriorityVerificationStatus,
  RegistrationSource,
  RequestCategory,
  SessionStatus,
  TicketStatus,
  UserRole,
} from '../types/queue';
import type {
  AdminOverviewPayload,
  AppRuntimeConfig,
  AuditEvent,
  AuthenticatedStaffUser,
  CitizenTicketReceipt,
  CitizenTicketStatusPayload,
  PublicQueueState,
  QueueSession,
  QueueSessionHistory,
  QueueTicket,
  StaffQueueState,
} from '../types/queue';

export class QueueEngineError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'QUEUE_ERROR') {
    super(message);
    this.name = 'QueueEngineError';
    this.status = status;
    this.code = code;
  }
}

interface StoredTicketRecord extends Omit<QueueTicket, 'queue_position'> {
  citizen_token: string;
}

interface StoredStaffAccount {
  uid: string;
  email: string;
  display_name: string;
  role: UserRole;
  active: boolean;
  password_salt: string;
  password_hash: string;
  created_at: string;
}

interface StoredAuthSession {
  token: string;
  uid: string;
  expires_at: number;
}

interface StoredIdempotencyEntry {
  result: unknown;
  created_at: number;
}

interface LocalQueueDatabase {
  version: number;
  active_session: QueueSession;
  tickets: StoredTicketRecord[];
  archived_tickets: StoredTicketRecord[];
  staff_users: StoredStaffAccount[];
  auth_sessions: Record<string, StoredAuthSession>;
  idempotency_cache: Record<string, StoredIdempotencyEntry>;
  audit_events: AuditEvent[];
  session_history: QueueSessionHistory[];
}

const DB_STORAGE_KEY = 'panabo_cr_standalone_db_v1';
const BROADCAST_CHANNEL_NAME = 'panabo_cr_queue_broadcast_v1';
const SERVICE_NAME = 'Panabo City Hall — Civil Registry Service Queue';
const AUTH_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const IDEMPOTENCY_TTL_MS = 1000 * 60 * 30; // 30 minutes
const ALLOWED_CATEGORIES = new Set<RequestCategory>([
  RequestCategory.Birth,
  RequestCategory.Marriage,
  RequestCategory.Death,
]);

let inMemoryFallbackDb: LocalQueueDatabase | null = null;
const localListeners = new Set<() => void>();
let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = () => {
      notifySubscribers();
    };
  }
  return broadcastChannel;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === DB_STORAGE_KEY) {
      notifySubscribers();
    }
  });
  getBroadcastChannel();
}

function notifySubscribers(): void {
  for (const listener of localListeners) {
    try {
      listener();
    } catch {
      // Ignore individual subscriber errors
    }
  }
}

function broadcastMutation(): void {
  try {
    getBroadcastChannel()?.postMessage({ type: 'DB_UPDATED', ts: Date.now() });
  } catch {
    // Ignore BroadcastChannel errors
  }
  notifySubscribers();
}

export function subscribeToQueueChanges(listener: () => void): () => void {
  localListeners.add(listener);
  getBroadcastChannel();
  return () => {
    localListeners.delete(listener);
  };
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic fallback hash if WebCrypto is unavailable in non-HTTPS local preview
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

async function hashStaffPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`panabo_cr_v1:${salt}:${password}`);
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatQueueNumber(num: number): string {
  return `Q-${String(num).padStart(3, '0')}`;
}

function createFreshSession(
  policy: PriorityPolicyMode = PriorityPolicyMode.VerifiedOnly
): QueueSession {
  const now = new Date().toISOString();
  return {
    session_id: `ses_${randomHex(4)}`,
    service_name: SERVICE_NAME,
    date: todayDateString(),
    status: SessionStatus.Open,
    next_number: 1,
    current_serving_ticket_id: null,
    priority_policy: policy,
    created_at: now,
    updated_at: now,
  };
}

async function createSeededStaffAccount(
  uid: string,
  email: string,
  displayName: string,
  role: UserRole,
  password: string
): Promise<StoredStaffAccount> {
  const salt = randomHex(12);
  const hash = await hashStaffPassword(password, salt);
  return {
    uid,
    email: email.toLowerCase(),
    display_name: displayName,
    role,
    active: true,
    password_salt: salt,
    password_hash: hash,
    created_at: new Date().toISOString(),
  };
}

async function buildInitialDatabase(): Promise<LocalQueueDatabase> {
  const initialSession = createFreshSession(PriorityPolicyMode.VerifiedOnly);
  const staffUsers = await Promise.all([
    createSeededStaffAccount(
      'staff_01',
      'staff.civilregistry@panabo.local',
      'Counter Officer M. Santos',
      UserRole.Staff,
      'StaffQueue2026!'
    ),
    createSeededStaffAccount(
      'staff_02',
      'officer2.civilregistry@panabo.local',
      'Registry Clerk R. Reyes',
      UserRole.Staff,
      'Registry2026!'
    ),
    createSeededStaffAccount(
      'admin_01',
      'admin.civilregistry@panabo.local',
      'Civil Registrar Supervisor',
      UserRole.Admin,
      'AdminQueue2026!'
    ),
  ]);

  return {
    version: 1,
    active_session: initialSession,
    tickets: [],
    archived_tickets: [],
    staff_users: staffUsers,
    auth_sessions: {},
    idempotency_cache: {},
    audit_events: [
      {
        event_id: `evt_${randomHex(6)}`,
        session_id: initialSession.session_id,
        ticket_id: null,
        actor_id: 'system',
        actor_role: 'system',
        action_type: 'SESSION_INITIALIZED',
        previous_status: null,
        new_status: SessionStatus.Open,
        event_timestamp: initialSession.created_at,
        idempotency_key: 'init_boot',
        metadata: {
          priority_policy: initialSession.priority_policy,
        },
      },
    ],
    session_history: [],
  };
}

async function readDatabase(): Promise<LocalQueueDatabase> {
  try {
    const raw = window.localStorage.getItem(DB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalQueueDatabase;
      if (parsed && parsed.version === 1 && parsed.active_session && Array.isArray(parsed.tickets)) {
        inMemoryFallbackDb = parsed;
        return parsed;
      }
    }
  } catch {
    if (inMemoryFallbackDb) return inMemoryFallbackDb;
  }

  if (inMemoryFallbackDb) return inMemoryFallbackDb;
  const fresh = await buildInitialDatabase();
  writeDatabase(fresh);
  return fresh;
}

function writeDatabase(db: LocalQueueDatabase): void {
  inMemoryFallbackDb = db;
  try {
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Fallback to in-memory store if storage quota is restricted
  }
}

/**
 * Serial cross-tab atomic lock using Web Locks API (with promise chain fallback)
 * so concurrent operations across tabs or rapid clicks never collide.
 */
let fallbackChain: Promise<unknown> = Promise.resolve();

function runAtomicTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request('panabo_cr_atomic_queue_lock', async () => {
      return work();
    });
  }
  const next = fallbackChain.then(work, work);
  fallbackChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function pruneExpiredRecords(db: LocalQueueDatabase): void {
  const now = Date.now();
  for (const [token, session] of Object.entries(db.auth_sessions)) {
    if (now > session.expires_at) {
      delete db.auth_sessions[token];
    }
  }
  for (const [key, entry] of Object.entries(db.idempotency_cache)) {
    if (now - entry.created_at > IDEMPOTENCY_TTL_MS) {
      delete db.idempotency_cache[key];
    }
  }
}

function hasEffectivePriority(
  ticket: StoredTicketRecord,
  policy: PriorityPolicyMode
): boolean {
  if (ticket.priority_verified) {
    return true;
  }
  if (
    policy === PriorityPolicyMode.IncludeSelfDeclared &&
    ticket.priority_requested &&
    ticket.priority_status !== PriorityVerificationStatus.Declined
  ) {
    return true;
  }
  return false;
}

function getOrderedWaitingTickets(db: LocalQueueDatabase): StoredTicketRecord[] {
  const policy = db.active_session.priority_policy;
  return db.tickets
    .filter((t) => t.status === TicketStatus.Waiting)
    .sort((a, b) => {
      const aPrio = hasEffectivePriority(a, policy) ? 1 : 0;
      const bPrio = hasEffectivePriority(b, policy) ? 1 : 0;
      if (aPrio !== bPrio) {
        return bPrio - aPrio;
      }
      return a.queue_number - b.queue_number;
    });
}

function appendAuditEvent(
  db: LocalQueueDatabase,
  params: {
    session_id: string;
    ticket_id: string | null;
    actor_id: string;
    actor_role: string;
    action_type: string;
    previous_status: string | null;
    new_status: string | null;
    idempotency_key: string;
    metadata?: Record<string, string | number | boolean | null>;
  }
): void {
  if (
    params.idempotency_key &&
    db.audit_events.some(
      (e) =>
        e.idempotency_key === params.idempotency_key && e.action_type === params.action_type
    )
  ) {
    return;
  }

  db.audit_events.unshift({
    event_id: `evt_${randomHex(6)}`,
    session_id: params.session_id,
    ticket_id: params.ticket_id,
    actor_id: params.actor_id,
    actor_role: params.actor_role,
    action_type: params.action_type,
    previous_status: params.previous_status,
    new_status: params.new_status,
    event_timestamp: new Date().toISOString(),
    idempotency_key: params.idempotency_key || `auto_${randomHex(4)}`,
    metadata: params.metadata || {},
  });

  if (db.audit_events.length > 500) {
    db.audit_events.length = 500;
  }
}

function validateCitizenDisplayName(input: unknown): string {
  if (typeof input !== 'string') {
    throw new QueueEngineError(
      'Please enter your name to join the queue.',
      400,
      'INVALID_NAME'
    );
  }
  const cleaned = input.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) {
    throw new QueueEngineError(
      'Display name must be at least 2 characters long (blank names are not allowed).',
      400,
      'INVALID_NAME'
    );
  }
  if (cleaned.length > 60) {
    throw new QueueEngineError(
      'Display name must be 60 characters or fewer.',
      400,
      'INVALID_NAME'
    );
  }
  return cleaned;
}

function requireStaffAccount(
  db: LocalQueueDatabase,
  authToken: string | null | undefined
): StoredStaffAccount {
  pruneExpiredRecords(db);
  if (!authToken) {
    throw new QueueEngineError(
      'Authorized staff sign-in is required to perform this action.',
      401,
      'UNAUTHORIZED'
    );
  }
  const session = db.auth_sessions[authToken];
  if (!session) {
    throw new QueueEngineError(
      'Your staff session has expired or is invalid. Please sign in again.',
      401,
      'UNAUTHORIZED'
    );
  }
  const user = db.staff_users.find((u) => u.uid === session.uid && u.active);
  if (!user) {
    delete db.auth_sessions[authToken];
    writeDatabase(db);
    throw new QueueEngineError(
      'Staff account access is no longer active.',
      401,
      'UNAUTHORIZED'
    );
  }
  return user;
}

function requireAdminAccount(
  db: LocalQueueDatabase,
  authToken: string | null | undefined
): StoredStaffAccount {
  const user = requireStaffAccount(db, authToken);
  if (user.role !== UserRole.Admin) {
    throw new QueueEngineError(
      'This action is restricted to Civil Registry Administrators.',
      403,
      'FORBIDDEN'
    );
  }
  return user;
}

function toStaffTicket(
  ticket: StoredTicketRecord,
  positionMap: Map<string, number>
): QueueTicket {
  const { citizen_token: _omitToken, ...rest } = ticket;
  return {
    ...rest,
    queue_position: positionMap.get(ticket.ticket_id) ?? null,
  };
}

function computePublicState(db: LocalQueueDatabase): PublicQueueState {
  const orderedWaiting = getOrderedWaitingTickets(db);
  const servingTicket =
    db.tickets.find(
      (t) =>
        t.ticket_id === db.active_session.current_serving_ticket_id &&
        t.status === TicketStatus.Serving
    ) ||
    db.tickets.find((t) => t.status === TicketStatus.Serving) ||
    null;

  return {
    session: {
      session_id: db.active_session.session_id,
      service_name: db.active_session.service_name,
      date: db.active_session.date,
      status: db.active_session.status,
      updated_at: db.active_session.updated_at,
    },
    now_serving: servingTicket
      ? {
          display_number: servingTicket.display_number,
          request_category: servingTicket.request_category,
          called_at: servingTicket.called_at,
        }
      : null,
    upcoming: orderedWaiting.slice(0, 8).map((t) => ({
      display_number: t.display_number,
      request_category: t.request_category,
    })),
    total_waiting: orderedWaiting.length,
    server_time: new Date().toISOString(),
  };
}

function computeStaffState(db: LocalQueueDatabase): StaffQueueState {
  const orderedWaiting = getOrderedWaitingTickets(db);
  const positionMap = new Map<string, number>();
  orderedWaiting.forEach((t, idx) => {
    positionMap.set(t.ticket_id, idx + 1);
  });

  const servingTicket =
    db.tickets.find(
      (t) =>
        t.ticket_id === db.active_session.current_serving_ticket_id &&
        t.status === TicketStatus.Serving
    ) ||
    db.tickets.find((t) => t.status === TicketStatus.Serving) ||
    null;

  const nextEligible = orderedWaiting[0] || null;

  const counts = {
    waiting: 0,
    serving: 0,
    served: 0,
    skipped: 0,
    total: db.tickets.length,
  };
  for (const t of db.tickets) {
    counts[t.status] += 1;
  }

  const sortedTickets = [...db.tickets].sort((a, b) => {
    if (a.status === TicketStatus.Serving && b.status !== TicketStatus.Serving) return -1;
    if (b.status === TicketStatus.Serving && a.status !== TicketStatus.Serving) return 1;
    if (a.status === TicketStatus.Waiting && b.status === TicketStatus.Waiting) {
      return (positionMap.get(a.ticket_id) || 0) - (positionMap.get(b.ticket_id) || 0);
    }
    if (a.status === TicketStatus.Waiting) return -1;
    if (b.status === TicketStatus.Waiting) return 1;
    return b.queue_number - a.queue_number;
  });

  return {
    session: { ...db.active_session },
    currently_serving: servingTicket ? toStaffTicket(servingTicket, positionMap) : null,
    next_eligible_ticket: nextEligible ? toStaffTicket(nextEligible, positionMap) : null,
    tickets: sortedTickets.map((t) => toStaffTicket(t, positionMap)),
    counts,
    server_time: new Date().toISOString(),
  };
}

function computeCitizenTicketStatus(
  db: LocalQueueDatabase,
  ticketId: string,
  citizenToken: string
): CitizenTicketStatusPayload {
  let ticket = db.tickets.find((t) => t.ticket_id === ticketId);
  let isActiveSession = true;

  if (!ticket) {
    ticket = db.archived_tickets.find((t) => t.ticket_id === ticketId);
    isActiveSession = false;
  }

  if (!ticket) {
    throw new QueueEngineError('Queue ticket not found.', 404, 'NOT_FOUND');
  }
  if (!citizenToken || ticket.citizen_token !== citizenToken) {
    throw new QueueEngineError(
      'Valid ticket receipt token is required to view individual ticket status.',
      403,
      'FORBIDDEN'
    );
  }

  let aheadCount: number | null = null;
  let queuePosition: number | null = null;

  if (isActiveSession && ticket.status === TicketStatus.Waiting) {
    const orderedWaiting = getOrderedWaitingTickets(db);
    const index = orderedWaiting.findIndex((t) => t.ticket_id === ticket!.ticket_id);
    if (index >= 0) {
      aheadCount = index;
      queuePosition = index + 1;
    }
  }

  const servingTicket = isActiveSession
    ? db.tickets.find((t) => t.status === TicketStatus.Serving) || null
    : null;

  return {
    ticket_id: ticket.ticket_id,
    session_id: ticket.session_id,
    is_active_session: isActiveSession,
    display_number: ticket.display_number,
    request_category: ticket.request_category,
    status: ticket.status,
    priority_requested: ticket.priority_requested,
    priority_verified: ticket.priority_verified,
    priority_status: ticket.priority_status,
    ahead_count: aheadCount,
    queue_position: queuePosition,
    now_serving_number: servingTicket ? servingTicket.display_number : null,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    called_at: ticket.called_at,
    served_at: ticket.served_at,
    skipped_at: ticket.skipped_at,
  };
}

export const localQueueEngine = {
  async getConfig(): Promise<AppRuntimeConfig> {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const configured =
      ((import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || '').trim() || origin;
    return {
      app_url: configured,
      service_name: SERVICE_NAME,
      prototype_mode: true,
    };
  },

  async getPublicState(): Promise<PublicQueueState> {
    const db = await readDatabase();
    return computePublicState(db);
  },

  async registerCitizenTicket(
    payload: {
      display_name: string;
      request_category: RequestCategory;
      priority_requested: boolean;
      registration_source: RegistrationSource;
    },
    idempotencyKey: string
  ): Promise<CitizenTicketReceipt> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      pruneExpiredRecords(db);

      const cacheKey = idempotencyKey ? `cit_reg:${idempotencyKey}` : '';
      if (cacheKey && db.idempotency_cache[cacheKey]) {
        return db.idempotency_cache[cacheKey].result as CitizenTicketReceipt;
      }

      if (db.active_session.status !== SessionStatus.Open) {
        throw new QueueEngineError(
          'Queue registration is currently closed for this session. Please check with the Civil Registry assistance desk.',
          403,
          'SESSION_CLOSED'
        );
      }

      const cleanName = validateCitizenDisplayName(payload.display_name);
      if (!ALLOWED_CATEGORIES.has(payload.request_category)) {
        throw new QueueEngineError(
          'Please select Birth Certificate, Marriage Certificate, or Death Certificate.',
          400,
          'INVALID_CATEGORY'
        );
      }

      const priorityRequested = Boolean(payload.priority_requested);
      const source =
        payload.registration_source === RegistrationSource.CitizenQR
          ? RegistrationSource.CitizenQR
          : RegistrationSource.CitizenWeb;

      const assignedNumber = db.active_session.next_number;
      db.active_session.next_number += 1;
      const now = new Date().toISOString();
      db.active_session.updated_at = now;

      const newTicket: StoredTicketRecord = {
        ticket_id: `tkt_${randomHex(10)}`,
        citizen_token: randomHex(20),
        session_id: db.active_session.session_id,
        queue_number: assignedNumber,
        display_number: formatQueueNumber(assignedNumber),
        display_name: cleanName,
        request_category: payload.request_category,
        priority_requested: priorityRequested,
        priority_verified: false,
        priority_status: priorityRequested
          ? PriorityVerificationStatus.Pending
          : PriorityVerificationStatus.None,
        priority_updated_by: null,
        priority_updated_at: null,
        status: TicketStatus.Waiting,
        created_at: now,
        updated_at: now,
        called_at: null,
        served_at: null,
        skipped_at: null,
        registration_source: source,
        is_demo: false,
      };

      db.tickets.push(newTicket);

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: newTicket.ticket_id,
        actor_id: 'public_citizen',
        actor_role: 'citizen',
        action_type: 'TICKET_REGISTERED',
        previous_status: null,
        new_status: TicketStatus.Waiting,
        idempotency_key: idempotencyKey || `reg_${newTicket.ticket_id}`,
        metadata: {
          display_number: newTicket.display_number,
          request_category: newTicket.request_category,
          priority_requested: newTicket.priority_requested,
          registration_source: newTicket.registration_source,
        },
      });

      const receipt: CitizenTicketReceipt = {
        ticket_id: newTicket.ticket_id,
        citizen_token: newTicket.citizen_token,
        session_id: newTicket.session_id,
        display_number: newTicket.display_number,
        request_category: newTicket.request_category,
        created_at: newTicket.created_at,
      };

      if (cacheKey) {
        db.idempotency_cache[cacheKey] = {
          result: receipt,
          created_at: Date.now(),
        };
      }

      writeDatabase(db);
      broadcastMutation();
      return receipt;
    });
  },

  async getCitizenTicketStatus(
    ticketId: string,
    citizenToken: string
  ): Promise<CitizenTicketStatusPayload> {
    const db = await readDatabase();
    return computeCitizenTicketStatus(db, ticketId, citizenToken);
  },

  async loginStaff(
    email: string,
    password: string
  ): Promise<{ token: string; user: AuthenticatedStaffUser }> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      pruneExpiredRecords(db);

      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !password) {
        throw new QueueEngineError(
          'Enter both your staff email address and password.',
          400,
          'MISSING_CREDENTIALS'
        );
      }

      const account = db.staff_users.find((u) => u.email === normalizedEmail);
      if (!account || !account.active) {
        throw new QueueEngineError(
          'Invalid email or password, or account access is inactive.',
          401,
          'INVALID_CREDENTIALS'
        );
      }

      const computedHash = await hashStaffPassword(password, account.password_salt);
      if (computedHash !== account.password_hash) {
        throw new QueueEngineError(
          'Invalid email or password.',
          401,
          'INVALID_CREDENTIALS'
        );
      }

      const token = `stf_${randomHex(24)}`;
      db.auth_sessions[token] = {
        token,
        uid: account.uid,
        expires_at: Date.now() + AUTH_TTL_MS,
      };

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: null,
        actor_id: account.uid,
        actor_role: account.role,
        action_type: 'STAFF_SIGNED_IN',
        previous_status: null,
        new_status: null,
        idempotency_key: `login_${token.slice(0, 12)}`,
        metadata: { email: account.email },
      });

      writeDatabase(db);
      broadcastMutation();

      return {
        token,
        user: {
          uid: account.uid,
          email: account.email,
          display_name: account.display_name,
          role: account.role,
          active: account.active,
        },
      };
    });
  },

  async logoutStaff(authToken: string): Promise<{ ok: boolean }> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const session = db.auth_sessions[authToken];
      if (session) {
        const actor = db.staff_users.find((u) => u.uid === session.uid);
        delete db.auth_sessions[authToken];
        if (actor) {
          appendAuditEvent(db, {
            session_id: db.active_session.session_id,
            ticket_id: null,
            actor_id: actor.uid,
            actor_role: actor.role,
            action_type: 'STAFF_SIGNED_OUT',
            previous_status: null,
            new_status: null,
            idempotency_key: `logout_${randomHex(6)}`,
          });
        }
        writeDatabase(db);
        broadcastMutation();
      }
      return { ok: true };
    });
  },

  async getMe(authToken: string): Promise<{ user: AuthenticatedStaffUser }> {
    const db = await readDatabase();
    const user = requireStaffAccount(db, authToken);
    return {
      user: {
        uid: user.uid,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        active: user.active,
      },
    };
  },

  async getStaffState(authToken: string): Promise<StaffQueueState> {
    const db = await readDatabase();
    requireStaffAccount(db, authToken);
    return computeStaffState(db);
  },

  async registerWalkIn(
    authToken: string,
    payload: {
      display_name: string;
      request_category: RequestCategory;
      priority_requested: boolean;
      verify_immediately: boolean;
    },
    idempotencyKey: string
  ): Promise<{ ticket: QueueTicket }> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireStaffAccount(db, authToken);

      const cacheKey = idempotencyKey ? `walkin:${idempotencyKey}` : '';
      if (cacheKey && db.idempotency_cache[cacheKey]) {
        return db.idempotency_cache[cacheKey].result as { ticket: QueueTicket };
      }

      if (db.active_session.status === SessionStatus.Closed) {
        throw new QueueEngineError('The current session is closed.', 409, 'SESSION_CLOSED');
      }

      const cleanName = validateCitizenDisplayName(payload.display_name);
      if (!ALLOWED_CATEGORIES.has(payload.request_category)) {
        throw new QueueEngineError(
          'Select a valid certificate category.',
          400,
          'INVALID_CATEGORY'
        );
      }

      const priorityRequested = Boolean(payload.priority_requested);
      const verifyNow = priorityRequested && Boolean(payload.verify_immediately);

      const assignedNumber = db.active_session.next_number;
      db.active_session.next_number += 1;
      const now = new Date().toISOString();
      db.active_session.updated_at = now;

      const newTicket: StoredTicketRecord = {
        ticket_id: `tkt_${randomHex(10)}`,
        citizen_token: randomHex(20),
        session_id: db.active_session.session_id,
        queue_number: assignedNumber,
        display_number: formatQueueNumber(assignedNumber),
        display_name: cleanName,
        request_category: payload.request_category,
        priority_requested: priorityRequested,
        priority_verified: verifyNow,
        priority_status: priorityRequested
          ? verifyNow
            ? PriorityVerificationStatus.Verified
            : PriorityVerificationStatus.Pending
          : PriorityVerificationStatus.None,
        priority_updated_by: verifyNow ? actor.display_name : null,
        priority_updated_at: verifyNow ? now : null,
        status: TicketStatus.Waiting,
        created_at: now,
        updated_at: now,
        called_at: null,
        served_at: null,
        skipped_at: null,
        registration_source: RegistrationSource.StaffWalkIn,
        is_demo: false,
      };

      db.tickets.push(newTicket);

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: newTicket.ticket_id,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type: 'WALK_IN_REGISTERED',
        previous_status: null,
        new_status: TicketStatus.Waiting,
        idempotency_key: idempotencyKey || `walkin_${newTicket.ticket_id}`,
        metadata: {
          display_number: newTicket.display_number,
          request_category: newTicket.request_category,
          priority_requested: priorityRequested,
          priority_verified: verifyNow,
        },
      });

      const positionMap = new Map<string, number>();
      getOrderedWaitingTickets(db).forEach((t, idx) => positionMap.set(t.ticket_id, idx + 1));

      const response = {
        ticket: toStaffTicket(newTicket, positionMap),
      };

      if (cacheKey) {
        db.idempotency_cache[cacheKey] = {
          result: response,
          created_at: Date.now(),
        };
      }

      writeDatabase(db);
      broadcastMutation();
      return response;
    });
  },

  async callNextTicket(authToken: string, idempotencyKey: string): Promise<StaffQueueState> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireStaffAccount(db, authToken);

      const cacheKey = idempotencyKey ? `call_next:${idempotencyKey}` : '';
      if (cacheKey && db.idempotency_cache[cacheKey]) {
        return db.idempotency_cache[cacheKey].result as StaffQueueState;
      }

      const existingServing = db.tickets.find((t) => t.status === TicketStatus.Serving);
      if (existingServing) {
        throw new QueueEngineError(
          `Ticket ${existingServing.display_number} is currently Serving. Mark it Served or Skip it before calling the next ticket.`,
          409,
          'ALREADY_SERVING'
        );
      }

      const orderedWaiting = getOrderedWaitingTickets(db);
      const nextTicket = orderedWaiting[0];
      if (!nextTicket) {
        throw new QueueEngineError(
          'No waiting tickets are currently in the queue.',
          404,
          'QUEUE_EMPTY'
        );
      }

      const now = new Date().toISOString();
      nextTicket.status = TicketStatus.Serving;
      nextTicket.called_at = now;
      nextTicket.updated_at = now;
      db.active_session.current_serving_ticket_id = nextTicket.ticket_id;
      db.active_session.updated_at = now;

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: nextTicket.ticket_id,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type: 'TICKET_CALLED_SERVING',
        previous_status: TicketStatus.Waiting,
        new_status: TicketStatus.Serving,
        idempotency_key: idempotencyKey || `call_${nextTicket.ticket_id}`,
        metadata: {
          display_number: nextTicket.display_number,
          priority_verified: nextTicket.priority_verified,
          policy_used: db.active_session.priority_policy,
        },
      });

      const nextState = computeStaffState(db);
      if (cacheKey) {
        db.idempotency_cache[cacheKey] = {
          result: nextState,
          created_at: Date.now(),
        };
      }

      writeDatabase(db);
      broadcastMutation();
      return nextState;
    });
  },

  async updateTicketStatus(
    authToken: string,
    ticketId: string,
    targetStatus: TicketStatus.Served | TicketStatus.Skipped,
    idempotencyKey: string
  ): Promise<StaffQueueState> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireStaffAccount(db, authToken);

      const cacheKey = idempotencyKey ? `status:${ticketId}:${idempotencyKey}` : '';
      if (cacheKey && db.idempotency_cache[cacheKey]) {
        return db.idempotency_cache[cacheKey].result as StaffQueueState;
      }

      const ticket = db.tickets.find((t) => t.ticket_id === ticketId);
      if (!ticket) {
        throw new QueueEngineError(
          'Ticket not found in active session.',
          404,
          'NOT_FOUND'
        );
      }

      if (ticket.status === TicketStatus.Served || ticket.status === TicketStatus.Skipped) {
        throw new QueueEngineError(
          `Ticket ${ticket.display_number} is already ${ticket.status} and is permanently ineligible for further transitions.`,
          409,
          'TERMINAL_STATUS_IMMUTABLE'
        );
      }

      if (targetStatus !== TicketStatus.Served && targetStatus !== TicketStatus.Skipped) {
        throw new QueueEngineError(
          `Transition from ${ticket.status} to ${String(targetStatus)} is not permitted.`,
          400,
          'INVALID_TRANSITION'
        );
      }

      if (targetStatus === TicketStatus.Served && ticket.status !== TicketStatus.Serving) {
        throw new QueueEngineError(
          `Ticket ${ticket.display_number} must be called to Serving before it can be marked Served.`,
          409,
          'MUST_BE_SERVING_FIRST'
        );
      }

      const prevStatus = ticket.status;
      const now = new Date().toISOString();
      ticket.status = targetStatus;
      ticket.updated_at = now;
      if (targetStatus === TicketStatus.Served) {
        ticket.served_at = now;
      } else {
        ticket.skipped_at = now;
      }

      if (db.active_session.current_serving_ticket_id === ticket.ticket_id) {
        db.active_session.current_serving_ticket_id = null;
      }
      db.active_session.updated_at = now;

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: ticket.ticket_id,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type:
          targetStatus === TicketStatus.Served
            ? 'TICKET_MARKED_SERVED'
            : 'TICKET_MARKED_SKIPPED',
        previous_status: prevStatus,
        new_status: targetStatus,
        idempotency_key: idempotencyKey || `status_${ticket.ticket_id}_${targetStatus}`,
        metadata: {
          display_number: ticket.display_number,
        },
      });

      const nextState = computeStaffState(db);
      if (cacheKey) {
        db.idempotency_cache[cacheKey] = {
          result: nextState,
          created_at: Date.now(),
        };
      }

      writeDatabase(db);
      broadcastMutation();
      return nextState;
    });
  },

  async decideTicketPriority(
    authToken: string,
    ticketId: string,
    decision: 'verify' | 'decline',
    idempotencyKey: string
  ): Promise<StaffQueueState> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireStaffAccount(db, authToken);

      const ticket = db.tickets.find((t) => t.ticket_id === ticketId);
      if (!ticket) {
        throw new QueueEngineError(
          'Ticket not found in active session.',
          404,
          'NOT_FOUND'
        );
      }

      if (ticket.status === TicketStatus.Served || ticket.status === TicketStatus.Skipped) {
        throw new QueueEngineError(
          'Cannot change priority verification on a finalized ticket.',
          409,
          'TICKET_FINALIZED'
        );
      }

      const prevPriority = ticket.priority_status;
      const now = new Date().toISOString();
      ticket.priority_verified = decision === 'verify';
      ticket.priority_status =
        decision === 'verify'
          ? PriorityVerificationStatus.Verified
          : PriorityVerificationStatus.Declined;
      ticket.priority_updated_by = actor.display_name;
      ticket.priority_updated_at = now;
      ticket.updated_at = now;
      db.active_session.updated_at = now;

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: ticket.ticket_id,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type: decision === 'verify' ? 'PRIORITY_VERIFIED' : 'PRIORITY_DECLINED',
        previous_status: prevPriority,
        new_status: ticket.priority_status,
        idempotency_key: idempotencyKey || `prio_${ticket.ticket_id}_${decision}_${now}`,
        metadata: {
          display_number: ticket.display_number,
          priority_requested: ticket.priority_requested,
        },
      });

      const nextState = computeStaffState(db);
      writeDatabase(db);
      broadcastMutation();
      return nextState;
    });
  },

  async setRegistrationOpen(authToken: string, open: boolean): Promise<StaffQueueState> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireStaffAccount(db, authToken);

      const prev = db.active_session.status;
      const nextStatus = open ? SessionStatus.Open : SessionStatus.RegistrationClosed;
      const now = new Date().toISOString();
      db.active_session.status = nextStatus;
      db.active_session.updated_at = now;

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: null,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type: open ? 'REGISTRATION_OPENED' : 'REGISTRATION_PAUSED',
        previous_status: prev,
        new_status: nextStatus,
        idempotency_key: `reg_toggle_${now}`,
      });

      const nextState = computeStaffState(db);
      writeDatabase(db);
      broadcastMutation();
      return nextState;
    });
  },

  async getAdminOverview(authToken: string): Promise<AdminOverviewPayload> {
    const db = await readDatabase();
    requireAdminAccount(db, authToken);

    return {
      staff_accounts: db.staff_users.map((u) => ({
        uid: u.uid,
        email: u.email,
        display_name: u.display_name,
        role: u.role,
        active: u.active,
      })),
      audit_events: db.audit_events.slice(0, 200),
      session_history: [...db.session_history],
      archived_tickets_count: db.archived_tickets.length,
    };
  },

  async updatePriorityPolicy(
    authToken: string,
    priorityPolicy: PriorityPolicyMode
  ): Promise<StaffQueueState> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireAdminAccount(db, authToken);

      const prev = db.active_session.priority_policy;
      const now = new Date().toISOString();
      db.active_session.priority_policy = priorityPolicy;
      db.active_session.updated_at = now;

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: null,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type: 'PRIORITY_POLICY_CHANGED',
        previous_status: prev,
        new_status: priorityPolicy,
        idempotency_key: `policy_${now}`,
      });

      const nextState = computeStaffState(db);
      writeDatabase(db);
      broadcastMutation();
      return nextState;
    });
  },

  async resetQueueSession(
    authToken: string,
    idempotencyKey: string
  ): Promise<{ staff_state: StaffQueueState; archived_session_id: string }> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireAdminAccount(db, authToken);

      const cacheKey = idempotencyKey ? `reset:${idempotencyKey}` : '';
      if (cacheKey && db.idempotency_cache[cacheKey]) {
        return db.idempotency_cache[cacheKey].result as {
          staff_state: StaffQueueState;
          archived_session_id: string;
        };
      }

      const oldSession = db.active_session;
      const now = new Date().toISOString();

      const totalRegistered = db.tickets.length;
      const totalServed = db.tickets.filter((t) => t.status === TicketStatus.Served).length;
      const totalSkipped = db.tickets.filter((t) => t.status === TicketStatus.Skipped).length;
      const unservedAtClose = db.tickets.filter(
        (t) => t.status === TicketStatus.Waiting || t.status === TicketStatus.Serving
      ).length;

      db.session_history.unshift({
        session_id: oldSession.session_id,
        service_name: oldSession.service_name,
        session_date: oldSession.date,
        total_registered: totalRegistered,
        total_served: totalServed,
        total_skipped: totalSkipped,
        unserved_at_close: unservedAtClose,
        opened_at: oldSession.created_at,
        closed_at: now,
        closed_by: actor.display_name,
      });

      // Preserve all historical tickets untouched (never deleted)
      db.archived_tickets.push(...db.tickets);

      // Start fresh session at Q-001
      const newSession = createFreshSession(oldSession.priority_policy);
      db.active_session = newSession;
      db.tickets = [];

      appendAuditEvent(db, {
        session_id: newSession.session_id,
        ticket_id: null,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type: 'SESSION_CLOSED_AND_RESET',
        previous_status: oldSession.session_id,
        new_status: newSession.session_id,
        idempotency_key: idempotencyKey || `reset_${oldSession.session_id}`,
        metadata: {
          closed_session_id: oldSession.session_id,
          total_registered: totalRegistered,
          total_served: totalServed,
          total_skipped: totalSkipped,
          unserved_at_close: unservedAtClose,
        },
      });

      const result = {
        staff_state: computeStaffState(db),
        archived_session_id: oldSession.session_id,
      };

      if (cacheKey) {
        db.idempotency_cache[cacheKey] = {
          result,
          created_at: Date.now(),
        };
      }

      writeDatabase(db);
      broadcastMutation();
      return result;
    });
  },

  async manageStaffAccount(
    authToken: string,
    payload:
      | {
          action: 'create';
          email: string;
          display_name: string;
          password: string;
          role: UserRole;
        }
      | { action: 'toggle_active'; uid: string }
      | { action: 'change_role'; uid: string; role: UserRole }
  ): Promise<{ ok: boolean }> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireAdminAccount(db, authToken);

      if (payload.action === 'create') {
        const email = payload.email.trim().toLowerCase();
        const displayName = payload.display_name.trim();
        const password = payload.password;

        if (!email.includes('@') || displayName.length < 2 || password.length < 8) {
          throw new QueueEngineError(
            'Provide a valid email, display name (2+ chars), and password (8+ chars).',
            400,
            'INVALID_INPUT'
          );
        }
        if (db.staff_users.some((u) => u.email === email)) {
          throw new QueueEngineError(
            'A staff account with that email already exists.',
            409,
            'DUPLICATE_EMAIL'
          );
        }

        const created = await createSeededStaffAccount(
          `staff_${randomHex(4)}`,
          email,
          displayName.slice(0, 60),
          payload.role,
          password
        );
        db.staff_users.push(created);

        appendAuditEvent(db, {
          session_id: db.active_session.session_id,
          ticket_id: null,
          actor_id: actor.uid,
          actor_role: actor.role,
          action_type: 'STAFF_ACCOUNT_CREATED',
          previous_status: null,
          new_status: payload.role,
          idempotency_key: `staff_create_${created.uid}`,
          metadata: { target_uid: created.uid, role: payload.role },
        });

        writeDatabase(db);
        broadcastMutation();
        return { ok: true };
      }

      const target = db.staff_users.find((u) => u.uid === payload.uid);
      if (!target) {
        throw new QueueEngineError('Staff account not found.', 404, 'NOT_FOUND');
      }

      if (payload.action === 'toggle_active') {
        const nextActive = !target.active;
        if (!nextActive && target.role === UserRole.Admin) {
          const activeAdmins = db.staff_users.filter(
            (u) => u.role === UserRole.Admin && u.active
          );
          if (activeAdmins.length <= 1) {
            throw new QueueEngineError(
              'Cannot deactivate the only active Administrator account.',
              409,
              'LAST_ADMIN_PROTECTED'
            );
          }
        }
        target.active = nextActive;
        appendAuditEvent(db, {
          session_id: db.active_session.session_id,
          ticket_id: null,
          actor_id: actor.uid,
          actor_role: actor.role,
          action_type: nextActive ? 'STAFF_ACCESS_ENABLED' : 'STAFF_ACCESS_DISABLED',
          previous_status: String(!nextActive),
          new_status: String(nextActive),
          idempotency_key: `staff_toggle_${target.uid}_${Date.now()}`,
          metadata: { target_uid: target.uid },
        });
        writeDatabase(db);
        broadcastMutation();
        return { ok: true };
      }

      if (payload.action === 'change_role') {
        if (target.role === UserRole.Admin && payload.role !== UserRole.Admin) {
          const activeAdmins = db.staff_users.filter(
            (u) => u.role === UserRole.Admin && u.active
          );
          if (activeAdmins.length <= 1) {
            throw new QueueEngineError(
              'Cannot remove Administrator role from the only active Administrator.',
              409,
              'LAST_ADMIN_PROTECTED'
            );
          }
        }
        const prevRole = target.role;
        target.role = payload.role;
        appendAuditEvent(db, {
          session_id: db.active_session.session_id,
          ticket_id: null,
          actor_id: actor.uid,
          actor_role: actor.role,
          action_type: 'STAFF_ROLE_UPDATED',
          previous_status: prevRole,
          new_status: payload.role,
          idempotency_key: `staff_role_${target.uid}_${Date.now()}`,
          metadata: { target_uid: target.uid },
        });
        writeDatabase(db);
        broadcastMutation();
        return { ok: true };
      }

      throw new QueueEngineError('Unsupported staff management action.', 400, 'INVALID_ACTION');
    });
  },

  async seedDemoData(authToken: string): Promise<StaffQueueState> {
    return runAtomicTransaction(async () => {
      const db = await readDatabase();
      const actor = requireAdminAccount(db, authToken);

      const samples: Array<{
        name: string;
        category: RequestCategory;
        pwdReq: boolean;
        pwdVer: boolean;
      }> = [
        { name: '[DEMO] Juan Dela Cruz', category: RequestCategory.Birth, pwdReq: false, pwdVer: false },
        { name: '[DEMO] Maria Clara Bautista', category: RequestCategory.Marriage, pwdReq: true, pwdVer: false },
        { name: '[DEMO] Elena Magbanua', category: RequestCategory.Death, pwdReq: true, pwdVer: true },
        { name: '[DEMO] Roberto Villanueva', category: RequestCategory.Birth, pwdReq: false, pwdVer: false },
      ];

      const now = new Date().toISOString();
      for (const sample of samples) {
        const num = db.active_session.next_number;
        db.active_session.next_number += 1;
        db.tickets.push({
          ticket_id: `tkt_${randomHex(10)}`,
          citizen_token: randomHex(20),
          session_id: db.active_session.session_id,
          queue_number: num,
          display_number: formatQueueNumber(num),
          display_name: sample.name,
          request_category: sample.category,
          priority_requested: sample.pwdReq,
          priority_verified: sample.pwdVer,
          priority_status: sample.pwdReq
            ? sample.pwdVer
              ? PriorityVerificationStatus.Verified
              : PriorityVerificationStatus.Pending
            : PriorityVerificationStatus.None,
          priority_updated_by: sample.pwdVer ? `${actor.display_name} (Demo Seed)` : null,
          priority_updated_at: sample.pwdVer ? now : null,
          status: TicketStatus.Waiting,
          created_at: now,
          updated_at: now,
          called_at: null,
          served_at: null,
          skipped_at: null,
          registration_source: RegistrationSource.DemoSeed,
          is_demo: true,
        });
      }

      db.active_session.updated_at = now;

      appendAuditEvent(db, {
        session_id: db.active_session.session_id,
        ticket_id: null,
        actor_id: actor.uid,
        actor_role: actor.role,
        action_type: 'DEMO_SAMPLE_DATA_SEEDED',
        previous_status: null,
        new_status: null,
        idempotency_key: `demo_seed_${Date.now()}`,
        metadata: { count: samples.length, development_demo: true },
      });

      const nextState = computeStaffState(db);
      writeDatabase(db);
      broadcastMutation();
      return nextState;
    });
  },
};
