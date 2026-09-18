import type { AccessArgs } from "../collections/config-types.js";

// Fixed permission matrix (resource.action) a superadmin composes into named
// roles (schema.ts's roles.permissions) and assigns per webmaster user — see
// docs/superpowers/specs/2026-07-13-admin-branding-features-design.md §12,
// superseded 2026-07-14 from a per-user capability toggle to this full role
// system per user request. "users.manage" stays a stored-but-unenforced
// placeholder: no tenant-scoped multi-user endpoint exists yet to gate.
export const PERMISSIONS = new Set([
  "pages.create",
  "pages.update",
  "pages.delete",
  "posts.create",
  "posts.update",
  "posts.delete",
  "media.upload",
  "media.delete",
  "theme.write",
  "users.manage",
  "sites.multi",
  "languages.write",
  "menus.write",
  "blueprints.write",
  "events.write",
  "headerFooter.write",
]);

// Superadmin bypasses every permission check — a role's permissions are only
// ever consulted for webmaster sessions.
export function hasPermission(args: AccessArgs, permission: string): boolean {
  return args.role === "superadmin" || (args.permissions ?? []).includes(permission);
}

export function mergePermissions(rolePermissions: string[], extraPermissions: string[] | null): string[] {
  return Array.from(new Set([...rolePermissions, ...(extraPermissions ?? [])]));
}

export function validatePermissions(permissions: unknown): string | null {
  if (permissions === undefined) return null;
  if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === "string")) {
    return "permissions must be a string array";
  }
  const unknown = permissions.find((p) => !PERMISSIONS.has(p));
  return unknown ? `unknown permission: ${unknown}` : null;
}
