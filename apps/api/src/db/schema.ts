import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const pages = pgTable("pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  // Dynamic block layout for the page, e.g. [{ type: "hero", props: {...} }, ...]
  layout: jsonb("layout").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
