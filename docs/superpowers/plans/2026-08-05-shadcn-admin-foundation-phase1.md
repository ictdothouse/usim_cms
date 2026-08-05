# shadcn Foundation + App.tsx Migration (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt shadcn/ui as `apps/admin`'s primary component library — install the foundation and migrate every panel in `App.tsx` (plus `CategoriesPanel.tsx`/`MediaPickerModal.tsx`) onto it, replacing native `<select>`s, `alert()`/`confirm()`, and hand-rolled modals with shadcn equivalents.

**Architecture:** shadcn CLI installs Radix-based components into `src/components/ui/`. A new `useConfirm()` hook (built once on `AlertDialog`) gives every delete/destructive action a promise-based `confirm()`-shaped API so call sites barely change shape. `sonner`'s `toast()` replaces `alert()` directly. `react-hook-form` + `zod` replace the plain-`useState` quick-create forms. Migration proceeds panel-group by panel-group, each its own commit.

**Tech Stack:** React 18, Vite, Tailwind v3, shadcn/ui (`new-york` style, `zinc` base), Radix UI primitives, react-hook-form, zod, sonner, lucide-react (already present).

## Global Constraints

- Reset to shadcn's **default zinc theme** — do not map existing brand tokens (`ink`/`sub`/`body`/`line`/`canvas`/`accent`/`ok`/`warn`). Leave those tokens in `tailwind.config.js`, untouched, for any not-yet-migrated screen to keep using.
- `apps/frontend` / daisyUI: **do not touch**. Different app, not React.
- `Designer.tsx`: **do not touch** in this plan. Separate future phase.
- No dark-mode toggle is being wired up — `darkMode: ["class"]` stays inert.
- Verification is `pnpm --filter @usim-cms/admin typecheck` after each task — no test framework exists in `apps/admin` today, and this plan does not introduce one. No live-browser pass unless explicitly requested.
- Every panel task keeps the existing shared style constants (`inputCls`, `btnPrimary`, `btnGhost`, `card`, exported from `App.tsx`) in place until the LAST task that references them is done — other not-yet-migrated panels still import them.
- Commit after every task.

---

### Task 1: shadcn Foundation

**Files:**
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/components.json`
- Modify: `apps/admin/src/index.css`
- Modify: `apps/admin/tailwind.config.js`
- Modify: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/components/ui/*` (via CLI — button, input, textarea, label, select, checkbox, radio-group, switch, tabs, dialog, alert-dialog, dropdown-menu, popover, tooltip, command, table, card, badge, separator, avatar, scroll-area, sheet, accordion, collapsible, skeleton, progress, sonner, form)

**Interfaces:**
- Produces: `cn()` (already exists, `apps/admin/src/lib/utils.ts`, untouched) — every shadcn component imports this. `<Toaster />` mounted once in `main.tsx`, so every later task can call `toast(...)` from `sonner` with no further setup.

- [ ] **Step 1: Add zod + hookform resolver deps (shadcn CLI adds react-hook-form itself via the `form` component, but not these two)**

```bash
pnpm --filter @usim-cms/admin add zod @hookform/resolvers
```

- [ ] **Step 2: Run shadcn init**

```bash
cd apps/admin && pnpm dlx shadcn@latest init --yes --base-color zinc --css-variables
```

Confirm afterward that `components.json` reads `"style": "new-york"`, `"baseColor": "zinc"`, `"cssVariables": true`. If the CLI produced `"style": "default"` (older CLI version), edit `components.json` by hand to `"new-york"` and re-run Step 3.

- [ ] **Step 3: Install the component set (single batched command)**

```bash
cd apps/admin && pnpm dlx shadcn@latest add button input textarea label select checkbox radio-group switch tabs dialog alert-dialog dropdown-menu popover tooltip command table card badge separator avatar scroll-area sheet accordion collapsible skeleton progress sonner form
```

- [ ] **Step 4: Verify existing brand tokens survived in `tailwind.config.js`**

Open `apps/admin/tailwind.config.js`. The CLI only adds to `theme.extend.colors`/`plugins` — confirm the pre-existing block is still present and untouched:

```js
colors: {
  ink: "#1d1d1f",
  sub: "#86868b",
  body: "#515154",
  line: "#d2d2d7",
  canvas: "#f5f5f7",
  accent: "#0071e3",
  ok: "#34c759",
  warn: "#ff9500",
  // shadcn's generated tokens (background/foreground/primary/etc) added below/around this
},
```

If the CLI overwrote this block, restore it from git (`git diff apps/admin/tailwind.config.js`) and re-add the shadcn tokens manually alongside it.

- [ ] **Step 5: Mount `<Toaster />` globally**

