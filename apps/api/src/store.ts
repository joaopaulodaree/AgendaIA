import type { Pool, PoolClient, QueryResultRow } from "pg";
import { createPool, withTransaction } from "./db.js";
import { hashPassword } from "./auth.js";
import type {
  CreateEventInput,
  CreateSessionInput,
  CreateResourceInput,
  CreateUserInput,
  EventRecord,
  EventSyncRecord,
  ParticipantStatus,
  ResourceRecord,
  SessionRecord,
  UserRecord,
} from "./domain.js";

type DbExecutor = Pool | PoolClient;

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return new Date(value).toISOString();
  }

  throw new Error("Expected a date-like value");
}

function mapUser(row: QueryResultRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapSession(row: QueryResultRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: toIsoString(row.expires_at),
    revokedAt: row.revoked_at ? toIsoString(row.revoked_at) : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapResource(row: QueryResultRow): ResourceRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEventSync(row: QueryResultRow): EventSyncRecord {
  return {
    eventId: row.id,
    externalProvider: row.external_provider ?? null,
    externalEventId: row.external_event_id ?? null,
    syncDirection: row.sync_direction,
    syncStatus: row.sync_status,
    lastSyncedAt: row.last_synced_at ? toIsoString(row.last_synced_at) : null,
    syncError: row.sync_error ?? null,
    syncPayload: row.sync_payload ?? {},
  };
}

function mapEventRow(row: QueryResultRow): EventRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description ?? null,
    startsAt: toIsoString(row.starts_at),
    endsAt: toIsoString(row.ends_at),
    timezone: row.timezone,
    isAllDay: row.is_all_day,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    recurrence: row.recurrence_event_id
      ? {
          eventId: row.recurrence_event_id,
          rrule: row.rrule,
          timezone: row.recurrence_timezone,
          dtstart: toIsoString(row.dtstart),
          untilAt: row.until_at ? toIsoString(row.until_at) : null,
          count: row.recurrence_count ?? null,
          exdates: (row.exdates ?? []).map((date: unknown) => toIsoString(date)),
        }
      : null,
    participants: row.participants ?? [],
    resources: row.resources ?? [],
    sync: mapEventSync(row),
  };
}

async function loadEventRelations(executor: DbExecutor, eventIds: string[]) {
  if (eventIds.length === 0) {
    return new Map<string, {
      participants: EventRecord["participants"];
      resources: ResourceRecord[];
      recurrenceRow: QueryResultRow | null;
    }>();
  }

  const [participantsResult, resourcesResult, recurrenceResult] = await Promise.all([
    executor.query<{
      event_id: string;
      user_id: string;
      response_status: ParticipantStatus;
    }>(
      `
      SELECT event_id, user_id, response_status
      FROM app_event_participants
      WHERE event_id = ANY($1::uuid[])
      ORDER BY event_id, user_id
      `,
      [eventIds],
    ),
    executor.query<{
      event_id: string;
      id: string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `
      SELECT er.event_id, r.id, r.name, r.description, r.created_at, r.updated_at
      FROM app_event_resources er
      JOIN app_resources r ON r.id = er.resource_id
      WHERE er.event_id = ANY($1::uuid[])
      ORDER BY er.event_id, r.name
      `,
      [eventIds],
    ),
    executor.query<{
      event_id: string;
      rrule: string;
      timezone: string;
      dtstart: Date;
      until_at: Date | null;
      count: number | null;
      exdates: Date[];
    }>(
      `
      SELECT event_id, rrule, timezone, dtstart, until_at, count, exdates
      FROM app_event_recurrence
      WHERE event_id = ANY($1::uuid[])
      `,
      [eventIds],
    ),
  ]);

  const grouped = new Map<string, {
    participants: EventRecord["participants"];
    resources: ResourceRecord[];
    recurrenceRow: QueryResultRow | null;
  }>();

  for (const eventId of eventIds) {
    grouped.set(eventId, {
      participants: [],
      resources: [],
      recurrenceRow: null,
    });
  }

  for (const row of participantsResult.rows) {
    grouped.get(row.event_id)?.participants.push({
      userId: row.user_id,
      responseStatus: row.response_status,
    });
  }

  for (const row of resourcesResult.rows) {
    grouped.get(row.event_id)?.resources.push(mapResource(row));
  }

  for (const row of recurrenceResult.rows) {
    grouped.set(row.event_id, {
      ...(grouped.get(row.event_id) ?? {
        participants: [],
        resources: [],
      }),
      recurrenceRow: row as unknown as QueryResultRow,
    });
  }

  return grouped;
}

