import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, lte, or } from "drizzle-orm";
import { events } from "../db/schema.js";

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

// Public event detail/calendar reads. RLS already hides drafts; explicit
// status predicates keep this route's public contract clear and indexed.
export function registerPublicEventRoutes(app: FastifyInstance) {
  app.get("/api/events/slug/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const [event] = await req.db
      .select()
      .from(events)
      .where(and(eq(events.slug, slug), eq(events.status, "published")))
      .limit(1);
    if (!event) {
      reply.code(404);
      return { error: "event not found" };
    }
    return { item: event };
  });

  app.get("/api/events/calendar", async (req, reply) => {
    const query = req.query as { from?: string; to?: string; limit?: string };
    const from = parseInstant(query.from);
    const to = parseInstant(query.to);
    if (!from || !to || to < from) {
      reply.code(400);
      return { error: "from and to must be valid ISO dates, with to after from" };
    }
    if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
      reply.code(400);
      return { error: "calendar range cannot exceed 400 days" };
    }
    const requestedLimit = Number.parseInt(query.limit ?? "300", 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 300) : 300;
    const items = await req.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.status, "published"),
          lte(events.startDate, to),
          // Include events that start in the range and events already in
          // progress. A null end date means the event ends at its start,
          // so old one-off events must not appear forever.
          or(gte(events.startDate, from), gte(events.endDate, from)),
        ),
      )
      .orderBy(asc(events.startDate))
      .limit(limit);
    return { items };
  });
}
