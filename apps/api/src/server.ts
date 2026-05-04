import http from "node:http";
import { createPool } from "./db.js";
import { createSessionToken, getSessionExpiry, hashPassword, hashSessionToken, verifyPassword } from "./auth.js";
import { AgendaStore } from "./store.js";
import type { UserRecord, UserRole } from "./domain.js";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

const port = Number(process.env.PORT ?? 3000);
const pool = createPool();
const store = new AgendaStore(pool);

function sendJson(res: http.ServerResponse, statusCode: number, payload: JsonObject) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
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
    sendJson(res, 400, {
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
