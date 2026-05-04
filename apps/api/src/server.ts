import http from "node:http";
import { createPool } from "./db.js";
import { createSessionToken, getSessionExpiry, hashPassword, hashSessionToken, verifyPassword } from "./auth.js";
import { AgendaStore } from "./store.js";
import type { CreateEventInput, EventRecord, UserRecord, UserRole } from "./domain.js";

const port = Number(process.env.PORT ?? 3001);
const pool = createPool();
const store = new AgendaStore(pool);
const allowedOrigin = process.env.CORS_ORIGIN ?? "*";

function setCorsHeaders(res: http.ServerResponse, origin?: string) {
  res.setHeader("access-control-allow-origin", allowedOrigin === "*" ? "*" : origin ?? allowedOrigin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-max-age", "86400");
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  setCorsHeaders(res, undefined);
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res: http.ServerResponse) {
  setCorsHeaders(res, undefined);
  res.writeHead(204);
  res.end();
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Scheduling conflict detected");
}

function sanitizeUser(user: UserRecord) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8");

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON");
  }
}

function getBearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Field ${field} is required`);
  }

  return value.trim();
}

function assertRole(role: unknown): UserRole {
  if (role === "admin" || role === "profissional") {
    return role;
  }

  throw new Error("Invalid role");
}

function parseDateTime(value: unknown, field: string): string {
  const raw = assertString(value, field);
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Field ${field} must be a valid date-time`);
  }

  return parsed.toISOString();
}

function parseOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  throw new Error("Expected a string or null");
}

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("Expected an array");
  }

  return value.map((item) => assertString(item, "array item"));
}

function parseSyncDirection(value: unknown) {
  if (value === "local_to_external" || value === "external_to_local" || value === "bidirectional") {
    return value;
  }

  return undefined;
}

function parseSyncStatus(value: unknown) {
  if (value === "pending" || value === "synced" || value === "error") {
    return value;
  }

  return undefined;
}

function parseOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error("Expected a number or null");
}

function parseEventPayload(body: Record<string, unknown>): CreateEventInput {
  const participantIds = parseStringArray(body.participantIds);
  const resourceIds = parseStringArray(body.resourceIds);
  const recurrence = body.recurrence;
  const sync = body.sync;

  return {
    ownerUserId: assertString(body.ownerUserId, "ownerUserId"),
    title: assertString(body.title, "title"),
    description: parseOptionalString(body.description),
    startsAt: parseDateTime(body.startsAt, "startsAt"),
    endsAt: parseDateTime(body.endsAt, "endsAt"),
    timezone: parseOptionalString(body.timezone) ?? "UTC",
    isAllDay: typeof body.isAllDay === "boolean" ? body.isAllDay : false,
    status: body.status === "confirmed" || body.status === "tentative" || body.status === "cancelled"
      ? body.status
      : undefined,
    recurrence:
      recurrence && typeof recurrence === "object" && !Array.isArray(recurrence)
        ? {
            rrule: assertString((recurrence as Record<string, unknown>).rrule, "recurrence.rrule"),
            timezone:
              parseOptionalString((recurrence as Record<string, unknown>).timezone) ??
              "UTC",
            dtstart: parseDateTime((recurrence as Record<string, unknown>).dtstart, "recurrence.dtstart"),
            untilAt: parseOptionalString((recurrence as Record<string, unknown>).untilAt) ?? null,
            count: parseOptionalNumber((recurrence as Record<string, unknown>).count) ?? null,
            exdates: parseStringArray((recurrence as Record<string, unknown>).exdates) ?? [],
          }
        : null,
    participantIds: participantIds ?? [],
    resourceIds: resourceIds ?? [],
    sync:
      sync && typeof sync === "object" && !Array.isArray(sync)
        ? {
            externalProvider: parseOptionalString((sync as Record<string, unknown>).externalProvider) ?? null,
            externalEventId: parseOptionalString((sync as Record<string, unknown>).externalEventId) ?? null,
            syncDirection: parseSyncDirection((sync as Record<string, unknown>).syncDirection),
            syncStatus: parseSyncStatus((sync as Record<string, unknown>).syncStatus),
            lastSyncedAt:
              parseOptionalString((sync as Record<string, unknown>).lastSyncedAt) ?? null,
            syncError: parseOptionalString((sync as Record<string, unknown>).syncError) ?? null,
            syncPayload:
              (sync as Record<string, unknown>).syncPayload &&
              typeof (sync as Record<string, unknown>).syncPayload === "object" &&
              !Array.isArray((sync as Record<string, unknown>).syncPayload)
                ? ((sync as Record<string, unknown>).syncPayload as Record<string, unknown>)
                : {},
          }
        : null,
  };
}