`apps/admin/src/main.tsx` — add the import and wrap `<App />`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>
);
```

(`<Toaster />` as a sibling, not a wrapper — it renders its own portal, doesn't need to enclose `<App />`.)

- [ ] **Step 6: Typecheck + build**

```bash
pnpm --filter @usim-cms/admin typecheck
pnpm --filter @usim-cms/admin build
```

Expected: both pass with 0 errors. `build` matters here specifically because it's the first real check that Tailwind's CSS-variable output and the new Radix imports resolve correctly end-to-end — `typecheck` alone wouldn't catch a broken CSS pipeline.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/package.json apps/admin/pnpm-lock.yaml apps/admin/components.json apps/admin/src/index.css apps/admin/tailwind.config.js apps/admin/src/main.tsx apps/admin/src/components/ui apps/admin/src/lib/utils.ts
git commit -m "feat(admin): install shadcn/ui foundation (new-york/zinc) + Toaster"
```

---

### Task 2: `useConfirm` hook (promise-based confirm dialog)

**Files:**
- Create: `apps/admin/src/hooks/useConfirm.tsx`
- Modify: `apps/admin/src/main.tsx`

**Interfaces:**
- Consumes: `AlertDialog`/`AlertDialogContent`/`AlertDialogHeader`/`AlertDialogTitle`/`AlertDialogDescription`/`AlertDialogFooter`/`AlertDialogAction`/`AlertDialogCancel` from `@/components/ui/alert-dialog` (Task 1).
- Produces: `ConfirmDialogProvider` (React component, wraps children) and `useConfirm()` (hook) → `confirm: (message: string) => Promise<boolean>`. Every later task's `if (!confirm(t("...-confirm"))) return;` becomes `if (!(await confirm(t("...-confirm")))) return;` inside an already-`async` function — no other call-site restructuring needed.

- [ ] **Step 1: Write the hook + provider**

```tsx
// apps/admin/src/hooks/useConfirm.tsx
import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmFn = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((msg) => {
    setMessage(msg);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setMessage(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={message !== null} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{message}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Confirm this action
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => settle(true)}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm() must be used inside <ConfirmDialogProvider>");
  return ctx;
}
```

`AlertDialogDescription` is `sr-only` (visually hidden, screen-reader only) rather than removed — Radix's `AlertDialogContent` warns/requires a description for accessibility, and every call site's `message` is already the full sentence shown as the title, so a second visible line would just repeat it.

- [ ] **Step 2: Mount the provider in `main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmDialogProvider } from "@/hooks/useConfirm";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmDialogProvider>
      <App />
      <Toaster />
    </ConfirmDialogProvider>
  </StrictMode>
);
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors. (No call site uses `useConfirm()` yet — this task only proves the hook itself compiles and mounts; Task 6 onward wires the first real caller.)

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/hooks/useConfirm.tsx apps/admin/src/main.tsx
git commit -m "feat(admin): add useConfirm hook (promise-based AlertDialog)"
```

---

### Task 3: Dashboard → `Card`

**Files:**
- Modify: `apps/admin/src/App.tsx:3015-3073` (`MetricCard`, `Dashboard`)

**Interfaces:**
- Consumes: `Card`, `CardContent` from `@/components/ui/card` (Task 1).

- [ ] **Step 1: Read the current `MetricCard`/`Dashboard` bodies**

Read `apps/admin/src/App.tsx:3015-3073` before editing — this task's exact before/after depends on the live JSX there, which may have shifted slightly from earlier line numbers recorded during planning (e.g. from Designer.tsx work landing between then and now). Confirm `MetricCard` renders a `label`/`value`/`unit`/`icon` tile and `Dashboard` lays out a grid of them.

- [ ] **Step 2: Replace `MetricCard`'s outer wrapper with `Card`/`CardContent`**

Keep the exact same props signature (`{ label, value, unit, icon }`) and inner layout (icon + label + value/unit) — only the outer `<div className={...}>` wrapper becomes:

```tsx
import { Card, CardContent } from "@/components/ui/card";

function MetricCard({ label, value, unit, icon }: { label: string; value: number | string; unit: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        {icon}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">
            {value} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
```

`Dashboard`'s own grid wrapper (`className="grid ..."`) around the `<MetricCard>` calls is unchanged — only the card internals move to shadcn.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/App.tsx
git commit -m "refactor(admin): Dashboard metric tiles use shadcn Card"
```

---

### Task 4: Multisite (`TenantsPanel`, `TenantCard`, `DangerZone`, `CloneBox`)

**Files:**
- Modify: `apps/admin/src/App.tsx:2001-2386`

**Interfaces:**
- Consumes: `useConfirm` (Task 2), `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` (Task 1), `Button`, `Input`, `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage` + `zodResolver` + `useForm` (Task 1).

- [ ] **Step 1: Convert `CloneBox`'s clone-replace confirm (`App.tsx:2258`)**

Before:
```tsx
async function replace(stagingHost: string) {
  if (!window.confirm(t("tenants-clone-replace-confirm"))) return;
  await run(stagingHost, async () => {
    await api.replaceFromStaging(token, sourceHost, stagingHost);
    setMsg(t("tenants-clone-replace-done"));
  });
}
```

After (add `const confirm = useConfirm();` near the top of `CloneBox`, alongside its existing `useT()` call):

```tsx
async function replace(stagingHost: string) {
  if (!(await confirm(t("tenants-clone-replace-confirm")))) return;
  await run(stagingHost, async () => {
    await api.replaceFromStaging(token, sourceHost, stagingHost);
    setMsg(t("tenants-clone-replace-done"));
  });
}
```

- [ ] **Step 2: Convert `CloneBox`'s type `<select>` (`App.tsx:2283-2289`)**

Before:
```tsx
<select
  className={`${inputCls} sm:w-64 sm:shrink-0`}
  value={type}
  onChange={(e) => setType(e.target.value as "full" | "design")}
