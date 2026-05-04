import React, { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { createEvent, deleteEvent, getMe, listEvents, login, updateEvent } from "./api.js";
import {
  addDays,
  addMinutes,
  clampDurationMinutes,
  CALENDAR_DAY_START_HOUR,
  combineDateAndTime,
  getCalendarDays,
  getCalendarRange,
  getTimelineHours,
  eventDurationMinutes,
  eventStartMinutes,
  filterEventsForDay,
  filterEventsForRange,
  formatDayLabel,
  formatMonthLabel,
  formatShortDate,
  formatTime,
  setTimeOnDay,
  toDateInputValue,
  toTimeInputValue,
  CALENDAR_TIMELINE_ROW_HEIGHT_PX,
  toLocalDateKey,
  type CalendarView,
} from "./calendar.js";
import type { EventRecord, UserRecord } from "./types.js";

type AuthState = {
  token: string;
  user: UserRecord;
};

type DraftEvent = {
  title: string;
  description: string;
  startsDate: string;
  startsTime: string;
  endsDate: string;
  endsTime: string;
};

const DEMO_LOGIN = {
  admin: { email: "admin@agendaia.local", password: "admin123" },
  professional: { email: "profissional@agendaia.local", password: "profissional123" },
};

const VIEW_CONFIG: Record<CalendarView, { title: string; rangeDays: number }> = {
  day: { title: "Dia", rangeDays: 1 },
  week: { title: "Semana", rangeDays: 7 },
  month: { title: "Mês", rangeDays: 42 },
};

function atTime(date: Date, hour: number, minute = 0) {
  return setTimeOnDay(date, hour, minute);
}

function buildDraftFromDay(date: Date): DraftEvent {
  const start = atTime(date, 9, 0);
  const end = addMinutes(start, 30);
  return {
    title: "",
    description: "",
    startsDate: toDateInputValue(start),
    startsTime: toTimeInputValue(start),
    endsDate: toDateInputValue(end),
    endsTime: toTimeInputValue(end),
  };
}

function buildDraftFromEvent(eventRecord: EventRecord): DraftEvent {
  const start = new Date(eventRecord.startsAt);
  const end = new Date(eventRecord.endsAt);

  return {
    title: eventRecord.title,
    description: eventRecord.description ?? "",
    startsDate: toDateInputValue(start),
    startsTime: toTimeInputValue(start),
    endsDate: toDateInputValue(end),
    endsTime: toTimeInputValue(end),
  };
}

function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [loginEmail, setLoginEmail] = useState(DEMO_LOGIN.admin.email);
  const [loginPassword, setLoginPassword] = useState(DEMO_LOGIN.admin.password);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>("week");
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftEvent | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "edit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [resizingEventId, setResizingEventId] = useState<string | null>(null);
  const dragDayRef = useRef<Date | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("agendaia-auth");
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AuthState;
      setAuth(parsed);
    } catch {
      localStorage.removeItem("agendaia-auth");
    }
  }, []);

  useEffect(() => {
    if (!auth) {
      setEvents([]);
      return;
    }

    let active = true;
    setLoadingEvents(true);
    setEventError(null);

    const range = getCalendarRange(view, currentDate);

    listEvents(auth.token, range.start.toISOString(), range.end.toISOString(), auth.user.role === "admin" ? undefined : auth.user.id)
      .then((payload) => {
        if (!active) {
          return;
        }

        setEvents(payload.events);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setEventError(error instanceof Error ? error.message : "Falha ao carregar eventos");
      })
      .finally(() => {
        if (active) {
          setLoadingEvents(false);
        }
      });

    return () => {
      active = false;
    };
  }, [auth, currentDate, view]);

  useEffect(() => {
    if (!auth) {
      return;
    }

    getMe(auth.token).catch(() => {
      localStorage.removeItem("agendaia-auth");
      setAuth(null);
    });
  }, [auth]);

  useEffect(() => {
    if (!auth) {
      return;
    }

    localStorage.setItem("agendaia-auth", JSON.stringify(auth));
  }, [auth]);

  useEffect(() => {
    if (!auth) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(null);
        setMode(null);
        setSelectedEventId(null);
        setDraftError(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [auth]);

  const currentRange = useMemo(() => {
    return getCalendarRange(view, currentDate);
  }, [currentDate, view]);

  const visibleEvents = useMemo(() => {
    return filterEventsForRange(events, currentRange.start, currentRange.end).sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  }, [events, currentRange]);

  const days = useMemo(() => {
    return getCalendarDays(view, currentDate);
  }, [currentDate, view]);

  function saveAuth(next: AuthState | null) {
    setAuth(next);
    if (!next) {
      localStorage.removeItem("agendaia-auth");
    }
  }

  async function handleLoginSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setLoadingAuth(true);

    try {
      const authResponse = await login(loginEmail, loginPassword);
      saveAuth({ token: authResponse.token, user: authResponse.user });
      setMessage(`Bem-vindo, ${authResponse.user.displayName}.`);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Falha no login");
    } finally {
      setLoadingAuth(false);
    }
  }

  function openCreateDraft(date: Date) {
    setMode("create");
    setDraft(buildDraftFromDay(date));
    setSelectedEventId(null);
    setDraftError(null);
  }

  function openEditDraft(eventRecord: EventRecord) {
    setMode("edit");
    setSelectedEventId(eventRecord.id);
    setDraft(buildDraftFromEvent(eventRecord));
    setDraftError(null);
  }

  async function persistDraft() {
    if (!auth || !draft) {
      return;
    }

    if (!draft.title.trim()) {
      setDraftError("Título é obrigatório.");
      return;
    }

    try {
      const startsAt = combineDateAndTime(draft.startsDate, draft.startsTime);
      const endsAt = combineDateAndTime(draft.endsDate, draft.endsTime);

      if (endsAt.getTime() <= startsAt.getTime()) {
        setDraftError("O término deve ser depois do início.");
        return;
      }

      if (mode === "create") {
        await createEvent(auth.token, {
          title: draft.title,
          description: draft.description || null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timezone: "America/Sao_Paulo",
          isAllDay: false,
        });
        setMessage("Evento criado.");
      } else if (mode === "edit" && selectedEventId) {
        await updateEvent(auth.token, selectedEventId, {
          title: draft.title,
          description: draft.description || null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        });
        setMessage("Evento atualizado.");
      }

      setDraft(null);
      setMode(null);
      setSelectedEventId(null);
      setDraftError(null);
      startTransition(() => setCurrentDate(startsAt));
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Falha ao salvar evento");
    }
  }

  async function removeSelectedEvent() {
    if (!auth || !selectedEventId) {
      return;
    }

    try {
      await deleteEvent(auth.token, selectedEventId);
      setMessage("Evento removido.");
      setSelectedEventId(null);
      setDraft(null);
      setMode(null);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Falha ao remover evento");
    }
  }

  function stepRange(direction: -1 | 1) {
    if (view === "day") {
      setCurrentDate(addDays(currentDate, direction));
      return;
    }

    if (view === "week") {
      setCurrentDate(addDays(currentDate, direction * 7));
      return;
    }

    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1));
  }

  function moveToToday() {
    setCurrentDate(new Date());
  }

  function eventCardDragStart(eventId: string) {
    setDraggingEventId(eventId);
  }

  function eventCardDragEnd() {
    setDraggingEventId(null);
  }

  async function dropEventOnDay(eventId: string, targetDay: Date) {
    if (!auth) {
      return;
    }

    const eventRecord = events.find((entry) => entry.id === eventId);
    if (!eventRecord) {
      return;
    }

    const duration = eventDurationMinutes(eventRecord);
    const currentStart = new Date(eventRecord.startsAt);
    const targetStart = atTime(targetDay, currentStart.getHours(), currentStart.getMinutes());
    const targetEnd = addMinutes(targetStart, duration);

    try {
      const updated = await updateEvent(auth.token, eventId, {
        startsAt: targetStart.toISOString(),
        endsAt: targetEnd.toISOString(),
      });
      setEvents((current) => current.map((item) => (item.id === updated.event.id ? updated.event : item)));
      setMessage("Evento movido.");
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Falha ao mover evento");
    } finally {
      setDraggingEventId(null);
      dragDayRef.current = null;
    }
  }

  async function resizeEvent(eventId: string, nextDurationMinutes: number) {
    if (!auth) {
      return;
    }

    const eventRecord = events.find((entry) => entry.id === eventId);
    if (!eventRecord) {
      return;
    }

    const start = new Date(eventRecord.startsAt);
    const end = addMinutes(start, nextDurationMinutes);

    try {
      const updated = await updateEvent(auth.token, eventId, {
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
      setEvents((current) => current.map((item) => (item.id === updated.event.id ? updated.event : item)));
      setMessage("Duração atualizada.");
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Falha ao redimensionar evento");
    } finally {
      setResizingEventId(null);
    }
  }

  if (!auth) {
    return (
      <main className="auth-screen">
        <div className="auth-panel">
          <div className="auth-copy">
            <span className="eyebrow">AgendaIA</span>
            <h1>Calendário inteligente para uso real.</h1>
            <p>Entre com a conta de demonstração e teste navegação, edição e arrasto de eventos.</p>
            <div className="hint-list">
              <span>Admin: `admin@agendaia.local / admin123`</span>
              <span>Profissional: `profissional@agendaia.local / profissional123`</span>
            </div>
          </div>

          <form className="auth-form" onSubmit={handleLoginSubmit}>
            <label>
              Email
              <input value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={loadingAuth}>
              {loadingAuth ? "Entrando..." : "Entrar"}
            </button>
            {loginError ? <p className="error-banner">{loginError}</p> : null}
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <span className="eyebrow">AgendaIA</span>
          <h2>{auth.user.displayName}</h2>
          <p className="muted">{auth.user.email}</p>
          <p className="role-pill">{auth.user.role}</p>
        </div>

        <div className="sidebar-actions">
          <button onClick={() => openCreateDraft(currentDate)}>Novo evento</button>
          <button onClick={moveToToday}>Hoje</button>
          <button
            onClick={() => {
              localStorage.removeItem("agendaia-auth");
              saveAuth(null);
            }}
          >
            Sair
          </button>
        </div>
      </aside>

      <section className="calendar-panel">
        <header className="toolbar">
          <div>
            <span className="eyebrow">Calendário</span>
            <h1>{VIEW_CONFIG[view].title} {view === "month" ? formatMonthLabel(currentDate) : formatDayLabel(currentDate)}</h1>
          </div>

          <div className="toolbar-actions">
            <div className="segmented">
              {(["day", "week", "month"] as CalendarView[]).map((nextView) => (
                <button
                  key={nextView}
                  className={view === nextView ? "active" : ""}
                  onClick={() => setView(nextView)}
                >
                  {VIEW_CONFIG[nextView].title}
                </button>
              ))}
            </div>
            <button onClick={() => stepRange(-1)}>Anterior</button>
            <button onClick={() => stepRange(1)}>Próximo</button>
          </div>
        </header>

        {message ? <div className="success-banner">{message}</div> : null}
        {eventError ? <div className="error-banner">{eventError}</div> : null}
        {loadingEvents ? <div className="loading-banner">Carregando agenda...</div> : null}

        <div className="calendar-stage">
          {view === "month" ? (
            <MonthGrid
              currentDate={currentDate}
              days={days}
              events={visibleEvents}
              onCreate={openCreateDraft}
              onOpen={openEditDraft}
              draggingEventId={draggingEventId}
              onDropEvent={dropEventOnDay}
            />
          ) : (
            <TimelineView
              currentDate={currentDate}
              view={view}
              days={days}
              events={visibleEvents}
              onCreate={openCreateDraft}
              onOpen={openEditDraft}
              draggingEventId={draggingEventId}
              onDragStart={eventCardDragStart}
              onDragEnd={eventCardDragEnd}
              onDropEvent={dropEventOnDay}
              onResize={resizeEvent}
              resizingEventId={resizingEventId}
              setResizingEventId={setResizingEventId}
            />
          )}
        </div>

        {draft ? (
          <EventDrawer
            mode={mode}
            draft={draft}
            setDraft={setDraft}
            draftError={draftError}
            onCancel={() => {
              setDraft(null);
              setMode(null);
              setSelectedEventId(null);
              setDraftError(null);
            }}
            onSave={persistDraft}
            onDelete={mode === "edit" ? removeSelectedEvent : undefined}
          />
        ) : null}
      </section>
    </main>
  );
}

function MonthGrid({
  currentDate,
  days,
  events,
  onCreate,
  onOpen,
  draggingEventId,
  onDropEvent,
}: {
  currentDate: Date;
  days: Date[];
  events: EventRecord[];
  onCreate: (date: Date) => void;
  onOpen: (event: EventRecord) => void;
  draggingEventId: string | null;
  onDropEvent: (eventId: string, targetDay: Date) => Promise<void>;
}) {
  const monthDays = days;
  const monthEvents = events;

  return (
    <section className="month-grid">
      {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => (
        <div className="month-weekday" key={day}>
          {day}
        </div>
      ))}

      {monthDays.map((day) => {
        const dayKey = toLocalDateKey(day);
        const dayEvents = monthEvents.filter((event) => toLocalDateKey(new Date(event.startsAt)) === dayKey);
        const isCurrentMonth = day.getMonth() === currentDate.getMonth();

        return (
          <div
            key={dayKey}
            className={`month-cell ${isCurrentMonth ? "" : "muted-cell"}`}
            role="button"
            tabIndex={0}
            onDoubleClick={() => onCreate(day)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const eventId = event.dataTransfer.getData("text/event-id");
              if (eventId) {
                void onDropEvent(eventId, day);
              }
            }}
          >
            <div className="month-cell-head">
              <span>{day.getDate()}</span>
              <small>{formatShortDate(day)}</small>
            </div>

            <div className="month-event-list">
              {dayEvents.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className={`month-event-chip ${draggingEventId === item.id ? "dragging" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(item);
                  }}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/event-id", item.id);
                  }}
                >
                  {item.title}
                </div>
              ))}
              {dayEvents.length > 3 ? <span className="more-count">+{dayEvents.length - 3}</span> : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function TimelineView({
  currentDate,
  view,
  days,
  events,
  onCreate,
  onOpen,
  draggingEventId,
  onDragStart,
  onDragEnd,
  onDropEvent,
  onResize,
  resizingEventId,
  setResizingEventId,
}: {
  currentDate: Date;
  view: CalendarView;
  days: Date[];
  events: EventRecord[];
  onCreate: (date: Date) => void;
  onOpen: (event: EventRecord) => void;
  draggingEventId: string | null;
  onDragStart: (eventId: string) => void;
  onDragEnd: () => void;
  onDropEvent: (eventId: string, targetDay: Date) => Promise<void>;
  onResize: (eventId: string, nextDurationMinutes: number) => Promise<void>;
  resizingEventId: string | null;
  setResizingEventId: (eventId: string | null) => void;
}) {
  const [draftDropDate, setDraftDropDate] = useState<Date | null>(null);

  const hours = getTimelineHours();

  return (
    <section className={`timeline timeline-${view}`}>
        <div className="timeline-header" style={{ gridTemplateColumns: `88px repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => (
          <div
            key={toLocalDateKey(day)}
            className="timeline-day-label"
            onDoubleClick={() => onCreate(day)}
            onDragOver={(event) => {
              event.preventDefault();
              setDraftDropDate(day);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const eventId = event.dataTransfer.getData("text/event-id");
              if (eventId) {
                void onDropEvent(eventId, day);
              }
              setDraftDropDate(null);
            }}
          >
            <strong>{day.toLocaleDateString("pt-BR", { weekday: "short" })}</strong>
            <span>{day.getDate()}</span>
            {draftDropDate && toLocalDateKey(draftDropDate) === toLocalDateKey(day) ? (
              <span className="drop-hint">Soltar aqui</span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="timeline-grid" style={{ gridTemplateColumns: `88px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="time-column">
          {hours.map((hour) => (
            <div key={hour} className="time-slot">
              {`${`${hour}`.padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayEvents = filterEventsForDay(events, day);

          return (
            <div
              key={toLocalDateKey(day)}
              className="day-column"
              onDoubleClick={() => onCreate(day)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const eventId = event.dataTransfer.getData("text/event-id");
                if (eventId) {
                  void onDropEvent(eventId, day);
                }
              }}
            >
              {hours.map((hour) => (
                <div key={hour} className="slot-row" />
              ))}

              {dayEvents.map((eventRecord) => {
                const startMinutes = eventStartMinutes(eventRecord);
                const duration = eventDurationMinutes(eventRecord);
                const top = ((startMinutes - CALENDAR_DAY_START_HOUR * 60) / 60) * CALENDAR_TIMELINE_ROW_HEIGHT_PX;
                const height = (duration / 60) * CALENDAR_TIMELINE_ROW_HEIGHT_PX;

                return (
                  <article
                    key={eventRecord.id}
                    className={`event-card ${draggingEventId === eventRecord.id ? "dragging" : ""}`}
                    style={{
                      top: `${Math.max(0, top)}px`,
                      height: `${Math.max(48, height)}px`,
                    }}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/event-id", eventRecord.id);
                      onDragStart(eventRecord.id);
                    }}
                    onDragEnd={onDragEnd}
                    onDoubleClick={() => onOpen(eventRecord)}
                  >
                    <div className="event-card-head">
                      <strong>{eventRecord.title}</strong>
                      <button type="button" onClick={() => onOpen(eventRecord)}>
                        Abrir
                      </button>
                    </div>
                    <span>{`${formatTime(new Date(eventRecord.startsAt))} - ${formatTime(new Date(eventRecord.endsAt))}`}</span>
                    {eventRecord.description ? <p>{eventRecord.description}</p> : null}
                    <ResizeHandle
                      eventId={eventRecord.id}
                      duration={duration}
                      resizingEventId={resizingEventId}
                      setResizingEventId={setResizingEventId}
                      onResize={onResize}
                    />
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ResizeHandle({
  eventId,
  duration,
  resizingEventId,
  setResizingEventId,
  onResize,
}: {
  eventId: string;
  duration: number;
  resizingEventId: string | null;
  setResizingEventId: (eventId: string | null) => void;
  onResize: (eventId: string, nextDurationMinutes: number) => Promise<void>;
}) {
  const startY = useRef<number | null>(null);
  const initialDuration = useRef<number>(duration);

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.preventDefault();
    startY.current = event.clientY;
    initialDuration.current = duration;
    setResizingEventId(eventId);

    const onMove = (moveEvent: PointerEvent) => {
      if (startY.current == null) {
        return;
      }

      const delta = moveEvent.clientY - startY.current;
      const nextDuration = clampDurationMinutes(initialDuration.current + Math.round(delta / 2));
      void onResize(eventId, nextDuration);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      startY.current = null;
      setResizingEventId(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className={`resize-handle ${resizingEventId === eventId ? "active" : ""}`}
      onPointerDown={beginResize}
    />
  );
}

function EventDrawer({
  mode,
  draft,
  setDraft,
  draftError,
  onCancel,
  onSave,
  onDelete,
}: {
  mode: "create" | "edit" | null;
  draft: DraftEvent;
  setDraft: React.Dispatch<React.SetStateAction<DraftEvent | null>>;
  draftError: string | null;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div>
          <span className="eyebrow">{mode === "edit" ? "Editar evento" : "Novo evento"}</span>
          <h3>Detalhes</h3>
        </div>
        <button onClick={onCancel}>Fechar</button>
      </div>

      <label>
        Título
        <input
          value={draft.title}
          onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
        />
      </label>

      <label>
        Descrição
        <textarea
          value={draft.description}
          onChange={(event) =>
            setDraft((current) => current ? { ...current, description: event.target.value } : current)
          }
        />
      </label>

      <div className="datetime-grid">
        <label>
          Data de início
          <input
            type="date"
            value={draft.startsDate}
            onChange={(event) =>
              setDraft((current) => current ? { ...current, startsDate: event.target.value } : current)
            }
          />
        </label>

        <label>
          Hora de início
          <input
            type="time"
            step={900}
            value={draft.startsTime}
            onChange={(event) =>
              setDraft((current) => current ? { ...current, startsTime: event.target.value } : current)
            }
          />
        </label>

        <label>
          Data de término
          <input
            type="date"
            value={draft.endsDate}
            onChange={(event) =>
              setDraft((current) => current ? { ...current, endsDate: event.target.value } : current)
            }
          />
        </label>

        <label>
          Hora de término
          <input
            type="time"
            step={900}
            value={draft.endsTime}
            onChange={(event) =>
              setDraft((current) => current ? { ...current, endsTime: event.target.value } : current)
            }
          />
        </label>
      </div>

      <p className="drawer-hint">Use data e hora separadas. O horário é validado antes de salvar.</p>

      {draftError ? <div className="error-banner">{draftError}</div> : null}

      <div className="drawer-actions">
        {onDelete ? <button className="danger" onClick={onDelete}>Excluir</button> : null}
        <button onClick={onCancel}>Cancelar</button>
        <button onClick={onSave}>Salvar</button>
      </div>
    </aside>
  );
}

export { App };
