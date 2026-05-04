export type UserRole = "admin" | "profissional";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
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

export interface ResourceRecord {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
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
  status: "confirmed" | "tentative" | "cancelled";
  createdAt: string;
  updatedAt: string;
  recurrence: EventRecurrenceRecord | null;
  participants: Array<{ userId: string; responseStatus: "needs_action" | "accepted" | "declined" | "tentative" }>;
  resources: ResourceRecord[];
  sync: {
    eventId: string;
    externalProvider: string | null;
    externalEventId: string | null;
    syncDirection: "local_to_external" | "external_to_local" | "bidirectional";
    syncStatus: "pending" | "synced" | "error";
    lastSyncedAt: string | null;
    syncError: string | null;
    syncPayload: Record<string, unknown>;
  };
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: UserRecord;
}
