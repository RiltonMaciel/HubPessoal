"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import { db } from "@/lib/db";
import { getBrazilHolidays } from "@/lib/holidays-br";
import type { CalendarEventRecord } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast, Toast } from "@/components/ui/Toast";

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [showHolidays, setShowHolidays] = useState(true);
  const { toasts, push, remove } = useToast();

  const reload = useCallback(async () => {
    const year = new Date().getFullYear();
    const dbEvents = await db.events.toArray();
    const holidayRecords = [...getBrazilHolidays(year - 1), ...getBrazilHolidays(year), ...getBrazilHolidays(year + 1)].map((holiday) => ({
      id: `holiday-${holiday.date}`,
      title: holiday.title,
      date: holiday.date,
      allDay: true,
      holiday: true,
    }));

    setEvents([...dbEvents.filter((item) => !item.holiday), ...(showHolidays ? holidayRecords : [])]);
  }, [showHolidays]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const calendarEvents = useMemo(
    () =>
      events.map((event) => ({
        id: event.id,
        title: event.title,
        date: event.date,
        allDay: event.allDay,
        className: event.holiday ? "fc-holiday" : "fc-event-premium",
      })),
    [events]
  );

  const addEvent = async () => {
    if (!title.trim()) return;
    await db.events.put({ id: uuidv4(), title, date, allDay: true });
    setTitle("");
    push("Evento salvo localmente.");
    await reload();
  };

  const removeEvent = async (id: string) => {
    const event = events.find((item) => item.id === id);
    if (!event || event.holiday) return;
    await db.events.delete(id);
    push("Evento removido.");
    await reload();
  };

  return (
    <section className="pageGrid">
      <Toast toasts={toasts} onRemove={remove} />

      <Card className="col-12">
        <CardHeader>
          <div><h3>Calendário e Lembretes</h3><small>FullCalendar com tema premium e feriados BR offline</small></div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => setShowHolidays(!showHolidays)}>{showHolidays ? "Ocultar" : "Exibir"} feriados</Button>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 8 }}>
            <input className="select" placeholder="Título" value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Título do evento" />
            <input className="select" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Data do evento" />
            <Button variant="primary" onClick={() => void addEvent()}>Adicionar</Button>
          </div>
        </CardBody>
      </Card>

      <Card className="col-12">
        <CardBody>
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            locales={[ptBrLocale]}
            locale="pt-br"
            events={calendarEvents}
            height="auto"
            eventClick={(info) => {
              void removeEvent(info.event.id);
            }}
          />
        </CardBody>
      </Card>
    </section>
  );
}