export class AgendaStore {
  constructor(private readonly pool: Pool = createPool()) {}

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const result = await this.pool.query(
      `
      INSERT INTO app_users (email, display_name, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [input.email, input.displayName, input.passwordHash, input.role],
    );

    return mapUser(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM app_users
      WHERE email = $1
      `,
      [email],
    );

    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async listUsers(): Promise<UserRecord[]> {
    const result = await this.pool.query(
      `
      SELECT *
      FROM app_users
      ORDER BY created_at ASC
      `,
    );

    return result.rows.map(mapUser);
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const result = await this.pool.query(
      `
      INSERT INTO app_sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [input.userId, input.tokenHash, input.expiresAt],
    );

    return mapSession(result.rows[0]);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<{
    session: SessionRecord;
    user: UserRecord;
  } | null> {
    const result = await this.pool.query(
      `
      SELECT
        s.*,
        u.id AS user_id,
        u.email,
        u.display_name,
        u.password_hash,
        u.role,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at
      FROM app_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      `,
      [tokenHash],
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      session: mapSession(row),
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: toIsoString(row.user_created_at),
        updatedAt: toIsoString(row.user_updated_at),
      },
    };
  }

  async revokeSessionByTokenHash(tokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `
      UPDATE app_sessions
      SET revoked_at = now(), updated_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL
      `,
      [tokenHash],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async createResource(input: CreateResourceInput): Promise<ResourceRecord> {
    const result = await this.pool.query(
      `
      INSERT INTO app_resources (name, description)
      VALUES ($1, $2)
      RETURNING *
      `,
      [input.name, input.description ?? null],
    );

    return mapResource(result.rows[0]);
  }

  async createEvent(input: CreateEventInput): Promise<EventRecord> {
    return withTransaction(this.pool, async (client) => {
      const eventResult = await client.query(
        `
        INSERT INTO app_events (
          owner_user_id,
          title,
          description,
          starts_at,
          ends_at,
          timezone,
          is_all_day,
          status,
          external_provider,
          external_event_id,
          sync_direction,
          sync_status,
          last_synced_at,
          sync_error,
          sync_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
        `,
        [
          input.ownerUserId,
          input.title,
          input.description ?? null,
          input.startsAt,
          input.endsAt,
          input.timezone ?? "UTC",
          input.isAllDay ?? false,
          input.status ?? "confirmed",
          input.sync?.externalProvider ?? null,
          input.sync?.externalEventId ?? null,
          input.sync?.syncDirection ?? "bidirectional",
          input.sync?.syncStatus ?? "pending",
          input.sync?.lastSyncedAt ?? null,
          input.sync?.syncError ?? null,
          JSON.stringify(input.sync?.syncPayload ?? {}),
        ],
      );

      const eventRow = eventResult.rows[0];

      if (input.recurrence) {
        await client.query(
          `
          INSERT INTO app_event_recurrence (
            event_id,
            rrule,
            timezone,
            dtstart,
            until_at,
            count,
            exdates
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            eventRow.id,
            input.recurrence.rrule,
            input.recurrence.timezone,
            input.recurrence.dtstart,
            input.recurrence.untilAt ?? null,
            input.recurrence.count ?? null,
            input.recurrence.exdates ?? [],
          ],
        );
      }

      if (input.participantIds?.length) {
        await client.query(
          `
          INSERT INTO app_event_participants (event_id, user_id)
          SELECT $1, unnest($2::uuid[])
          ON CONFLICT DO NOTHING
          `,
          [eventRow.id, input.participantIds],
        );
      }

      if (input.resourceIds?.length) {
        await client.query(
          `
          INSERT INTO app_event_resources (event_id, resource_id)
          SELECT $1, unnest($2::uuid[])
          ON CONFLICT DO NOTHING
          `,
          [eventRow.id, input.resourceIds],
        );
      }

      const loaded = await this.getEventById(client, eventRow.id);
      if (!loaded) {
        throw new Error("Failed to reload created event");
      }

      return loaded;
    });
  }

  async updateEvent(eventId: string, input: Partial<CreateEventInput>): Promise<EventRecord> {
    return withTransaction(this.pool, async (client) => {
      const updateResult = await client.query(
        `
        UPDATE app_events
        SET
          title = COALESCE($2, title),
          description = COALESCE($3, description),
          starts_at = COALESCE($4, starts_at),
          ends_at = COALESCE($5, ends_at),
          timezone = COALESCE($6, timezone),
          is_all_day = COALESCE($7, is_all_day),
          status = COALESCE($8, status),
          external_provider = COALESCE($9, external_provider),
          external_event_id = COALESCE($10, external_event_id),
          sync_direction = COALESCE($11, sync_direction),
          sync_status = COALESCE($12, sync_status),
          last_synced_at = COALESCE($13, last_synced_at),
          sync_error = COALESCE($14, sync_error),
          sync_payload = COALESCE($15, sync_payload),
          updated_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [
          eventId,
          input.title ?? null,
          input.description ?? null,
          input.startsAt ?? null,
          input.endsAt ?? null,
          input.timezone ?? null,
          typeof input.isAllDay === "boolean" ? input.isAllDay : null,
          input.status ?? null,
          input.sync?.externalProvider ?? null,
          input.sync?.externalEventId ?? null,
          input.sync?.syncDirection ?? null,
          input.sync?.syncStatus ?? null,
          input.sync?.lastSyncedAt ?? null,
          input.sync?.syncError ?? null,
          input.sync?.syncPayload ? JSON.stringify(input.sync.syncPayload) : null,
        ],
      );

      if (updateResult.rowCount === 0) {
        throw new Error(`Event ${eventId} not found`);
      }

      if (input.recurrence) {
        await client.query(
          `
          INSERT INTO app_event_recurrence (
            event_id,
            rrule,
            timezone,
            dtstart,
            until_at,
            count,
            exdates
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (event_id)
          DO UPDATE SET
            rrule = EXCLUDED.rrule,
            timezone = EXCLUDED.timezone,
            dtstart = EXCLUDED.dtstart,
            until_at = EXCLUDED.until_at,
            count = EXCLUDED.count,
            exdates = EXCLUDED.exdates
          `,
          [
            eventId,
            input.recurrence.rrule,
            input.recurrence.timezone,
            input.recurrence.dtstart,
            input.recurrence.untilAt ?? null,
            input.recurrence.count ?? null,
            input.recurrence.exdates ?? [],
          ],
        );
      }

      if (input.participantIds) {
        await client.query("DELETE FROM app_event_participants WHERE event_id = $1", [eventId]);
        if (input.participantIds.length) {
          await client.query(
            `
            INSERT INTO app_event_participants (event_id, user_id)
            SELECT $1, unnest($2::uuid[])
            `,
            [eventId, input.participantIds],
          );
        }
      }

      if (input.resourceIds) {
        await client.query("DELETE FROM app_event_resources WHERE event_id = $1", [eventId]);
        if (input.resourceIds.length) {
          await client.query(
            `
            INSERT INTO app_event_resources (event_id, resource_id)
            SELECT $1, unnest($2::uuid[])
            `,
            [eventId, input.resourceIds],
          );
        }
      }

      const loaded = await this.getEventById(client, eventId);
      if (!loaded) {
        throw new Error(`Event ${eventId} not found after update`);
      }

      return loaded;
    });
  }

  async deleteEvent(eventId: string): Promise<boolean> {
    const result = await this.pool.query(
      `
      DELETE FROM app_events
      WHERE id = $1
      `,
      [eventId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async listEventsForRange(input: {
    ownerUserId?: string;
    startsAt: string;
    endsAt: string;
  }): Promise<EventRecord[]> {
    const query = input.ownerUserId
      ? `
        SELECT *
        FROM app_events
        WHERE owner_user_id = $1
          AND starts_at < $3
          AND ends_at > $2
        ORDER BY starts_at ASC
        `
      : `
        SELECT *
        FROM app_events
        WHERE starts_at < $2
          AND ends_at > $1
        ORDER BY starts_at ASC
        `;

    const params = input.ownerUserId
      ? [input.ownerUserId, input.startsAt, input.endsAt]
      : [input.startsAt, input.endsAt];

    const result = await this.pool.query(query, params);
    const eventIds = result.rows.map((row) => row.id);
    const relations = await loadEventRelations(this.pool, eventIds);

    return result.rows.map((row) => {
      const relation = relations.get(row.id);
      return mapEventRow({
        ...row,
        participants: relation?.participants ?? [],
        resources: relation?.resources ?? [],
        recurrence_event_id: relation?.recurrenceRow?.event_id ?? null,
        rrule: relation?.recurrenceRow?.rrule ?? null,
        recurrence_timezone: relation?.recurrenceRow?.timezone ?? null,
        dtstart: relation?.recurrenceRow?.dtstart ?? null,
        until_at: relation?.recurrenceRow?.until_at ?? null,
        recurrence_count: relation?.recurrenceRow?.count ?? null,
        exdates: relation?.recurrenceRow?.exdates ?? null,
      });
    });
  }

  async getEventById(clientOrPool: DbExecutor, eventId: string): Promise<EventRecord | null> {
    const result = await clientOrPool.query(
      `
      SELECT *
      FROM app_events
      WHERE id = $1
      `,
      [eventId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const relationMap = await loadEventRelations(clientOrPool, [eventId]);
    const row = result.rows[0];
    const relation = relationMap.get(eventId);

    return mapEventRow({
      ...row,
      participants: relation?.participants ?? [],
      resources: relation?.resources ?? [],
      recurrence_event_id: relation?.recurrenceRow?.event_id ?? null,
      rrule: relation?.recurrenceRow?.rrule ?? null,
      recurrence_timezone: relation?.recurrenceRow?.timezone ?? null,
      dtstart: relation?.recurrenceRow?.dtstart ?? null,
      until_at: relation?.recurrenceRow?.until_at ?? null,
      recurrence_count: relation?.recurrenceRow?.count ?? null,
      exdates: relation?.recurrenceRow?.exdates ?? null,
    });
  }

  async resetForSeed(): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(`
        TRUNCATE TABLE
          app_event_resources,
          app_event_participants,
          app_event_recurrence,
          app_events,
          app_resources,
          app_users
        RESTART IDENTITY CASCADE
      `);
    });
  }

  async seedDemoData(): Promise<{
    admin: UserRecord;
    professional: UserRecord;
    resource: ResourceRecord;
    event: EventRecord;
  }> {
    await this.resetForSeed();

    const admin = await this.createUser({
      email: "admin@agendaia.local",
      displayName: "Admin",
      passwordHash: await hashPassword("admin123"),
      role: "admin",
    });

    const professional = await this.createUser({
      email: "profissional@agendaia.local",
      displayName: "Profissional",
      passwordHash: await hashPassword("profissional123"),
      role: "profissional",
    });

    const resource = await this.createResource({
      name: "Sala 1",
      description: "Sala principal",
    });

    const event = await this.createEvent({
      ownerUserId: professional.id,
      title: "Consulta inicial",
      description: "Evento de demonstração",
      startsAt: new Date("2026-05-05T10:00:00.000Z").toISOString(),
      endsAt: new Date("2026-05-05T10:30:00.000Z").toISOString(),
      timezone: "America/Sao_Paulo",
      participantIds: [admin.id, professional.id],
      resourceIds: [resource.id],
      recurrence: {
        rrule: "FREQ=WEEKLY;COUNT=4",
        timezone: "America/Sao_Paulo",
        dtstart: new Date("2026-05-05T10:00:00.000Z").toISOString(),
        count: 4,
      },
      sync: {
        externalProvider: "google",
        externalEventId: "demo-google-event-id",
        syncDirection: "bidirectional",
        syncStatus: "synced",
        lastSyncedAt: new Date("2026-05-04T12:00:00.000Z").toISOString(),
        syncPayload: {
          source: "seed",
        },
      },
    });

    return { admin, professional, resource, event };
  }
}
