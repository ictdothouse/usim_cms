# Custom Multi-Tenant Headless CMS Spec (2026/2027)

## Core Stack
- **Architecture**: Monorepo using pnpm workspaces (`apps/api`, `apps/admin`)
- **Backend**: Node.js + Fastify + TypeScript
- **Database & ORM**: PostgreSQL + Drizzle ORM
- **Admin UI**: Vite + React + Tailwind CSS + Shadcn UI

## Key Constraints & Token-Saving Rules
1. **Multi-Tenancy**: Single instance engine. Identify tenant via `x-tenant-host` header. Dynamic DB pooling via Drizzle.
2. **Dynamic Blocks Schema**: Stored as a JSONB column (`layout`) inside the `pages` table.
3. **No Bloat**: Avoid heavy libraries. Rely on Tailwind CSS for UI and lightweight Fastify plugins.

## Advanced Payload CMS Features
1. **Code-First Schema & Auto-Generated API**: 
   - Collections are defined via TypeScript configuration.
   - The Fastify backend must read the schema config and automatically generate generic CRUD endpoints (e.g., `/api/:collectionSlug`) without writing manual routes for each entity.
2. **Row-Level Access Control**: 
   - Every collection configuration must support custom `access` functions (e.g., `read`, `create`, `update`, `delete`) based on `req.user.role` and `req.user.department`.
3. **Local API Support**:
   - Provide a local SDK layer so that if a frontend app runs in the same environment, it can query data directly through a local function runner (e.g., `cms.find()`) bypassing the HTTP network stack.
4. **Lifecycle Hooks**:
   - Support `beforeChange` and `afterChange` functions inside the schema config for data validation and clearing frontend cache (Webhooks).

## Expected Initial Folder Structure
```text
my-custom-cms/
├── apps/
│   ├── admin/      # Vite + React (Shadcn UI)
│   └── api/        # Fastify Engine + Drizzle
├── spec.md         # This core specification file
├── pnpm-workspace.yaml
└── package.json