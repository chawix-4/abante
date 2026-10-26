export enum RequestCategory {
  Birth = 'birth',
  Marriage = 'marriage',
  Death = 'death',
}

export enum TicketStatus {
  Waiting = 'waiting',
  Serving = 'serving',
  Served = 'served',
  Skipped = 'skipped',
}

export enum PriorityVerificationStatus {
  None = 'none',
  Pending = 'pending',
  Verified = 'verified',
  Declined = 'declined',
}

export enum PriorityPolicyMode {
  VerifiedOnly = 'verified_only',
  IncludeSelfDeclared = 'include_self_declared',
}

export enum SessionStatus {
  Open = 'open',
  RegistrationClosed = 'registration_closed',
  Closed = 'closed',
}

export enum UserRole {
  Staff = 'staff',
  Admin = 'admin',
}

export enum RegistrationSource {
  CitizenWeb = 'citizen_web',
  CitizenQR = 'citizen_qr',
  StaffWalkIn = 'staff_walk_in',
  DemoSeed = 'demo_seed',
}

export const CATEGORY_LABELS: Record<RequestCategory, string> = {
  [RequestCategory.Birth]: 'Birth Certificate',
  [RequestCategory.Marriage]: 'Marriage Certificate',
  [RequestCategory.Death]: 'Death Certificate',
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  [TicketStatus.Waiting]: 'Waiting',
  [TicketStatus.Serving]: 'Serving',
  [TicketStatus.Served]: 'Served',
  [TicketStatus.Skipped]: 'Skipped',
};

export interface QueueSession {
  session_id: string;
  service_name: string;
  date: string;
  status: SessionStatus;
  next_number: number;
  current_serving_ticket_id: string | null;
  priority_policy: PriorityPolicyMode;
  created_at: string;
  updated_at: string;
}

export interface QueueTicket {
  ticket_id: string;
  session_id: string;
  queue_number: number;
  display_number: string;
  display_name: string;
  request_category: RequestCategory;
  priority_requested: boolean;
  priority_verified: boolean;
  priority_status: PriorityVerificationStatus;
  priority_updated_by: string | null;
  priority_updated_at: string | null;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  called_at: string | null;
  served_at: string | null;
  skipped_at: string | null;
  registration_source: RegistrationSource;
  is_demo: boolean;
  /** Computed authoritative dispatch rank among Waiting tickets (1-based), or null if not Waiting */
  queue_position: number | null;
}

export interface PublicTicketSummary {
  display_number: string;
  request_category: RequestCategory;
  called_at?: string | null;
}

export interface PublicQueueState {
  session: {
    session_id: string;
    service_name: string;
    date: string;
    status: SessionStatus;
    updated_at: string;
  };
  now_serving: PublicTicketSummary | null;
  upcoming: PublicTicketSummary[];
  total_waiting: number;
  server_time: string;
}

export interface CitizenTicketReceipt {
  ticket_id: string;
  citizen_token: string;
  session_id: string;
  display_number: string;
  request_category: RequestCategory;
  created_at: string;
}

export interface CitizenTicketStatusPayload {
  ticket_id: string;
  session_id: string;
  is_active_session: boolean;
  display_number: string;
  request_category: RequestCategory;
  status: TicketStatus;
  priority_requested: boolean;
  priority_verified: boolean;
  priority_status: PriorityVerificationStatus;
  ahead_count: number | null;
  queue_position: number | null;
  now_serving_number: string | null;
  created_at: string;
  updated_at: string;
  called_at: string | null;
  served_at: string | null;
  skipped_at: string | null;
}

export interface QueueCounts {
  waiting: number;
  serving: number;
  served: number;
  skipped: number;
  total: number;
}

export interface StaffQueueState {
  session: QueueSession;
  currently_serving: QueueTicket | null;
  next_eligible_ticket: QueueTicket | null;
  tickets: QueueTicket[];
  counts: QueueCounts;
  server_time: string;
}

export interface AuthenticatedStaffUser {
  uid: string;
  email: string;
  display_name: string;
  role: UserRole;
  active: boolean;
}

export interface AuditEvent {
  event_id: string;
  session_id: string;
  ticket_id: string | null;
  actor_id: string;
  actor_role: string;
  action_type: string;
  previous_status: string | null;
  new_status: string | null;
  event_timestamp: string;
  idempotency_key: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface QueueSessionHistory {
  session_id: string;
  service_name: string;
  session_date: string;
  total_registered: number;
  total_served: number;
  total_skipped: number;
  unserved_at_close: number;
  opened_at: string;
  closed_at: string;
  closed_by: string;
}

export interface AdminOverviewPayload {
  staff_accounts: AuthenticatedStaffUser[];
  audit_events: AuditEvent[];
  session_history: QueueSessionHistory[];
  archived_tickets_count: number;
}

export interface AppRuntimeConfig {
  app_url: string;
  service_name: string;
  prototype_mode: boolean;
}