function parseEventUpdatePayload(body: Record<string, unknown>): Partial<CreateEventInput> {
  const payload: Partial<CreateEventInput> = {};

  if ("ownerUserId" in body) {
    payload.ownerUserId = assertString(body.ownerUserId, "ownerUserId");
  }
  if ("title" in body) {
    payload.title = assertString(body.title, "title");
  }
  if ("description" in body) {
    payload.description = parseOptionalString(body.description);
  }
  if ("startsAt" in body) {
    payload.startsAt = parseDateTime(body.startsAt, "startsAt");
  }
  if ("endsAt" in body) {
    payload.endsAt = parseDateTime(body.endsAt, "endsAt");
  }
  if ("timezone" in body) {
    payload.timezone = parseOptionalString(body.timezone) ?? undefined;
  }
  if ("isAllDay" in body) {
    payload.isAllDay = typeof body.isAllDay === "boolean" ? body.isAllDay : undefined;
  }
  if ("status" in body) {
    payload.status =
      body.status === "confirmed" || body.status === "tentative" || body.status === "cancelled"
        ? body.status
        : undefined;
  }
  if ("participantIds" in body) {
    payload.participantIds = parseStringArray(body.participantIds) ?? [];
  }
  if ("resourceIds" in body) {
    payload.resourceIds = parseStringArray(body.resourceIds) ?? [];
  }
  if ("recurrence" in body) {
    const recurrence = body.recurrence;
    payload.recurrence =
      recurrence && typeof recurrence === "object" && !Array.isArray(recurrence)
        ? {
            rrule: assertString((recurrence as Record<string, unknown>).rrule, "recurrence.rrule"),
            timezone:
              parseOptionalString((recurrence as Record<string, unknown>).timezone) ??
              "UTC",
            dtstart: parseDateTime((recurrence as Record<string, unknown>).dtstart, "recurrence.dtstart"),
            untilAt: parseOptionalString((recurrence as Record<string, unknown>).untilAt) ?? null,
            count: parseOptionalNumber((recurrence as Record<string, unknown>).count) ?? null,
            exdates: parseStringArray((recurrence as Record<string, unknown>).exdates) ?? [],
          }
        : null;
  }
  if ("sync" in body) {
    const sync = body.sync;
    payload.sync =
      sync && typeof sync === "object" && !Array.isArray(sync)
        ? {
            externalProvider: parseOptionalString((sync as Record<string, unknown>).externalProvider) ?? null,
            externalEventId: parseOptionalString((sync as Record<string, unknown>).externalEventId) ?? null,
            syncDirection: parseSyncDirection((sync as Record<string, unknown>).syncDirection),
            syncStatus: parseSyncStatus((sync as Record<string, unknown>).syncStatus),
            lastSyncedAt:
              parseOptionalString((sync as Record<string, unknown>).lastSyncedAt) ?? null,
            syncError: parseOptionalString((sync as Record<string, unknown>).syncError) ?? null,
            syncPayload:
              (sync as Record<string, unknown>).syncPayload &&
              typeof (sync as Record<string, unknown>).syncPayload === "object" &&
              !Array.isArray((sync as Record<string, unknown>).syncPayload)
                ? ((sync as Record<string, unknown>).syncPayload as Record<string, unknown>)
                : {},
          }
        : null;
  }

  return payload;
}

async function getAccessibleEvent(
  auth: { user: UserRecord } | null,
  eventId: string,
): Promise<EventRecord | null> {
  const event = await store.getEventById(pool, eventId);
  if (!event || !auth) {
    return null;
  }

  if (auth.user.role === "admin" || event.ownerUserId === auth.user.id) {
    return event;
  }

  return null;
}

async function requireAuth(req: http.IncomingMessage) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const session = await store.findSessionByTokenHash(tokenHash);
  if (!session) {
    return null;
  }

  return {
    token,
    tokenHash,
    session: session.session,
    user: session.user,
  };
}

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = await readJsonBody(req);
    const email = assertString(body.email, "email").toLowerCase();
    const password = assertString(body.password, "password");

    const user = await store.findUserByEmail(email);
    if (!user) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return;
    }

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      sendJson(res, 401, { error: "Invalid credentials" });
      return;
    }

    const token = createSessionToken();
    const session = await store.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: getSessionExpiry().toISOString(),
    });

    sendJson(res, 200, {
      token,
      expiresAt: session.expiresAt,
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendJson(res, isConflictError(error) ? 409 : 400, {
      error: error instanceof Error ? error.message : "Bad Request",
    });
  }
}

async function handleMe(req: http.IncomingMessage, res: http.ServerResponse) {
  const auth = await requireAuth(req);

  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  sendJson(res, 200, {
    user: sanitizeUser(auth.user),
    session: {
      id: auth.session.id,
      expiresAt: auth.session.expiresAt,
      revokedAt: auth.session.revokedAt,
      createdAt: auth.session.createdAt,
      updatedAt: auth.session.updatedAt,
    },
  });
}