>
  <option value="full">{t("tenants-clone-type-full")}</option>
  <option value="design">{t("tenants-clone-type-design")}</option>
</select>
```

After:
```tsx
<Select value={type} onValueChange={(v) => setType(v as "full" | "design")}>
  <SelectTrigger className="sm:w-64 sm:shrink-0">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="full">{t("tenants-clone-type-full")}</SelectItem>
    <SelectItem value="design">{t("tenants-clone-type-design")}</SelectItem>
  </SelectContent>
</Select>
```

- [ ] **Step 3: Migrate `TenantsPanel`'s quick-create form (`App.tsx:2017` area) to react-hook-form + zod**

Read `App.tsx:2001-2119` first to see the exact current fields the create form collects (department name / host, etc — same shape as `PagesPanel`'s quick-create but confirm the field list against the live file, not this plan, since it wasn't fully quoted during planning). Apply the same conversion pattern Task 6/Step 1 establishes for `CategoriesPanel` (the fully-worked reference example) — one `zod` object schema matching the current fields, `useForm({ resolver: zodResolver(schema) })`, `<Form>`/`<FormField>` wrapping each existing input, `handleSubmit(onCreate)` calling the same `api.*` create call the current `create()` function makes. Do this step *after* Task 6 for that reason — reorder this task to run after Task 6 if the fields turn out non-trivial.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/App.tsx
git commit -m "refactor(admin): Multisite panel uses shadcn Select/AlertDialog/Form"
```

---

### Task 5: Users & Roles (`UsersPanel`, `RolesPanel`)

**Files:**
- Modify: `apps/admin/src/App.tsx:2413-2986`

**Interfaces:**
- Consumes: `useConfirm` (Task 2), `Select` family (Task 1).

- [ ] **Step 1: Convert `UsersPanel`'s delete confirm (`App.tsx:2523`)**

Before:
```tsx
async function removeUser(u: Record<string, unknown>) {
  if (!window.confirm(t("users-delete-confirm"))) return;
  try {
    await api.deletePortalUser(token, u.id as string);
    setEditUserId(null);
    await refresh();
```

