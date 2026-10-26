import { useEffect, useRef, useState } from 'react';
import {
  localQueueEngine,
  QueueEngineError,
  subscribeToQueueChanges,
} from './localQueueEngine';
import type {
  CitizenTicketStatusPayload,
  PublicQueueState,
  StaffQueueState,
} from '../types/queue';

export { QueueEngineError as ApiRequestError };

export function createIdempotencyKey(prefix = 'req'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const queueApi = localQueueEngine;

export type RealtimeConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

/**
 * Subscribes to instant local & cross-tab updates via BroadcastChannel + localStorage events.
 * Requires zero external APIs or backend servers.
 */
export function useRealtimeSubscription(params: {
  channel: 'public' | 'staff' | 'ticket';
  authToken?: string | null;
  ticketId?: string | null;
  citizenToken?: string | null;
  onPublicState?: (state: PublicQueueState) => void;
  onStaffState?: (state: StaffQueueState) => void;
  onTicketState?: (state: CitizenTicketStatusPayload) => void;
  onAuthExpired?: () => void;
}): RealtimeConnectionStatus {
  const [status, setStatus] = useState<RealtimeConnectionStatus>('connected');
  const callbacksRef = useRef(params);
  callbacksRef.current = params;

  useEffect(() => {
    let active = true;

    const syncCurrentProjection = async () => {
      if (!active) return;
      try {
        const pubState = await localQueueEngine.getPublicState();
        if (!active) return;
        callbacksRef.current.onPublicState?.(pubState);

        if (params.channel === 'staff' && params.authToken) {
          try {
            const staffState = await localQueueEngine.getStaffState(params.authToken);
            if (active) callbacksRef.current.onStaffState?.(staffState);
          } catch (err) {
            if (err instanceof QueueEngineError && err.status === 401) {
              callbacksRef.current.onAuthExpired?.();
            }
          }
        } else if (
          params.channel === 'ticket' &&
          params.ticketId &&
          params.citizenToken
        ) {
          try {
            const ticketState = await localQueueEngine.getCitizenTicketStatus(
              params.ticketId,
              params.citizenToken
            );
            if (active) callbacksRef.current.onTicketState?.(ticketState);
          } catch {
            // Ticket lookup error handled by caller view
          }
        }

        if (active) setStatus('connected');
      } catch {
        if (active) setStatus('reconnecting');
      }
    };

    void syncCurrentProjection();
    const unsubscribe = subscribeToQueueChanges(() => {
      void syncCurrentProjection();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [params.channel, params.authToken, params.ticketId, params.citizenToken]);

  return status;
}