async function handleLogout(req: http.IncomingMessage, res: http.ServerResponse) {
  const token = getBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const revoked = await store.revokeSessionByTokenHash(hashSessionToken(token));

  sendJson(res, revoked ? 200 : 200, {
    ok: true,
  });
}

async function handleAdminUsers(req: http.IncomingMessage, res: http.ServerResponse) {
  const auth = await requireAuth(req);
  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (auth.user.role !== "admin") {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const users = await store.listUsers();
  sendJson(res, 200, {
    users: users.map(sanitizeUser),
  });
}

async function handleEventsList(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const auth = await requireAuth(req);
  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const startsAt = url.searchParams.get("startsAt");
  const endsAt = url.searchParams.get("endsAt");

  if (!startsAt || !endsAt) {
    sendJson(res, 400, { error: "startsAt and endsAt are required" });
    return;
  }

  const ownerUserId = auth.user.role === "admin"
    ? url.searchParams.get("ownerUserId") ?? undefined
    : auth.user.id;

  const events = await store.listEventsForRange({
    ownerUserId,
    startsAt: parseDateTime(startsAt, "startsAt"),
    endsAt: parseDateTime(endsAt, "endsAt"),
  });

  sendJson(res, 200, { events });
}

async function handleEventsCreate(req: http.IncomingMessage, res: http.ServerResponse) {
  const auth = await requireAuth(req);
  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payload = parseEventPayload({
      ...body,
      ownerUserId: auth.user.role === "admin" ? body.ownerUserId ?? auth.user.id : auth.user.id,
    });

    const event = await store.createEvent(payload);
    sendJson(res, 201, { event });
  } catch (error) {
    sendJson(res, isConflictError(error) ? 409 : 400, {
      error: error instanceof Error ? error.message : "Bad Request",
    });
  }
}

async function handleEventRead(req: http.IncomingMessage, res: http.ServerResponse, eventId: string) {
  const auth = await requireAuth(req);
  const event = await getAccessibleEvent(auth, eventId);

  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (!event) {
    sendJson(res, 404, { error: "Not Found" });
    return;
  }

  sendJson(res, 200, { event });
}

async function handleEventUpdate(req: http.IncomingMessage, res: http.ServerResponse, eventId: string) {
  const auth = await requireAuth(req);
  const event = await getAccessibleEvent(auth, eventId);

  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (!event) {
    sendJson(res, 404, { error: "Not Found" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payload = parseEventUpdatePayload(body);

    if (payload.ownerUserId && auth.user.role !== "admin") {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const updated = await store.updateEvent(eventId, payload);
    sendJson(res, 200, { event: updated });
  } catch (error) {
    sendJson(res, isConflictError(error) ? 409 : 400, {
      error: error instanceof Error ? error.message : "Bad Request",
    });
  }
}

async function handleEventDelete(req: http.IncomingMessage, res: http.ServerResponse, eventId: string) {
  const auth = await requireAuth(req);
  const event = await getAccessibleEvent(auth, eventId);

  if (!auth) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (!event) {
    sendJson(res, 404, { error: "Not Found" });
    return;
  }

  await store.deleteEvent(eventId);
  res.writeHead(204);
  res.end();
}

async function handleSeedUser(req: http.IncomingMessage, res: http.ServerResponse) {
  const auth = await requireAuth(req);
  if (!auth || auth.user.role !== "admin") {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const body = await readJsonBody(req);
  try {
    const user = await store.createUser({
      email: assertString(body.email, "email").toLowerCase(),
      displayName: assertString(body.displayName, "displayName"),
      passwordHash: await hashPassword(assertString(body.password, "password")),
      role: assertRole(body.role),
    });

    sendJson(res, 201, {
      user: sanitizeUser(user),
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Bad Request",
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: "Bad Request" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const origin = req.headers.origin;
  setCorsHeaders(res, origin);

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/login") {
      await handleLogin(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/logout") {
      await handleLogout(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/me") {
      await handleMe(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/users") {
      await handleAdminUsers(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/users") {
      await handleSeedUser(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      await handleEventsList(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/events") {
      await handleEventsCreate(req, res);
      return;
    }

    const eventMatch = url.pathname.match(/^\/events\/([^/]+)$/);
    if (eventMatch) {
      const eventId = decodeURIComponent(eventMatch[1]);

      if (req.method === "GET") {
        await handleEventRead(req, res, eventId);
        return;
      }

      if (req.method === "PATCH") {
        await handleEventUpdate(req, res, eventId);
        return;
      }

      if (req.method === "DELETE") {
        await handleEventDelete(req, res, eventId);
        return;
      }
    }

    sendJson(res, 404, { error: "Not Found" });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal Server Error",
    });
  }
});

server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