After (add `const confirm = useConfirm();` near `UsersPanel`'s top, alongside `useT()`):
```tsx
async function removeUser(u: Record<string, unknown>) {
  if (!(await confirm(t("users-delete-confirm")))) return;
  try {
    await api.deletePortalUser(token, u.id as string);
    setEditUserId(null);
    await refresh();
```

- [ ] **Step 2: Convert the account-type `<select>` (`App.tsx:2558-2565`)**

Before:
```tsx
<select
  className="rounded-lg border border-line/30 bg-white px-2 py-2 text-xs outline-none"
  value={role}
  onChange={(e) => setRole(e.target.value as "webmaster" | "superadmin")}
>
  <option value="webmaster">{t("role-webmaster-label")}</option>
  <option value="superadmin">{t("role-superadmin-label")}</option>
</select>
```

After:
```tsx
<Select value={role} onValueChange={(v) => setRole(v as "webmaster" | "superadmin")}>
  <SelectTrigger className="text-xs">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="webmaster">{t("role-webmaster-label")}</SelectItem>
    <SelectItem value="superadmin">{t("role-superadmin-label")}</SelectItem>
  </SelectContent>
</Select>
```

- [ ] **Step 3: Convert the role-assignment `<select>` (`App.tsx:2570-2578`, conditionally rendered when `role === "webmaster"`)**

Before:
```tsx
<select
  className="rounded-lg border border-line/30 bg-white px-2 py-2 text-xs outline-none"
  value={roleId}
  onChange={(e) => setRoleId(e.target.value)}
>
  <option value="">{t("users-role-none")}</option>
  {roles.map((r) => (
    <option key={r.id as string} value={r.id as string}>{r.name as string}</option>
  ))}
</select>
```

After:
```tsx
<Select value={roleId} onValueChange={setRoleId}>
  <SelectTrigger className="text-xs">
    <SelectValue placeholder={t("users-role-none")} />
  </SelectTrigger>
  <SelectContent>
    {roles.map((r) => (
      <SelectItem key={r.id as string} value={r.id as string}>{r.name as string}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

Note: shadcn's `Select` (Radix `Select.Item`) does not allow an item with `value=""` — the "none" state is expressed via `placeholder` on `SelectValue` plus `roleId` staying `""` until a real role is picked, not via an empty `<SelectItem>`. Confirm downstream code treats `roleId === ""` the same as "no role" already (it does — that's what the native `<option value="">` produced too).

- [ ] **Step 4: Convert the single-tenant-host `<select>` (`App.tsx:2605-2613`, rendered when `role === "webmaster" && !canMultiSite`)**

Before:
```tsx
<select
  className={`${inputCls} w-auto`}
  value={tenantHosts[0] ?? ""}
  onChange={(e) => setTenantHosts(e.target.value ? [e.target.value] : [])}
  required
>
  <option value="">{t("content-pick")}</option>
  {/* ...tenant options... */}
</select>
```

After (same empty-value caveat as Step 3 — use `placeholder`, drop the empty `SelectItem`):
```tsx
<Select
  value={tenantHosts[0] ?? ""}
  onValueChange={(v) => setTenantHosts(v ? [v] : [])}
>
  <SelectTrigger className="w-auto">
    <SelectValue placeholder={t("content-pick")} />
  </SelectTrigger>
  <SelectContent>
    {/* same tenant options, as SelectItem instead of option */}
  </SelectContent>
</Select>
```

Read the option list at `App.tsx:2605-2620` before editing to carry over the exact tenant-mapping JSX (not fully quoted during planning — only the wrapper was).

- [ ] **Step 5: Convert the per-row role-assignment `<select>` (`App.tsx:2659-2667`)**

Same pattern as Step 3, applied to the `assignRole(u, e.target.value)` handler:
```tsx
<Select value={(u.roleId as string | null) ?? ""} onValueChange={(v) => assignRole(u, v)}>
  <SelectTrigger className="text-[11px]">
    <SelectValue placeholder={t("users-role-none")} />
  </SelectTrigger>
  <SelectContent>
    {roles.map((r) => (
      <SelectItem key={r.id as string} value={r.id as string}>{r.name as string}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 6: Convert `RolesPanel`'s delete confirm (`App.tsx:2873`)**

Before:
```tsx
async function remove(id: string) {
  if (!confirm(t("roles-delete-confirm"))) return;
  try {
    await api.deletePortalRole(token, id);
```

After (add `const confirm = useConfirm();` near `RolesPanel`'s top):
```tsx
async function remove(id: string) {
  if (!(await confirm(t("roles-delete-confirm")))) return;
  try {
    await api.deletePortalRole(token, id);
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors. Pay particular attention to any TS error about `roleId`/`tenantHosts` type narrowing around the `value=""` → `placeholder` change in Steps 3/4/5 — that's the one place this task changes behavior-adjacent code, not just markup.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/App.tsx
git commit -m "refactor(admin): Users/Roles panels use shadcn Select + useConfirm"
```

---

### Task 6: Content (`CategoriesPanel`, `PagesPanel`, `PostsPanel`, `BlockBuilder`, `ContentManager`)

**Files:**
- Modify: `apps/admin/src/CategoriesPanel.tsx` (full rewrite — reference example for the RHF+zod pattern used by later tasks)
- Modify: `apps/admin/src/App.tsx:240-746` (`BlockBuilder`, `PagesPanel`, `PostsPanel`)
- Modify: `apps/admin/src/App.tsx:3073-3154` (`ContentManager`)

**Interfaces:**
- Consumes: `useConfirm` (Task 2), `Select` family, `Button`, `Input`, `Form`/`FormField`/`FormItem`/`FormControl`/`FormMessage` (Task 1), `zodResolver` from `@hookform/resolvers/zod`, `useForm` from `react-hook-form`.
- Produces: the canonical "quick-create form" pattern (zod schema + `useForm` + `Form`) that Task 4/Step 3 (`TenantsPanel`) reuses.

- [ ] **Step 1: Rewrite `CategoriesPanel.tsx` — quick-create form**

This is the smallest complete file touched in this plan and the reference implementation for every other quick-create form. Full before/after:

Before (current `create` + form JSX, `CategoriesPanel.tsx:11,28-42,73-78`):
```tsx
const [name, setName] = useState("");
const [creating, setCreating] = useState(false);
// ...
async function create(e: React.FormEvent) {
  e.preventDefault();
  const trimmed = name.trim();
  if (!trimmed) return;
  setCreating(true);
  try {
    await api.createCategory(tenantHost, token, trimmed, slugify(trimmed));
    setName("");
    await refresh();
  } catch (err) {
    setError((err as Error).message);
  } finally {
    setCreating(false);
  }
}
// ...
<form onSubmit={create} className={`${card} flex gap-2 p-4`}>
  <input className={inputCls} placeholder={t("categories-name")} value={name} onChange={(e) => setName(e.target.value)} required />
  <button type="submit" disabled={creating} className={`${btnPrimary} shrink-0`}>
    {creating ? t("categories-creating") : t("categories-create")}
  </button>
</form>
```

After:
```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as api from "@/lib/api";
import { useT, inputCls, btnGhost } from "./App";
import { slugify } from "@/lib/utils";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const createSchema = z.object({ name: z.string().trim().min(1) });
type CreateForm = z.infer<typeof createSchema>;

export default function CategoriesPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<api.Category[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { name: "" } });

  async function refresh() {
    try {
      setCategories(await api.listCategories(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { void refresh(); }, [tenantHost]);

  async function onCreate(values: CreateForm) {
    try {
      await api.createCategory(tenantHost, token, values.name, slugify(values.name));
      form.reset();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    try {
      await api.updateCategory(tenantHost, token, id, trimmed);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("categories-delete-confirm")))) return;
    try {
      await api.deleteCategory(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/content/posts" className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("posts-title")}
      </Link>
      <h2 className="font-display text-sm font-semibold text-ink">{t("categories-title")}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Card>
        <CardContent className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreate)} className="flex gap-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input placeholder={t("categories-name")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
                {form.formState.isSubmitting ? t("categories-creating") : t("categories-create")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <ul className={`${card} divide-y divide-line/20`}>
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-xs">
            {editingId === c.id ? (
              <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void rename(c.id)} autoFocus />
            ) : (
              <span className="flex items-center gap-2">
                <span className="font-semibold text-ink">{c.name}</span>
                <span className="font-mono text-sub">/{c.slug}</span>
              </span>
            )}
            <span className="flex items-center gap-3">
              {editingId === c.id ? (
                <>
                  <Button size="sm" onClick={() => void rename(c.id)}>{t("categories-save")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t("categories-cancel")}</Button>
                </>
              ) : (
                <button onClick={() => { setEditingId(c.id); setEditName(c.name); }} className="rounded p-1 text-body hover:bg-canvas" title={t("categories-rename")}>
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => void remove(c.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("categories-delete")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </span>
          </li>
        ))}
        {categories.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("categories-empty")}</li>}
      </ul>
    </section>
  );
}
```

`card`/`inputCls` stay imported and used for the list `<ul>` and the inline rename `<input>` — this task only touches the create-form and delete-confirm surfaces, matching the migration's targeted scope (spec section D), not a full rewrite of every element in the file. `btnGhost` was unused after this change (the rename/cancel buttons that used it are now `Button variant="ghost"`) — dropped from the import list; `btnPrimary` similarly no longer needed here.

- [ ] **Step 2: Typecheck after `CategoriesPanel`**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors.

- [ ] **Step 3: `PagesPanel` — convert `alert()`, `confirm()`, quick-create form**

`App.tsx:419-426` (before):
```tsx
async function share(id: string) {
  try {
    await api.sharePage(tenantHost, token, id);
    alert(t("pages-shared"));
  } catch (err) {
    setError((err as Error).message);
  }
}
```
After:
```tsx
async function share(id: string) {
  try {
    await api.sharePage(tenantHost, token, id);
    toast(t("pages-shared"));
  } catch (err) {
    setError((err as Error).message);
  }
}
```

`App.tsx:450-456` (before):
```tsx
async function remove(id: string) {
  if (!confirm(t("pages-delete-confirm"))) return;
  try {
    await api.deletePage(tenantHost, token, id);
    await refresh();
```
After (add `const confirm = useConfirm();` near `PagesPanel`'s top, alongside `useT()`):
```tsx
async function remove(id: string) {
  if (!(await confirm(t("pages-delete-confirm")))) return;
  try {
    await api.deletePage(tenantHost, token, id);
    await refresh();
```

`App.tsx:362-402,484-495` (quick-create) — apply the exact `CategoriesPanel` pattern from Step 1: `z.object({ title: z.string().trim().min(1) })`, `useForm`, replace the `title`/`setTitle`/`creating` state with `form`, replace the `<form onSubmit={create}>...</form>` block with the `Form`/`FormField`/`Input`/`Button` structure, keep `create`'s body (slug de-dup + `api.createPage` + `navigate`) as the new `onCreate(values)` handler using `values.title` in place of `trimmed`.

Add the import: `import { toast } from "sonner";` at the top of `App.tsx` (shared by every panel task from here on — only add once, in this task, since it's the first to use it).

- [ ] **Step 4: `PostsPanel` — convert `alert()`, `confirm()`, quick-create form**

Same three conversions, same pattern, at `App.tsx:660-667` (`alert` → `toast`), `App.tsx:669-675` (`confirm` → `useConfirm`), and the quick-create form at `App.tsx:639,698` (read the current field list at `App.tsx:610-658` first — `PostsPanel`'s quick-create may collect more than just title, unlike `PagesPanel`'s; extend the zod schema to match whatever fields are actually there rather than assuming it's title-only).

- [ ] **Step 5: `BlockBuilder`'s block-type `<select>` (`App.tsx:331-345`)**

Before:
```tsx
<select
  className="rounded-lg border border-line/30 bg-white px-2 py-1.5 text-xs outline-none"
  value={addType}
  onChange={(e) => setAddType(e.target.value)}
>
  {Object.entries(BLOCK_TYPES).map(([key, bt]) => (
    <option key={key} value={key}>{/* ...label... */}</option>
  ))}
</select>
```
After:
```tsx
<Select value={addType} onValueChange={setAddType}>
  <SelectTrigger className="text-xs">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {Object.entries(BLOCK_TYPES).map(([key, bt]) => (
      <SelectItem key={key} value={key}>{/* same label content */}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

Read `App.tsx:336-340` for the exact label JSX inside the current `<option>` before writing the `SelectItem` children.

- [ ] **Step 6: `ContentManager`'s site-picker `<select>` (`App.tsx:3104-3112`)**

Before:
```tsx
<select
  className="w-full rounded-lg border border-line/30 bg-white px-3 py-2 text-xs outline-none"
  value={siteHost}
  onChange={(e) => setSiteHost(e.target.value)}
>
  <option value="">{t("content-pick")}</option>
  {tenants.map((tn) => (/* ... */))}
</select>
```
After (same empty-value → `placeholder` treatment as Task 5):
```tsx
<Select value={siteHost} onValueChange={setSiteHost}>
  <SelectTrigger className="w-full">
    <SelectValue placeholder={t("content-pick")} />
  </SelectTrigger>
  <SelectContent>
    {tenants.map((tn) => (/* same mapping, as SelectItem */))}
  </SelectContent>
</Select>
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/CategoriesPanel.tsx apps/admin/src/App.tsx
git commit -m "refactor(admin): Content panels (Pages/Posts/Categories) use shadcn Form/Select, sonner toast"
```

---

### Task 7: Media (`MediaManager`, `MediaPickerModal`)

**Files:**
- Modify: `apps/admin/src/App.tsx:746-1209`
- Modify: `apps/admin/src/MediaPickerModal.tsx`

**Interfaces:**
- Consumes: `useConfirm` (Task 2), `Select` family, `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` (Task 1).

- [ ] **Step 1: `MediaManager`'s three delete confirms (`App.tsx:856-870,871-877,905-910`)**

All three follow the identical shape — add `const confirm = useConfirm();` once near `MediaManager`'s top, then:

```tsx
async function remove(id: string) {
  if (!(await confirm(t("media-delete-confirm")))) return;
  // ...unchanged body...
}

async function bulkDelete() {
  if (!(await confirm(t("media-bulk-delete-confirm")))) return;
  // ...unchanged body...
}

async function removeFolder(id: string) {
  if (!(await confirm(t("media-delete-folder-confirm")))) return;
  // ...unchanged body...
}
```

- [ ] **Step 2: `MediaManager`'s folder `<select>` (`App.tsx:1150-1159`)**

Before:
```tsx
<select
  className="w-full rounded border border-line px-1.5 py-1 text-[10px]"
  value={editForm.folderId}
  onChange={(e) => setEditForm({ ...editForm, folderId: e.target.value })}
>
  <option value="">{t("media-all-files")}</option>
  {folders.map((f) => (/* ... */))}
</select>
```
After:
```tsx
<Select value={editForm.folderId} onValueChange={(v) => setEditForm({ ...editForm, folderId: v })}>
  <SelectTrigger className="text-[10px]">
    <SelectValue placeholder={t("media-all-files")} />
  </SelectTrigger>
  <SelectContent>
    {folders.map((f) => (/* same mapping, as SelectItem */))}
  </SelectContent>
</Select>
```

- [ ] **Step 3: `MediaPickerModal.tsx` — full `Dialog` rewrite**

Before (whole file's return, `MediaPickerModal.tsx:31-53`):
```tsx
return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
    <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-4 rounded-xl bg-white p-5 shadow-xl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">{t("media-picker-title")}</h3>
        <button onClick={onClose} className="rounded p-1 text-sub hover:bg-canvas"><X className="h-4 w-4" /></button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
      <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={`${btnPrimary} flex items-center gap-1.5 self-start`}>
        <Upload className="h-3.5 w-3.5" /> {uploading ? t("media-picker-uploading") : t("media-picker-upload-new")}
      </button>
      <div className="grid flex-1 grid-cols-4 gap-3 overflow-y-auto">
        {items.filter((m) => (m.mimeType as string).startsWith("image/")).map((m) => (
          <button key={m.id as string} onClick={() => onSelect(api.API_URL + (m.url as string))} className="group relative aspect-square overflow-hidden rounded-lg border border-line/30 hover:border-accent">
            <img src={api.API_URL + (m.url as string)} alt={(m.altText as string) ?? ""} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      <button onClick={onClose} className={`${btnGhost} self-end`}>{t("media-picker-cancel")}</button>
    </div>
  </div>
);
```

After (full file):
```tsx
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import * as api from "@/lib/api";
import { useT } from "./App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function MediaPickerModal({
  tenantHost, token, onSelect, onClose,
}: { tenantHost: string; token: string; onSelect: (url: string) => void; onClose: () => void }) {
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listMedia(tenantHost, token).then(setItems).catch((err) => setError((err as Error).message));
  }, [tenantHost]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const url = await api.uploadMedia(tenantHost, token, file);
      onSelect(url.startsWith("http") ? url : api.API_URL + url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("media-picker-title")}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 self-start">
          <Upload className="h-3.5 w-3.5" /> {uploading ? t("media-picker-uploading") : t("media-picker-upload-new")}
        </Button>
        <div className="grid flex-1 grid-cols-4 gap-3 overflow-y-auto">
          {items.filter((m) => (m.mimeType as string).startsWith("image/")).map((m) => (
            <button key={m.id as string} onClick={() => onSelect(api.API_URL + (m.url as string))} className="group relative aspect-square overflow-hidden rounded-lg border border-line/30 hover:border-accent">
              <img src={api.API_URL + (m.url as string)} alt={(m.altText as string) ?? ""} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t("media-picker-cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`open` is a bare `true` (this component is only ever mounted while open — its parent conditionally renders `<MediaPickerModal ... />` itself, same as it conditionally rendered the old fixed-overlay div); `onOpenChange` calling `onClose()` on close covers both the `X` button (now `DialogContent`'s built-in close button, no custom `X` markup needed) and clicking outside/Escape, which the old hand-rolled overlay never supported — a real, free UX improvement worth calling out, not silently absorbed.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/MediaPickerModal.tsx
git commit -m "refactor(admin): Media panel uses shadcn Select/Dialog, adds Escape/outside-click close"
```

---

### Task 8: Theme (`ThemeForm`)

**Files:**
- Modify: `apps/admin/src/App.tsx:1378-2001`

**Interfaces:**
- Consumes: `useConfirm` (Task 2), `Button`, `Card`/`CardContent` (Task 1).

`FontField` (`App.tsx:1274-1332`) is explicitly **not** touched — it's a bespoke typeable+scrollable combobox with live per-row font preview, already documented at length in `CLAUDE.md`. Rebuilding it on shadcn's `Command`/`Popover` combobox pattern is a real, separately-scoped piece of work (needs its own preview-rendering behavior preserved exactly), not a drop-in swap like the plain `<select>`s elsewhere in this plan — deferred, matching the design's YAGNI stance on not rewriting what already works without a concrete need.

- [ ] **Step 1: Wrap the saved-preset action row's buttons in `Button`, add missing delete confirmation**

Before (`App.tsx:1958-1976`) — note `deletePreset` currently has **no confirmation at all**, unlike every other delete action in this file:
```tsx
<button onClick={() => testPreset(p)} className="font-semibold text-body hover:underline">
  {t("theme-preset-test")}
</button>
<button onClick={() => void activatePreset(p)} className="font-semibold text-accent hover:underline">
  {t("theme-preset-activate")}
</button>
<button
  onClick={() => {
    setPresetName(p.name);
    loadPreset(p);
    downloadDesignMd();
  }}
  className="font-semibold text-body hover:underline"
>
  {t("theme-file-download")}
</button>
<button onClick={() => void deletePreset(p.id)} className="text-red-500 hover:text-red-700" title={t("theme-preset-delete")}>
  <Trash2 className="h-3.5 w-3.5" />
</button>
```

After (add `const confirm = useConfirm();` near `ThemeForm`'s top; this is a real behavior change — a confirmation dialog that didn't exist before — called out explicitly, not hidden inside a "just restyling" commit):
```tsx
<Button variant="link" size="sm" onClick={() => testPreset(p)}>
  {t("theme-preset-test")}
</Button>
<Button variant="link" size="sm" onClick={() => void activatePreset(p)}>
  {t("theme-preset-activate")}
</Button>
<Button
  variant="link"
  size="sm"
  onClick={() => {
    setPresetName(p.name);
    loadPreset(p);
    downloadDesignMd();
  }}
>
  {t("theme-file-download")}
</Button>
<Button
  variant="ghost"
  size="icon"
  className="text-red-500 hover:text-red-700"
  title={t("theme-preset-delete")}
  onClick={async () => {
    if (!(await confirm(t("theme-preset-delete-confirm")))) return;
    void deletePreset(p.id);
  }}
>
  <Trash2 className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 2: Add the new confirm-message i18n key**

`apps/admin/src/i18n.ts` — add to both `ms` and `en` dictionaries, next to the existing `theme-preset-*` keys:

```ts
"theme-preset-delete-confirm": "Padam gaya tersimpan ini?",
```
```ts
"theme-preset-delete-confirm": "Delete this saved style?",
```

- [ ] **Step 3: Wrap the saved-preset list in `Card`**

Read `App.tsx:1940-1980` for the exact current wrapper `<div>`/`<ul>` around the preset list and replace its outer container with `<Card><CardContent>...</CardContent></Card>`, keeping the inner `<ul>`/`<li>` structure and the buttons just converted in Step 1.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/i18n.ts
git commit -m "refactor(admin): Theme preset list uses shadcn Button/Card, adds missing delete confirmation"
```

---

### Task 9: Settings (`SettingsPanel`) + shared-style-constant cleanup

**Files:**
- Modify: `apps/admin/src/App.tsx:3167-3252`

**Interfaces:**
- Consumes: `useConfirm`, `Select` family (Task 1/2).

- [ ] **Step 1: Convert the restore confirm (`App.tsx:3204-3215`)**

Before:
```tsx
function pickRestoreFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!window.confirm(t("settings-restore-confirm"))) return;
    void run("restore", async () => {
      await api.restoreTenantBackup(token, host, file);
      setMsg(t("settings-restore-done"));
    });
  };
  input.click();
}
```

`window.confirm` is called inside a plain (non-async) `onchange` callback here, unlike every other site in this plan — `useConfirm`'s `confirm()` is a `Promise<boolean>`, so `onchange` itself must become `async`:

After (add `const confirm = useConfirm();` near `SettingsPanel`'s top):
```tsx
function pickRestoreFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!(await confirm(t("settings-restore-confirm")))) return;
    void run("restore", async () => {
      await api.restoreTenantBackup(token, host, file);
      setMsg(t("settings-restore-done"));
    });
  };
  input.click();
}
```

- [ ] **Step 2: Convert the tenant-host `<select>` (`App.tsx:3222-3228`)**

Before:
```tsx
<select className={inputCls} value={host} onChange={(e) => setHost(e.target.value)}>
  <option value="">{t("settings-tenant")}</option>
  {tenants.map((tn) => (
    <option key={tn.host as string} value={tn.host as string}>
      {(tn.departmentName as string) || (tn.host as string)}
    </option>
  ))}
</select>
```
After:
```tsx
<Select value={host} onValueChange={setHost}>
  <SelectTrigger>
    <SelectValue placeholder={t("settings-tenant")} />
  </SelectTrigger>
  <SelectContent>
    {tenants.map((tn) => (
      <SelectItem key={tn.host as string} value={tn.host as string}>
        {(tn.departmentName as string) || (tn.host as string)}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @usim-cms/admin typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/App.tsx
git commit -m "refactor(admin): Settings panel uses shadcn Select/useConfirm"
```

- [ ] **Step 5: Check whether `inputCls`/`btnPrimary`/`btnGhost` still have any consumers**

```bash
grep -rn "inputCls\|btnPrimary\|btnGhost" apps/admin/src --include="*.tsx" | grep -v "^apps/admin/src/App.tsx:5[4-9]\|^apps/admin/src/App.tsx:6[01]"
```

(excludes the constants' own `export const` declarations at `App.tsx:55-61`). This plan's 9 tasks cover every panel in `App.tsx` plus `CategoriesPanel.tsx`/`MediaPickerModal.tsx` — if this search comes back empty, every consumer has been migrated and the three constants are dead. `Designer.tsx` is out of scope for this plan (Global Constraints) but may still import them — check its imports specifically before removing anything:

```bash
grep -n "inputCls\|btnPrimary\|btnGhost" apps/admin/src/Designer.tsx
```

- [ ] **Step 6: Remove dead constants only if Step 5 found zero non-Designer.tsx consumers AND `Designer.tsx` doesn't import them**

If clear, delete the three unused `export const` lines from `App.tsx:55-61` (keep `card`, which is still used by list-wrapper `<ul>`s throughout this plan's converted panels) and their now-unused imports elsewhere. If `Designer.tsx` (or anything) still imports any of the three, leave all three in place — this step is opportunistic cleanup, not required for Phase 1 to be complete, and must never break an out-of-scope file.

- [ ] **Step 7: Final typecheck + build**

```bash
pnpm --filter @usim-cms/admin typecheck
pnpm --filter @usim-cms/admin build
```

Expected: both 0 errors — this is the last check for the whole plan, so `build` (not just `typecheck`) confirms the complete migrated app actually bundles.

- [ ] **Step 8: Commit (only if Step 6 removed anything)**

```bash
git add apps/admin/src/App.tsx
git commit -m "chore(admin): remove unused legacy style constants after shadcn migration"
```
