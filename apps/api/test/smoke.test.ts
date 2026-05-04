import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const apiDir = join(import.meta.dirname, "..");
const apiBaseUrl = "http://127.0.0.1:3101";

function parseEnvFile(contents: string) {
  const env: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

async function loadLocalEnv() {
  const envPath = join(apiDir, ".env");
  const contents = await readFile(envPath, "utf8");
  return parseEnvFile(contents);
}

async function waitForHealth(url: string, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}/health`);
}

async function requestJson(
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const text = await response.text();
  let body: unknown = text;

  if (text.trim()) {
    body = JSON.parse(text);
  }

  return {
    status: response.status,
    body,
    headers: response.headers,
  };
}

let server: ChildProcessWithoutNullStreams | null = null;

before(async () => {
  const env = {
    ...process.env,
    ...(await loadLocalEnv()),
    PORT: "3101",
    CORS_ORIGIN: "http://localhost:5173",
  };

  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: apiDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr: string[] = [];
  server.stderr.on("data", (chunk) => {
    stderr.push(chunk.toString("utf8"));
  });

  await waitForHealth(apiBaseUrl);

  if (stderr.length > 0) {
    // Keep the process alive, but fail fast if startup logged a fatal error.
    const fatal = stderr.join("");
    assert.ok(!/ERR_|Error:/u.test(fatal), fatal);
  }
});

after(async () => {
  if (!server) {
    return;
  }

  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    server?.once("exit", () => resolve());
  });
});

test("API smoke path covers auth, protection, create, move, and conflict rejection", async () => {
  const login = await requestJson("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@agendaia.local", password: "admin123" }),
  });

  assert.equal(login.status, 200);
  assert.equal(typeof (login.body as { token?: string }).token, "string");

  const token = (login.body as { token: string }).token;
  const authHeaders = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const unauthMe = await requestJson("/auth/me");
  assert.equal(unauthMe.status, 401);

  const me = await requestJson("/auth/me", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal((me.body as { user?: { email?: string } }).user?.email, "admin@agendaia.local");

  const adminUsers = await requestJson("/admin/users", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(adminUsers.status, 200);
  const professional = (adminUsers.body as { users: Array<{ id: string; email: string }> }).users.find(
    (user) => user.email === "profissional@agendaia.local",
  );
  assert.ok(professional);

  const preflight = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");

  const create = await requestJson("/events", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      ownerUserId: professional.id,
      title: "Smoke test event",
      startsAt: "2026-05-08T10:00:00.000Z",
      endsAt: "2026-05-08T11:00:00.000Z",
      participantIds: [],
      resourceIds: [],
    }),
  });
  assert.equal(create.status, 201);
  const createdEvent = create.body as { event: { id: string; startsAt: string; endsAt: string } };
  assert.equal(createdEvent.event.startsAt, "2026-05-08T10:00:00.000Z");

  const moved = await requestJson(`/events/${createdEvent.event.id}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      startsAt: "2026-05-08T11:30:00.000Z",
      endsAt: "2026-05-08T12:30:00.000Z",
    }),
  });
  assert.equal(moved.status, 200);
  assert.equal((moved.body as { event: { startsAt: string } }).event.startsAt, "2026-05-08T11:30:00.000Z");

  const conflict = await requestJson("/events", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      ownerUserId: professional.id,
      title: "Conflict event",
      startsAt: "2026-05-08T11:45:00.000Z",
      endsAt: "2026-05-08T12:15:00.000Z",
      participantIds: [],
      resourceIds: [],
    }),
  });
  assert.equal(conflict.status, 409);
  assert.match((conflict.body as { error?: string }).error ?? "", /Scheduling conflict detected/u);

  const deleteResult = await requestJson(`/events/${createdEvent.event.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(deleteResult.status, 204);
});
