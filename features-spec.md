# Custom Multi-Tenant Headless CMS Features Specification (2026/2027)

## 🏗️ Core Architecture & Tech Stack
- **Architecture**: Headless Monorepo using `pnpm` workspaces
- **Backend Core**: Node.js + Fastify + TypeScript
- **Database & ORM**: PostgreSQL + Drizzle ORM
- **Admin Dashboard UI**: Vite + React + TypeScript + Tailwind CSS + Shadcn UI
- **Frontend Framework**: Decoupled/Headless (Astro or Next.js recommended)

## ⚡ Key Constraints & Token-Saving Rules
1. **Multi-Tenancy Isolation**: Single instance runtime engine. Identify department routing via `x-tenant-host` header. Dynamic DB connection pooling handling using Drizzle ORM.
2. **Dynamic Components**: Layout configurations are saved as Polymorphic JSONB array inside the `layout` column of the `pages` table.
3. **No Bloat Philosophy**: Avoid heavy UI or secondary framework libraries. Lean purely on Tailwind CSS utility classes and lightweight native Fastify plugins.

---

## ⚙️ 1. Backend Engine Features (`apps/api`)
The backend operates as a single high-performance engine powering all 50 department sites securely.

*   **Multi-Tenant Database Router**: Dynamically intercepts incoming traffic based on domain/subdomain headers (`x-tenant-host`) to route database queries to the respective department's isolated database.
*   **Code-First Schema Dynamic Parser**: Reads TypeScript schema configurations at startup, initiates safe database auto-migrations via Drizzle ORM, and exposes schema mappings to the Admin UI as JSON.
*   **Auto-Generated Generic REST/GraphQL API**: Generates complete dynamic CRUD endpoints (`GET`, `POST`, `PUT`, `DELETE`) automatically for any registered collection schema without manual route programming.
*   **Row-Level Access Control (RLS)**: Fine-grained, function-based permission model matching `req.user.role` and `req.user.department` so editors can only mutate content belonging to their specific faculty.
*   **Payload-Style Local API SDK**: A fast internal software development kit layer that allows frontend instances running within the same environment to pull direct from the DB runtime, bypassing HTTP entirely (<5ms response).
*   **Lifecycle Hooks Engine**: Executes custom data interception routines such as `beforeChange` (data scrubbing/validation) and `afterChange` (triggering external microservices or webhooks).
*   **Media Storage Provider Manager**: Centralized asset handling routing uploads (images/documents) either to local persistent block storage or university S3-compatible cloud storage buckets.

---

## 🎨 2. Admin Dashboard Features (`apps/admin`)
A lightweight, fast react dashboard optimized to feel completely intuitive for non-technical users while remaining highly modular for developers.

*   **WordPress-like Block Builder**: A drag-and-drop/clickable block editor that allows non-coders to stack predefined visual blocks (Hero, Features Grid, Accordion) together, mapping output into a clean JSON layout block structure.
*   **Dynamic UI Schema Generation**: The dashboard forms are generated runtime dynamically based on JSON definitions streamed from the backend (e.g., matching a `type: upload` property into a file picker modal).
*   **Real-time Headless Live Preview**: Renders an embedded `<iframe>` window targeting the frontend's preview URL, synchronizing visual text and layout changes on-the-fly via the browser's **PostMessage API** without clicking save.
*   **Centralized Media Library**: An asset repository manager providing basic search, filtering, and seamless image selection to be embedded into content layouts, with background image compression.
*   **Role-Based Dashboard Views**: Custom viewport scopes. University Super Admins maintain complete multi-tenant visibility across all 50 departments, while Faculty Editors only view menus relevant to their instance.

---

## 🌐 3. Frontend Site Features (`apps/frontend` / External View)
The public-facing display system is completely disconnected from the content management database ensuring maximal speeds.

*   **Dynamic Component Renderer**: An asset loop that reads the incoming `layout` JSON blocks payload from the CMS and maps it automatically into local semantic code blocks (e.g., converting a `'hero-section'` object key into `<HeroComponent />`).
*   **Static Site Generation (SSG) / Hybrid SSR**: Renders pages into static production-ready HTML files ahead of time. Department landing pages render instantly (<1 second) because no live database queries are executed during visitor viewing.
*   **On-Demand Cache Onvalidation**: Features secure webhook endpoints listening to the backend lifecycle hooks. As soon as a university staff hits "Publish" in the Admin UI, only the affected route is rebuilt silently in the background.
*   **Global SEO & Meta Manager**: Reads semantic metadata schemas, structural OpenGraph records (for link layouts on WhatsApp/Facebook), and generates dynamic `sitemap.xml` feeds natively to boost search metrics.

---

## 📂 Project Tree Target Blueprint
```text
my-custom-cms/
├── apps/
│   ├── admin/             # Vite + React (Dashboard View)
│   └── api/               # Fastify Engine + Drizzle Core
├── features-spec.md       # This comprehensive features document
├── pnpm-workspace.yaml    # Monorepo setup file
└── package.json           # Global configurations