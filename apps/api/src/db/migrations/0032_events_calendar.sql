-- Event calendar: stable detail URLs, explicit IANA timezone, operational
-- state/location metadata and indexed time-range reads.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "slug" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "event_state" text DEFAULT 'scheduled' NOT NULL;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "location_type" text DEFAULT 'physical' NOT NULL;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "venue" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "organizer" text;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "map_url" text;

-- Backfill stable, readable URLs. Duplicate title slugs gain a stable UUID
-- suffix before uniqueness is enforced.
UPDATE "events"
SET "slug" = trim(both '-' from regexp_replace(lower("title"), '[^a-z0-9]+', '-', 'g'))
WHERE "slug" IS NULL OR "slug" = '';

WITH ranked AS (
  SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn
  FROM "events"
)
UPDATE "events" AS e
SET "slug" = e."slug" || '-' || left(e."id"::text, 8)
FROM ranked
WHERE ranked."id" = e."id" AND ranked.rn > 1;

UPDATE "events" SET "slug" = 'event-' || left("id"::text, 8) WHERE "slug" = '';
ALTER TABLE "events" ALTER COLUMN "slug" SET NOT NULL;

-- Existing timestamps were stored as UTC wall times by the admin's ISO
-- conversion. Interpret them as UTC instants once, then keep future writes as
-- timestamptz so server timezone cannot shift dates on read/write.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
      AND column_name = 'start_date' AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "events" ALTER COLUMN "start_date" TYPE timestamptz USING "start_date" AT TIME ZONE 'UTC';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
      AND column_name = 'end_date' AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "events" ALTER COLUMN "end_date" TYPE timestamptz USING "end_date" AT TIME ZONE 'UTC';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "events_slug_unique_idx" ON "events" ("slug");
CREATE INDEX IF NOT EXISTS "events_status_start_date_idx" ON "events" ("status", "start_date");

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_state_check"
    CHECK ("event_state" IN ('scheduled', 'cancelled', 'postponed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_location_type_check"
    CHECK ("location_type" IN ('physical', 'online', 'hybrid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
