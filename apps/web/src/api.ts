import type { AuthResponse, EventRecord, UserRecord } from "./types.js";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getMe(token: string): Promise<{ user: UserRecord }> {
  return request<{ user: UserRecord }>("/auth/me", { method: "GET" }, token);
}

export async function listEvents(token: string, startsAt: string, endsAt: string, ownerUserId?: string) {
  const params = new URLSearchParams({ startsAt, endsAt });
  if (ownerUserId) {
    params.set("ownerUserId", ownerUserId);
  }

  return request<{ events: EventRecord[] }>(`/events?${params.toString()}`, { method: "GET" }, token);
}

export async function createEvent(token: string, payload: Record<string, unknown>) {
  return request<{ event: EventRecord }>("/events", {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function updateEvent(token: string, eventId: string, payload: Record<string, unknown>) {
  return request<{ event: EventRecord }>(`/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, token);
}

export async function deleteEvent(token: string, eventId: string) {
  return request<void>(`/events/${eventId}`, {
    method: "DELETE",
  }, token);
}
