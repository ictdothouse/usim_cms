import type { APIRoute } from "astro";
import { getEventBySlug } from "../../../lib/api";

const escapeIcs = (value: string) => value
  .replace(/\\/g, "\\\\")
  .replace(/\r?\n/g, "\\n")
  .replace(/,/g, "\\,")
  .replace(/;/g, "\\;");

const icsDate = (value: string) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export const GET: APIRoute = async ({ request, params }) => {
  const rawHost = request.headers.get("host") ?? "";
  const tenantHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)
    ? (new URL(request.url).searchParams.get("__tenant") ?? import.meta.env.DEV_TENANT_HOST ?? rawHost)
    : rawHost;
  const event = await getEventBySlug(tenantHost, params.slug ?? "");
  if (!event) return new Response("Event not found", { status: 404 });

  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const eventUrl = `https://${tenantHost}/events/${encodeURIComponent(event.slug)}`;
  const location = [event.venue, event.location].filter(Boolean).join(", ");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//USIM CMS//Event Calendar//MS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.slug}@${tenantHost}`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsDate(event.startDate)}`,
    ...(event.endDate ? [`DTEND:${icsDate(event.endDate)}`] : []),
    `SUMMARY:${escapeIcs(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeIcs(event.description)}`] : []),
    ...(location ? [`LOCATION:${escapeIcs(location)}`] : []),
    `URL:${eventUrl}`,
    `STATUS:${event.eventState === "cancelled" ? "CANCELLED" : event.eventState === "postponed" ? "TENTATIVE" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${event.slug}.ics"`,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
};
