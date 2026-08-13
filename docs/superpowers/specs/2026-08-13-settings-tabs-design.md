# Settings page: Global/Site tabs

## Problem

`SettingsPanel` (`apps/admin/src/App.tsx`) renders every settings card in one long
vertical scroll: Backup, Static Export, Restore, System Languages, Domain & SSL
Automation. The last two are instance-wide (global) settings; the first three
(plus the per-tenant cert row inside Domain & SSL) only apply to whichever site is
picked from the "Select site" dropdown. Mixing both under one scroll with a single
site-select at the top makes it unclear which settings are global vs per-site.

## Design

Two pill tabs at the top of `SettingsPanel`, reusing the existing Content/Style
pill pattern already in `Designer.tsx` (`flex gap-1 rounded-full bg-canvas p-0.5`).
New local state: `settingsTab: "global" | "site"`, default `"global"`. Same
component, same route (`/settings`) — no new files, no routing change.

**Global tab** (no site-select shown):
- System Languages card — unchanged.
- Domain & SSL Automation card — trimmed to just the master enable switch + DNS
  reminder text. The per-tenant cert list/upload moves to the Site tab.

**Site tab**:
- "Select site" dropdown — moves here, only rendered in this tab.
- Backup card — unchanged.
- Static Export card — unchanged.
- Restore/Migrate card — unchanged.
- SSL & Certificate card — new: scoped to the selected site only (the existing
  `proxyTenants.map(...)` loop is filtered down to the one row matching the
  selected `host`, rendering that site's connection status, resync button, and
  cert upload/revert controls). Only rendered when `proxyEnabled` is true (same
  condition as today) and a site is selected.

## Out of scope

- No change to the underlying API calls (`getProxySettings`,
  `setProxyAutomationEnabled`, `resyncProxy`, `uploadTenantCert`,
  `revertTenantCert`, language CRUD) — purely a layout/grouping change.
- No change to permissions/access control — Settings stays superadmin-only.
