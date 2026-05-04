export const userRoles = ["admin", "profissional"] as const;
export type UserRole = (typeof userRoles)[number];

export const eventStatuses = ["confirmed", "tentative", "cancelled"] as const;
export type EventStatus = (typeof eventStatuses)[number];

export const syncDirections = ["local_to_external", "external_to_local", "bidirectional"] as const;
export type SyncDirection = (typeof syncDirections)[number];

export const syncStatuses = ["pending", "synced", "error"] as const;
export type SyncStatus = (typeof syncStatuses)[number];

export const participantStatuses = ["needs_action", "accepted", "declined", "tentative"] as const;
export type ParticipantStatus = (typeof participantStatuses)[number];

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecurrenceRecord {
  eventId: string;
  rrule: string;
  timezone: string;
  dtstart: string;
  untilAt: string | null;
  count: number | null;
  exdates: string[];
}

export interface EventSyncRecord {
  eventId: string;
  externalProvider: string | null;
  externalEventId: string | null;
  syncDirection: SyncDirection;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  syncError: string | null;
  syncPayload: Record<string, unknown>;
}

export interface EventRecord {
  id: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  isAllDay: boolean;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
  recurrence: EventRecurrenceRecord | null;
  participants: Array<{ userId: string; responseStatus: ParticipantStatus }>;
  resources: ResourceRecord[];
  sync: EventSyncRecord;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: string;
}

export interface CreateResourceInput {
  name: string;
  description?: string | null;
}

export interface CreateEventInput {
  ownerUserId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  isAllDay?: boolean;
  status?: EventStatus;
  recurrence?: {
    rrule: string;
    timezone: string;
    dtstart: string;
    untilAt?: string | null;
    count?: number | null;
    exdates?: string[];
  } | null;
  participantIds?: string[];
  resourceIds?: string[];
  sync?: {
    externalProvider?: string | null;
    externalEventId?: string | null;
    syncDirection?: SyncDirection;
    syncStatus?: SyncStatus;
    lastSyncedAt?: string | null;
    syncError?: string | null;
    syncPayload?: Record<string, unknown>;
  } | null;
}
