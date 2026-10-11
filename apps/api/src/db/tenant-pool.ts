// Barrel: tenant-pool.ts was a 1456-line god-module (~65 exports covering
// connection/provisioning, users/roles, languages, theme, MFA/Entra,
// blueprints, storage limits — all independent, no shared closure state
// beyond the control-plane pool + ensurePublicSchema, both now in
// tenant-pool/internal.ts). Split by concern into tenant-pool/*.ts; this
// file re-exports the exact same public API so none of this module's
// importers need to change.
export type { TenantDb, TenantConnection, SharedContentEntry } from "./tenant-pool/connection.js";
export {
  UnknownTenantError,
  tenantDbName,
  getPoolStats,
  closePool,
  publishSharedContent,
  listSharedContent,
  getTenantMaintenanceMode,
  setTenantMaintenanceMode,
  listTenants,
  getTenantDbSizeBytes,
  createTenant,
  deleteTenant,
  setTenantCertInfo,
  getTenantConnection,
  getTenantRecord,
} from "./tenant-pool/connection.js";

export {
  findUserByEmail,
  findUserById,
  listUsers,
  createUser,
  updateUserRole,
  updateUserPassword,
  updateUserTenantHosts,
  deleteUser,
  setUserTotpSecret,
  setUserTotpEnabled,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  recordLoginAttempt,
  isLoginRateLimited,
  insertAuditLog,
} from "./tenant-pool/users-roles.js";

export {
  listLanguages,
  createLanguage,
  updateLanguage,
  deleteLanguage,
  getTenantLanguageSelection,
  setTenantLanguageSelection,
  getLanguageSwitcherDefaults,
  setLanguageSwitcherDefaults,
} from "./tenant-pool/languages.js";

export {
  getSeoDefaults,
  setSeoDefaults,
  getTenantSeoDefaults,
  setTenantSeoDefaults,
} from "./tenant-pool/seo.js";

export {
  getGlobalTheme,
  setGlobalTheme,
  getMergedTheme,
  getTenantTheme,
  setTenantTheme,
  listThemePresets,
  createThemePreset,
  deleteThemePreset,
} from "./tenant-pool/theme.js";

export type { EntraSettings } from "./tenant-pool/mfa-entra.js";
export {
  getProxyAutomationEnabled,
  setProxyAutomationEnabled,
  getMfaEnabled,
  setMfaEnabled,
  getMfaRequired,
  setMfaRequired,
  getEntraSettings,
  setEntraSettings,
} from "./tenant-pool/mfa-entra.js";

export {
  listPageBlueprints,
  getPageBlueprint,
  createPageBlueprint,
  updatePageBlueprint,
  deletePageBlueprint,
} from "./tenant-pool/blueprints.js";

export type { StorageLimits } from "./tenant-pool/storage.js";
export {
  DEFAULT_MAX_UPLOAD_FILE_SIZE_MB,
  getGlobalStorageLimits,
  setGlobalStorageLimits,
  getTenantStorageLimits,
  setTenantStorageLimits,
  getMergedStorageLimits,
} from "./tenant-pool/storage.js";

export type { BackupDestinationType, BackupDestinationConfig, MaskedBackupDestination } from "./tenant-pool/backup-destination.js";
export { maskBackupDestination, getBackupDestination, setBackupDestination } from "./tenant-pool/backup-destination.js";

export type { S3Settings, MediaStorageConfig, MaskedMediaStorage, MediaMigrationStatus } from "./tenant-pool/media-storage.js";
export {
  maskMediaStorage,
  getMediaStorageSetting,
  setMediaStorageSetting,
  getMediaMigrationStatus,
  setMediaMigrationStatus,
} from "./tenant-pool/media-storage.js";
