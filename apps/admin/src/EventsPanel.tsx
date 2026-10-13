import { useEffect, useState } from "react";
import { Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as api from "@/lib/api";
import { useT, inputCls, card } from "./App";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const createSchema = z.object({
  title: z.string().trim().min(1, { message: "Required" }),
  startDate: z.string().min(1, { message: "Required" }),
  timezone: z.string().trim().min(1, { message: "Required" }),
});
type CreateForm = z.infer<typeof createSchema>;

interface EditFields {
  title: string;
  slug: string;
  startDate: string;
  endDate: string;
  timezone: string;
  eventState: "scheduled" | "cancelled" | "postponed";
  locationType: "physical" | "online" | "hybrid";
  location: string;
  venue: string;
  organizer: string;
  mapUrl: string;
  imageUrl: string;
  registrationUrl: string;
  description: string;
  status: "draft" | "published";
}

const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";

function timezoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

function toLocalInput(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const p = timezoneParts(new Date(iso), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function fromLocalInput(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Sila masukkan tarikh dan masa yang sah.");
  const wanted = match.slice(1).map(Number);
  const targetUtc = Date.UTC(wanted[0], wanted[1] - 1, wanted[2], wanted[3], wanted[4]);
  let instant = targetUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = timezoneParts(new Date(instant), timezone);
    const displayedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const delta = targetUtc - displayedUtc;
    if (delta === 0) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new Error("Masa tempatan ini tidak wujud dalam zon masa yang dipilih.");
}

export default function EventsPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [events, setEvents] = useState<api.EventItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditFields | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { title: "", startDate: "", timezone: DEFAULT_TIMEZONE } });

  async function refresh() {
    try {
      const items = await api.listEvents(tenantHost, token);
      items.sort((a, b) => a.startDate.localeCompare(b.startDate));
      setEvents(items);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantHost]);

  async function onCreate(values: CreateForm) {
    try {
      const created = await api.createEvent(tenantHost, token, {
        title: values.title,
        startDate: fromLocalInput(values.startDate, values.timezone),
        timezone: values.timezone,
      });
      form.reset({ title: "", startDate: "", timezone: DEFAULT_TIMEZONE });
      await refresh();
      openEdit(created);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openEdit(ev: api.EventItem) {
    setOpenId(ev.id);
    setEdit({
      title: ev.title,
      slug: ev.slug,
      startDate: toLocalInput(ev.startDate, ev.timezone || DEFAULT_TIMEZONE),
      endDate: toLocalInput(ev.endDate, ev.timezone || DEFAULT_TIMEZONE),
      timezone: ev.timezone || DEFAULT_TIMEZONE,
      eventState: ev.eventState ?? "scheduled",
      locationType: ev.locationType ?? "physical",
      location: ev.location ?? "",
      venue: ev.venue ?? "",
      organizer: ev.organizer ?? "",
      mapUrl: ev.mapUrl ?? "",
      imageUrl: ev.imageUrl ?? "",
      registrationUrl: ev.registrationUrl ?? "",
      description: ev.description,
      status: ev.status,
    });
  }

  async function save(id: string) {
    if (!edit) return;
    try {
      await api.updateEvent(tenantHost, token, id, {
        title: edit.title,
        slug: edit.slug,
        startDate: fromLocalInput(edit.startDate, edit.timezone),
        endDate: edit.endDate ? fromLocalInput(edit.endDate, edit.timezone) : null,
        timezone: edit.timezone,
        eventState: edit.eventState,
        locationType: edit.locationType,
        location: edit.location || null,
        venue: edit.venue || null,
        organizer: edit.organizer || null,
        mapUrl: edit.mapUrl || null,
        imageUrl: edit.imageUrl || null,
        registrationUrl: edit.registrationUrl || null,
        description: edit.description,
        status: edit.status,
      });
      setOpenId(null);
      setEdit(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("events-delete-confirm")))) return;
    try {
      await api.deleteEvent(tenantHost, token, id);
      if (openId === id) {
        setOpenId(null);
        setEdit(null);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="font-display text-sm font-semibold text-ink">{t("events-title")}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Card>
        <CardContent className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreate)} className="flex flex-wrap gap-2">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem className="flex-1 basis-48">
                    <FormControl>
                      <Input required placeholder={t("events-name")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input required type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem className="basis-48">
                    <FormControl>
                      <Input required placeholder={DEFAULT_TIMEZONE} aria-label={t("events-timezone")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
                {form.formState.isSubmitting ? t("events-creating") : t("events-create")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <ul className={`${card} divide-y divide-line/20`}>
        {events.map((ev) => (
          <li key={ev.id}>
            <div className="flex items-center justify-between px-4 py-3 text-xs">
              <button
                onClick={() => (openId === ev.id ? (setOpenId(null), setEdit(null)) : openEdit(ev))}
                className="flex items-center gap-2 font-semibold text-ink"
              >
                {openId === ev.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {ev.title}
                <span className="font-normal text-sub">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: ev.timezone || DEFAULT_TIMEZONE }).format(new Date(ev.startDate))}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ev.status === "published" ? "bg-green-100 text-green-700" : "bg-canvas text-sub"}`}>
                  {t(ev.status === "published" ? "posts-published" : "posts-draft")}
                </span>
                {ev.eventState && ev.eventState !== "scheduled" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{t(`events-${ev.eventState}`)}</span>}
              </button>
              <button onClick={() => void remove(ev.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("events-delete")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {openId === ev.id && edit && (
              <div className="space-y-2 border-t border-line/20 bg-canvas/40 px-4 py-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-name")}
                    <input className={`mt-1 ${inputCls}`} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-slug")}
                    <input className={`mt-1 ${inputCls}`} value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-status")}
                    <select className={`mt-1 ${inputCls}`} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as "draft" | "published" })}>
                      <option value="draft">{t("posts-draft")}</option>
                      <option value="published">{t("posts-published")}</option>
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-state")}
                    <select className={`mt-1 ${inputCls}`} value={edit.eventState} onChange={(e) => setEdit({ ...edit, eventState: e.target.value as EditFields["eventState"] })}>
                      <option value="scheduled">{t("events-scheduled")}</option>
                      <option value="cancelled">{t("events-cancelled")}</option>
                      <option value="postponed">{t("events-postponed")}</option>
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-timezone")}
                    <input className={`mt-1 ${inputCls}`} value={edit.timezone} onChange={(e) => setEdit({ ...edit, timezone: e.target.value })} placeholder={DEFAULT_TIMEZONE} />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-start")}
                    <input type="datetime-local" className={`mt-1 ${inputCls}`} value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-end")}
                    <input type="datetime-local" className={`mt-1 ${inputCls}`} value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-location")}
                    <input className={`mt-1 ${inputCls}`} value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-location-type")}
                    <select className={`mt-1 ${inputCls}`} value={edit.locationType} onChange={(e) => setEdit({ ...edit, locationType: e.target.value as EditFields["locationType"] })}>
                      <option value="physical">{t("events-physical")}</option>
                      <option value="online">{t("events-online")}</option>
                      <option value="hybrid">{t("events-hybrid")}</option>
                    </select>
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-venue")}
                    <input className={`mt-1 ${inputCls}`} value={edit.venue} onChange={(e) => setEdit({ ...edit, venue: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-organizer")}
                    <input className={`mt-1 ${inputCls}`} value={edit.organizer} onChange={(e) => setEdit({ ...edit, organizer: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body sm:col-span-2">
                    {t("events-map-url")}
                    <input className={`mt-1 ${inputCls}`} value={edit.mapUrl} onChange={(e) => setEdit({ ...edit, mapUrl: e.target.value })} placeholder="https://…" />
                  </label>
                  <label className="block text-[11px] font-medium text-body">
                    {t("events-image")}
                    <input className={`mt-1 ${inputCls}`} value={edit.imageUrl} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body sm:col-span-2">
                    {t("events-registration")}
                    <input className={`mt-1 ${inputCls}`} value={edit.registrationUrl} onChange={(e) => setEdit({ ...edit, registrationUrl: e.target.value })} />
                  </label>
                  <label className="block text-[11px] font-medium text-body sm:col-span-2">
                    {t("events-description")}
                    <textarea className={`mt-1 ${inputCls}`} rows={3} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void save(ev.id)}>{t("events-save")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOpenId(null); setEdit(null); }}>{t("events-cancel")}</Button>
                </div>
              </div>
            )}
          </li>
        ))}
        {events.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("events-empty")}</li>}
      </ul>
    </section>
  );
}
