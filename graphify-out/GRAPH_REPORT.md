# Graph Report - usim_cms  (2026-11-03)

## Corpus Check
- 249 files · ~488,882 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2974 nodes · 7031 edges · 175 communities (136 shown, 35 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 205 edges (avg confidence: 0.85)
- Token cost: 395,410 input · 0 output

## Community Hubs (Navigation)
- Collections CRUD Actions
- Shadcn Accordion/Avatar Components
- Admin API Client & Backups
- Designer Row/Block Controls
- Admin App Shell & I18n
- Collection Config & Access Rules
- Categories Panel List UI
- Designer Canvas Block Path
- Element Preview Free Position
- Metrics & Tenant Rate Limiting
- Auth MFA/CSRF Primitives
- Designer Architecture Overview
- Field Group Controls UI
- Fontjoy Font Pairing
- Frontend API & Blueprint Cache
- Install.sh VPS Installer
- Media Storage & Validation
- Admin Package Dependencies
- Tailwind UI Class Helpers
- Designer Element Palette
- Monitor Server Deploy State
- Field Controls Inputs
- Tenant Management & Proxy
- BlockNote Bookmark Card
- Admin Package Metadata
- Monitor Backup & Diagnostics
- Events Calendar Astro Block
- Element Render Styling
- Settings Panel Languages/SSL
- Redis Cache Client
- Astro Content Blocks
- Astro Hero/Generic Blocks
- Backup Clone Store
- Monitor User Management
- Drizzle DB Schema Tables
- Scrypt Password & TOTP
- Page Blueprints & Sessions
- Tenant Database Provisioning
- Local-Dev Installer Script
- Frontend Package Dependencies
- Categories Panel Actions
- API Package Dependencies
- Deploy Version Checks
- Designer History Autosave
- Backup/Media/Deploy Decisions
- Core API Collections & Crypto
- Designer Chrome Toolbar
- Live Edit Palette Drag
- Password Hashing & Languages
- Element Style Package
- Media Storage Migration
- Header/Footer Chrome Presets
- Free Element Drag/Resize
- Deployment Architecture Docs
- Monitor Docker Compose Status
- Element Render Package Config
- Element Style Package Config
- Live Edit Builder Features
- Breakpoint Style Helpers
- Block Ops Unit Tests
- Page Language Live Edit
- Media Manager UI
- Tenant/User CLI Scripts
- Designer/Inspector Components
- Inspector Box Model Controls
- API Package Core Deps
- ESLint Flat Config
- Tenant DB Advisory Lock
- Admin SPA Editor Stack
- Shadcn Components Config
- Menu Link Validation
- Monorepo Tooling & CI
- Entra SSO & MFA Flow
- Alert Dialog Component
- Clone Box Actions
- API Package Scripts
- Uploads Volume Migration
- Live Edit Security Headers
- Admin Dev Dependencies
- Users Panel Role Actions
- Multi-Tenant Architecture Docs
- Frontend Package Core Deps
- Element Render TS Config
- Element Schema TS Config
- Element Style TS Config
- Deploy.sh Blue-Green Script
- Admin Session Impersonation
- Style/Clipboard Copy Helpers
- Page Language Hook
- Admin App TS Config
- Post Content Sanitization
- Root Workspace Scripts
- Shared TS Compiler Options
- Menu Items Editor
- Mega Menu Editor
- API TS Config
- Frontend Cache/Tenant API
- Playwright Smoke Tests
- Breakpoint Value Setters
- QR Code Generator Types
- Admin Static Server CSP
- Events ICS/Robots Routes
- Monitor Security Audit Script
- Element Render Scripts
- Blueprint Gallery Actions
- Social Icon Picker
- Node TS Config
- I18n Phase Decisions
- Element Schema Scripts
- Live Scroll Stage
- Header/Footer Chrome List
- Roles Panel Actions
- Admin TS References
- Posts Taxonomy & Security Design
- Tenant Backup Script
- Frontend Dev Dependencies
- Backup Cron & CI Docs
- I18n System Rationale
- Frontend Static Server
- ESLint/Prettier Dev Deps
- Link Input Autocomplete
- Security Panel MFA UI
- Media Backup Script
- Backup Download Actions
- Entra SSO Design Decisions
- Frontend TS Config
- Install.ps1 Windows Script
- Dashboard Test Fixtures
- Element Style Sanitize Helpers
- Monitor Access Env Script
- Spacing Drag Control
- Backup Destination Mapper
- Login Settings Mapper
- Pages/Posts List Query
- Menu Item Types
- Media Upload Body Parser
- Collections RLS Design
- Blue-Green Deploy Config
- ESLint Astro Exclusions
- Monitor Package Metadata
- Monitor Supervisor Worker
- Build Images Script
- Monitor Access Caddy Client
- Runtime Config Script
- Login Rate Limiting Design
- MFA Enrollment Design
- Maintenance Mode Design
- Database-per-Tenant Design
- Provisioner Secret Rotation
- DB Role Secret Rotation
- CI Workflow Config
- Prettier Config
- Provisioner Secret Setup
- Setup Secret Script
- Monitor Caddy Test
- Monitor Rolling Enable
- Monitor Users Script
- Device Preview Modal
- Drag-Slider Numeric Fields
- Live Edit Exact Preview
- Designer E2E Smoke Test
- Missing FK Indexes
- Media Alt Text Rule
- Tenant Pool Idle Eviction
- Tenant Host Denial Check
- Cost Discipline Policy
- Backup Includes Site Chrome
- Symbols vs Templates Design
- Admin Docker Service
- Fastify Backend Note
- React Admin UI Note

## God Nodes (most connected - your core abstractions)
1. `request()` - 140 edges
2. `cn()` - 113 edges
3. `ensurePublicSchema()` - 85 edges
4. `react` - 80 edges
5. `useT()` - 74 edges
6. `lucide-react` - 54 edges
7. `Key` - 47 edges
8. `blockOpsFns()` - 43 edges
9. `registerAuthRoutes()` - 43 edges
10. `server` - 43 edges

## Surprising Connections (you probably didn't know these)
- `typescript-eslint recommended configs` --semantically_similar_to--> `TypeScript strict mode enabled`  [INFERRED] [semantically similar]
  eslint.config.mjs → tsconfig.base.json
- `apps/admin (React SPA)` --references--> `lucide-react`  [EXTRACTED]
  docs/ARSITEKTUR.md → apps/admin/package.json
- `apps/api (Fastify engine)` --references--> `drizzle-orm`  [EXTRACTED]
  docs/ARSITEKTUR.md → apps/api/package.json
- `apps/api (Fastify engine)` --references--> `fastify`  [EXTRACTED]
  docs/ARSITEKTUR.md → apps/api/package.json
- `apps/api (Fastify engine)` --references--> `drizzle-kit`  [EXTRACTED]
  docs/ARSITEKTUR.md → apps/api/package.json

## Import Cycles
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/MenusPanel.tsx -> apps/admin/src/MenuItemsEditor.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/CategoriesPanel.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/MediaManager.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/PagesPanel.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/PostsPanel.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/SettingsPanel.tsx -> apps/admin/src/MediaStorageCard.tsx -> apps/admin/src/App.tsx`
- 4-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/MenusPanel.tsx -> apps/admin/src/MenuItemsEditor.tsx -> apps/admin/src/App.tsx`

## Hyperedges (group relationships)
- **Workspace-wide TypeScript + ESLint enforcement** —  [INFERRED]
- **Bundler-driven transpilation strategy** —  [INFERRED]
- **i18n Multi-Phase Implementation** — apps_api_i18n_phase_1_global_language_registry, apps_api_i18n_phase_2_per_tenant_subset, apps_api_i18n_phase_3_4_content_translations, apps_api_i18n_phase_5_opt_in_switch, apps_api_i18n_phase_5_default_language [INFERRED]
- **Auth Hardening Suite** — apps_api_auth_rate_limiting_tenant, apps_api_auth_login_rate_limiting, apps_api_auth_entra_id_sso, apps_api_auth_entra_login_csrf, apps_api_auth_mfa_totp, apps_api_auth_mfa_mandatory_enrollment, apps_api_auth_session_cookie_csrf [INFERRED]
- **Security validation boundary** — packages_element_schema_src_index_validation, css_injection_threat_vector, xss_threat_vector [INFERRED]
- **Designer Canvas & Rendering System** — apps_admin_designer_page_builder, apps_admin_designer_live_edit, apps_admin_designer_device_preview_modal, apps_admin_designer_live_edit_preview_unified, apps_admin_claude_canva_style_autosave, apps_api_pages_revisions_history [INFERRED]
- **Cross-app render consistency pattern** — packages_element_render_src_index_render_value_computation, apps_admin_designer_canvas, apps_frontend_renderer [INFERRED]
- **Microsoft Entra ID SSO Authentication Flow** — apps_api_claude_entra_id_sso, apps_api_claude_login_csrf_fix, apps_admin_claude_entra_sso_client, apps_admin_claude_router_shell, docs_security_owasp_asvs_status_assessment [INFERRED 0.85]
- **MFA TOTP Enrollment and Verification Flow** — apps_api_claude_mfa_totp, apps_api_claude_login_rate_limiting, apps_admin_claude_mfa_enrollment, apps_admin_claude_qrcode_component, docs_security_owasp_asvs_status_assessment [INFERRED 0.85]
- **Blue-Green Zero-Downtime Deployment Pipeline** — claude_skills_deployment_skill_blue_green_deploy, claude_skills_deployment_skill_smoke_test, docker_compose_db_service, docker_compose_release_api_service, docker_compose_proxy_service, claude_skills_deployment_skill_monitor_server_js [EXTRACTED 1.00]

## Communities (175 total, 35 thin omitted)

### Community 0 - "Collections CRUD Actions"
Cohesion: 0.02
Nodes (91): createCategory(), createMediaFolder(), createMenu(), createPortalLanguage(), createPortalRole(), createPost(), createSiteChrome(), createSymbol() (+83 more)

### Community 1 - "Shadcn Accordion/Avatar Components"
Cohesion: 0.04
Nodes (72): AccordionContent, AccordionItem, AccordionTrigger, Avatar, AvatarFallback, AvatarImage, Command, CommandEmpty (+64 more)

### Community 2 - "Admin API Client & Backups"
Cohesion: 0.02
Nodes (78): API_URL, BackupDestination, BackupDestinationPatch, BackupDestinationType, CloneMeta, ContentSearchResult, createBlueprint(), createEvent() (+70 more)

### Community 3 - "Designer Row/Block Controls"
Cohesion: 0.08
Nodes (71): rowDragProps(), DesignerCanvas(), BlockControls(), DesignerDevicePreviewModal(), DesignerTemplatesModal(), blockOpsFns(), boxAction(), copyColumn() (+63 more)

### Community 4 - "Admin App Shell & I18n"
Cohesion: 0.05
Nodes (54): authenticatedRouter, BlueprintGallery, I18nCtx, LanguageSwitcher(), NAV_GROUP_LABEL, NAV_GROUP_ORDER, NavButton(), NavGroup (+46 more)

### Community 5 - "Collection Config & Access Rules"
Cohesion: 0.05
Nodes (59): getCacheStats(), AccessArgs, AccessFn, CollectionConfig, CollectionHooks, RevisionsConfig, events, closePool() (+51 more)

### Community 6 - "Categories Panel List UI"
Cohesion: 0.07
Nodes (55): ListEmpty(), ListLoading(), PAGE_SIZE, CreateForm, createSchema, Button, ButtonProps, buttonVariants (+47 more)

### Community 7 - "Designer Canvas Block Path"
Cohesion: 0.10
Nodes (44): section(), ChromePreset, ChromePresetCtx, ChromePresetsModal(), Glyph(), JUSTIFY, DesignerCtx, DesignerCanvasProps (+36 more)

### Community 8 - "Element Preview Free Position"
Cohesion: 0.08
Nodes (57): arePropsEqual(), ElPreviewImpl(), EMBED_RATIO, FreeRectPct, FreeSiblingPct, mergeElBp(), RESIZE_HANDLES, ResizeDir (+49 more)

### Community 9 - "Metrics & Tenant Rate Limiting"
Cohesion: 0.09
Nodes (55): GET /metrics Prometheus Endpoint, Per-Tenant Request Budget (isTenantRateLimited), BackupDestinationConfig, BackupDestinationType, getBackupDestination(), maskBackupDestination(), MaskedBackupDestination, setBackupDestination() (+47 more)

### Community 10 - "Auth MFA/CSRF Primitives"
Cohesion: 0.10
Nodes (54): createAuthStamp(), generateCsrfToken(), isMfaSetupRequired(), matchesAuthStamp(), totpAuthUri(), verifyPasswordOrDummy(), verifySession(), verifyTotpCode() (+46 more)

### Community 11 - "Designer Architecture Overview"
Cohesion: 0.06
Nodes (56): Designer.tsx admin canvas, Frontend site renderer, Per-breakpoint field overrides, CSS-injection via semicolon/paren/brace escaping, Unified design element system, WCAG contrast calculation, Free-positioned element style computation, Margin/padding style helpers (+48 more)

### Community 12 - "Field Group Controls UI"
Cohesion: 0.08
Nodes (40): BASE_LANG, BpToggle(), BufferedInput(), FieldGroups(), COLUMN_FIELDS, COLUMN_SPACING_KEYS, CSS_CLASS_FIELD, FIELD_GROUP_BY_KEY (+32 more)

### Community 13 - "Fontjoy Font Pairing"
Cohesion: 0.06
Nodes (50): FontjoyPairing, fontVectors, headingFaces, matchingScore(), rankedPairings, readingFaces, similarity(), similarityCache (+42 more)

### Community 14 - "Frontend API & Blueprint Cache"
Cohesion: 0.06
Nodes (41): applyLangOverrides(), BlueprintPreview, cache, Category, EventItem, fetchMenuLinkTargets(), getDefaultSiteChrome(), getSiteChromeById() (+33 more)

### Community 15 - "Install.sh VPS Installer"
Cohesion: 0.12
Nodes (47): _apply_backup_cron_files(), close_firewall_port(), configure_image_source(), configure_media_storage(), configure_optional_integrations(), create_superadmin(), create_superadmin_production(), curl_reachable() (+39 more)

### Community 16 - "Media Storage & Validation"
Cohesion: 0.12
Nodes (38): MediaMigrationStatus, S3Settings, beginsWith(), matchesAllowedMediaSignature(), ZIP_SIGNATURES, deleteImageVariants(), generateImageVariants(), ImageMeta (+30 more)

### Community 17 - "Admin Package Dependencies"
Cohesion: 0.05
Nodes (44): dependencies, @blocknote/core, @blocknote/mantine, @blocknote/react, class-variance-authority, clsx, cmdk, @hookform/resolvers (+36 more)

### Community 18 - "Tailwind UI Class Helpers"
Cohesion: 0.12
Nodes (28): btnGhost, btnPrimary, card, FormError(), inputCls, PERMISSION_LABEL_KEY, PERMISSIONS, SelectContent (+20 more)

### Community 19 - "Designer Element Palette"
Cohesion: 0.08
Nodes (33): ClipLevel, AddElementMenu(), DesignerPalette(), DesignerPaletteProps, PaletteGroups(), paletteTypes, presetIcon(), Tile (+25 more)

### Community 20 - "Monitor Server Deploy State"
Cohesion: 0.08
Nodes (38): authFailures, checkAuth(), cmpVer(), DEPLOY_LOG, DEPLOY_STATE_FILE, deployState, getBackupDestinationRow(), getDockerDiskUsage() (+30 more)

### Community 21 - "Field Controls Inputs"
Cohesion: 0.08
Nodes (25): BufferedTextarea(), DragNumber(), FontPickerInput(), LangToggle(), NumberStepper(), FieldGroupsProps, FieldInputProps, ARROW_LABEL (+17 more)

### Community 22 - "Tenant Management & Proxy"
Cohesion: 0.14
Nodes (32): getTenantDbSizeBytes(), listTenants(), setTenantCertInfo(), getEdgeProtectionSettings(), normalize(), getProxyAutomationEnabled(), buildCaddyConfig(), caddyRequest() (+24 more)

### Community 23 - "BlockNote Bookmark Card"
Cohesion: 0.07
Nodes (23): BOOKMARK_CARD_STYLE, bookmarkCardBlockSpec, bookmarkCardSchema, createBookmarkCardBlockSpec, SeoPreviewCard(), PostEditorPage, MediaPickerModal(), autoExcerpt() (+15 more)

### Community 24 - "Admin Package Metadata"
Cohesion: 0.06
Nodes (28): tsx, name, private, type, version, QrCode(), Badge(), BadgeProps (+20 more)

### Community 25 - "Monitor Backup & Diagnostics"
Cohesion: 0.11
Nodes (34): authBlockRemaining(), authClientKey(), getBackupCronStatus(), getDbSizes(), getDockerDiskUsageVerbose(), getPreflightCheck(), handleAlertTest(), handleApplyBackupCronUpdate() (+26 more)

### Community 26 - "Events Calendar Astro Block"
Cohesion: 0.08
Nodes (24): [], boxStyle, events, now, rangeEnd, cells, currentSearch, daysInMonth (+16 more)

### Community 27 - "Element Render Styling"
Cohesion: 0.10
Nodes (26): bestTextColor(), BORDER, computeFreePositionStyle(), contrastRatio(), elBorderShadowStyle(), elMarginStyle(), elPaddingStyle(), elRadius() (+18 more)

### Community 28 - "Settings Panel Languages/SSL"
Cohesion: 0.10
Nodes (24): SettingsPanel(), addLanguage(), pickRestoreFile(), reloadBackupDestination(), reloadEdgeProtection(), reloadLanguages(), reloadLoginSettings(), reloadProxySettings() (+16 more)

### Community 29 - "Redis Cache Client"
Cohesion: 0.12
Nodes (26): cacheGet(), cacheInvalidate(), cacheSet(), getClient(), getRedisClient(), publishSharedContent(), TenantDb, accessArgs() (+18 more)

### Community 30 - "Astro Content Blocks"
Cohesion: 0.23
Nodes (15): renderInline(), cls(), elBorderShadowStyle(), fluidClamp(), fluidTextSize(), headingTag(), ICON_PATHS, imgAlignStyle() (+7 more)

### Community 31 - "Astro Hero/Generic Blocks"
Cohesion: 0.11
Nodes (18): bgUrl, v, addHandle(), getBlueprintPreview(), getLivePreviewOverride(), getPageBySlug(), SiteChrome, addFonts() (+10 more)

### Community 32 - "Backup Clone Store"
Cohesion: 0.17
Nodes (24): BackupTables, CloneMeta, cloneStore, DATE_KEYS, deleteClone(), exportStaticSite(), exportTenantBackup(), exportTenantDesignClone() (+16 more)

### Community 33 - "Monitor User Management"
Cohesion: 0.19
Nodes (25): [command, username], addUser(), authCache, authenticate(), changePassword(), checkFile(), DUMMY_USER, fileKey() (+17 more)

### Community 34 - "Drizzle DB Schema Tables"
Cohesion: 0.08
Nodes (25): auditLog, categories, designTemplates, languages, loginAttempts, media, mediaFolders, menus (+17 more)

### Community 35 - "Scrypt Password & TOTP"
Cohesion: 0.12
Nodes (22): acquireScryptSlot(), base32Decode(), base32Encode(), derivePasswordKey(), DUMMY_PASSWORD, DUMMY_PASSWORD_HASH_CURRENT, DUMMY_PASSWORD_HASH_LEGACY, generateTotpSecret() (+14 more)

### Community 36 - "Page Blueprints & Sessions"
Cohesion: 0.16
Nodes (18): signSession(), createPageBlueprint(), deletePageBlueprint(), getPageBlueprint(), listPageBlueprints(), updatePageBlueprint(), createThemePreset(), deleteThemePreset() (+10 more)

### Community 37 - "Tenant Database Provisioning"
Cohesion: 0.13
Nodes (22): assertValidTenantHost(), createTenant(), deleteTenant(), deriveTenantDbUrl(), ensureTenantDatabase(), getTenantPool(), idleSweepTimer, lookupTenantCached() (+14 more)

### Community 38 - "Local-Dev Installer Script"
Cohesion: 0.20
Nodes (23): checkDocker(), createSuperadmin(), ensureCredentials(), ensureReachableOrReport(), fetchStatusCode(), fillEnvIfBlank(), findFreePort(), flags (+15 more)

### Community 39 - "Frontend Package Dependencies"
Cohesion: 0.10
Nodes (20): @tailwindcss/vite, @ucms/element-render, ioredis, @types/sanitize-html, tsx, name, private, type (+12 more)

### Community 40 - "Categories Panel Actions"
Cohesion: 0.15
Nodes (19): CategoriesPanel(), onCreate(), refresh(), remove(), rename(), toggleMultilang(), slugify(), pageHasContent() (+11 more)

### Community 41 - "API Package Dependencies"
Cohesion: 0.09
Nodes (21): devDependencies, drizzle-kit, tsx, @types/node, @types/pg, @types/sanitize-html, typescript, tsx (+13 more)

### Community 42 - "Deploy Version Checks"
Cohesion: 0.14
Nodes (22): computeVersionChecks(), dockerHubTags(), finishStackDeploy(), getOutdatedBreakdown(), getStackVersions(), getUpstreamLatest(), handleDepsCheck(), handleDepsUpdate() (+14 more)

### Community 43 - "Designer History Autosave"
Cohesion: 0.23
Nodes (21): DesignerHistoryModal(), DesignerTopBar(), usePersist(), autosave(), currentTranslationsPayload(), loadHistory(), markSaved(), mintPreviewSrc() (+13 more)

### Community 44 - "Backup/Media/Deploy Decisions"
Cohesion: 0.13
Nodes (21): backup.ts Export/Import/Clone, Media Location Phases 1-3, Media Upload Extension Fix (Stored XSS), Runtime Backup Destination Setting, Blue-Green Zero-Downtime Deploy (deploy.sh), Postgres/PgBouncer Connection Budget, Disk Hygiene Fixes (2026-10-10), monitor/server.js Ops Dashboard (+13 more)

### Community 45 - "Core API Collections & Crypto"
Cohesion: 0.10
Nodes (21): Active collections (pages/posts/templates/categories/menus), apps/api (Fastify engine), audit_log, @aws-sdk/client-s3 + lib-storage, Generic CRUD / CollectionConfig mechanism, Decision: hand-rolled crypto via node:crypto, Entra ID / SSO (planned extension point), fflate (+13 more)

### Community 46 - "Designer Chrome Toolbar"
Cohesion: 0.12
Nodes (11): Designer(), onKey(), useLiveEditBridge(), enterLive(), handleFrameLoad(), postShowSlides(), toggleLive(), AnyFn (+3 more)

### Community 47 - "Live Edit Palette Drag"
Cohesion: 0.20
Nodes (17): LiveEditPaletteDragApi, LiveEditPaletteDragDeps, useLiveEditPaletteDrag(), cleanup(), onCancel(), onCancelEvent(), onLostCapture(), onMessage() (+9 more)

### Community 48 - "Password Hashing & Languages"
Cohesion: 0.21
Nodes (18): hashPassword(), validatePasswordInput(), createLanguage(), deleteLanguage(), guardLastEnabled(), listLanguages(), updateLanguage(), createRole() (+10 more)

### Community 49 - "Element Style Package"
Cohesion: 0.11
Nodes (18): @ucms/element-style, dependencies, @ucms/element-style, devDependencies, tsx, @types/node, typescript, tsx (+10 more)

### Community 50 - "Media Storage Migration"
Cohesion: 0.25
Nodes (17): getMediaMigrationStatus(), getMediaStorageSetting(), MaskedMediaStorage, maskMediaStorage(), MediaStorageConfig, readRow(), setMediaMigrationStatus(), setMediaStorageSetting() (+9 more)

### Community 51 - "Header/Footer Chrome Presets"
Cohesion: 0.19
Nodes (13): button(), CHROME_PRESETS, copyright(), DARK_MENU, el(), hbox(), iconText(), logo() (+5 more)

### Community 52 - "Free Element Drag/Resize"
Cohesion: 0.24
Nodes (16): guideLine(), startFreeElDrag(), move(), up(), startFreeElResize(), move(), up(), startFreeElRotate() (+8 more)

### Community 53 - "Deployment Architecture Docs"
Cohesion: 0.15
Nodes (18): architecture.md / features-spec.md (original product brief), apps/api/scripts/backup-media.sh (rsync media backup), apps/api/scripts/backup.sh (pg_dump cron), Blue-green zero-downtime deploy, Caddyfile, Deployment architecture (edge/apps/data layers), Designer.tsx (large orchestration component), docker-compose.release.yml (api/frontend/admin) (+10 more)

### Community 54 - "Monitor Docker Compose Status"
Cohesion: 0.16
Nodes (18): composeArgsFor(), currentColor(), getAllContainers(), getComposeStatus(), getGitInfo(), getHostStats(), getStatus(), getSystemdStatus() (+10 more)

### Community 55 - "Element Render Package Config"
Cohesion: 0.12
Nodes (16): @types/node, devDependencies, tsx, @types/node, typescript, tsx, main, name (+8 more)

### Community 56 - "Element Style Package Config"
Cohesion: 0.12
Nodes (16): TypeScript, devDependencies, tsx, @types/node, typescript, tsx, main, name (+8 more)

### Community 57 - "Live Edit Builder Features"
Cohesion: 0.13
Nodes (16): Canva-style Draft Autosave, Live Edit Bridge, Designer Page Builder Canvas, Recursive Container Element, Row Flex Container, Selection Path Mutation De-hardcoding, Menus: Nested Navigation Tree, Pages Revisions: History Snapshots (+8 more)

### Community 58 - "Breakpoint Style Helpers"
Cohesion: 0.22
Nodes (13): fourSideValue(), Bp, BpStyleApi, bpStyleFns(), bpGetValue(), bpKey(), bpKeysOverridden(), sideValue() (+5 more)

### Community 59 - "Block Ops Unit Tests"
Cohesion: 0.15
Nodes (8): NestedEl, __testOnly_blockOpsFns(), SetHoverBand, __testOnly_undoRedoFns(), UndoRedoApi, undoRedoFns(), useUndoRedo(), immer

### Community 60 - "Page Language Live Edit"
Cohesion: 0.16
Nodes (9): usePageAndLanguage(), clickPageLanguagePill(), elTypeAtPath(), langStackKeysOverridden(), loadRestoredPage(), retranslatePageLanguage(), seedMissingTextOverrides(), switchPageLanguage() (+1 more)

### Community 61 - "Media Manager UI"
Cohesion: 0.21
Nodes (12): MediaManager(), addFolder(), bulkDelete(), onDrop(), onFileChosen(), refreshFolders(), refreshItems(), remove() (+4 more)

### Community 62 - "Tenant/User CLI Scripts"
Cohesion: 0.12
Nodes (13): bootstrapSql, client, departmentName, [host, ...nameParts], bootstrapSql, client, [email, password, role, tenantHost], bootstrapSql (+5 more)

### Community 63 - "Designer/Inspector Components"
Cohesion: 0.19
Nodes (15): Designer.tsx Page Builder, ElPreview.tsx Component, Inspector.tsx Component, Elements Palette Layout Category, Slider/Banner Rework (2026-09-05), Slider Canvas Canva-style Controls, i18n Phases 1-5 (Language Registry Effort), Pages i18n Rework — Sparse Style Overrides (+7 more)

### Community 64 - "Inspector Box Model Controls"
Cohesion: 0.16
Nodes (12): BoxModelInput(), CORNERS, FlexIconGroup(), FourSideControl(), newEl(), RingConfig, Side, SIDES (+4 more)

### Community 65 - "API Package Core Deps"
Cohesion: 0.13
Nodes (15): dependencies, @aws-sdk/client-s3, @aws-sdk/lib-storage, drizzle-orm, fastify, @fastify/cors, @fastify/helmet, @fastify/multipart (+7 more)

### Community 66 - "ESLint Flat Config"
Cohesion: 0.15
Nodes (13): ESLint Flat Config (v9+), @eslint/js recommended config, eslint-plugin-react-hooks, apps/admin TypeScript/TSX linting scope, name, packageManager, private, version (+5 more)

### Community 67 - "Tenant DB Advisory Lock"
Cohesion: 0.15
Nodes (13): PostgreSQL advisory lock (provisioning/migration coordination), Database-per-tenant architecture, deriveTenantDbUrl, Row-Level Security (RLS), public.shared_content (Share to portal), public.site_theme + getMergedTheme, tenant-pool.ts / getTenantConnection, tenantPools connection cache (+5 more)

### Community 68 - "Admin SPA Editor Stack"
Cohesion: 0.15
Nodes (14): apps/admin (React SPA), BlockNote rich-text editor, GET /api/content-search (@-mention bookmark card), httpOnly cookie session + CSRF token header, Embla Carousel (frontend slider renderer), Page Designer (Builder), Post/Article Editor, post_revisions (revision history) (+6 more)

### Community 69 - "Shadcn Components Config"
Cohesion: 0.15
Nodes (12): aliases, components, utils, iconLibrary, rsc, $schema, style, tailwind (+4 more)

### Community 70 - "Menu Link Validation"
Cohesion: 0.26
Nodes (11): LINK_TYPES, LinkType, validateCommonItemFields(), validateItem(), validateLinkFields(), validateMegaMenu(), validateMegaMenuItem(), validateMenuItems() (+3 more)

### Community 71 - "Monorepo Tooling & CI"
Cohesion: 0.18
Nodes (12): ESLint 9 + Prettier 3, pnpm workspace & tooling, node:test + CI (lint/typecheck/build/E2E Playwright), TypeScript esModuleInterop enabled, TypeScript isolatedModules enabled, TypeScript module: ESNext, TypeScript moduleResolution: Bundler, TypeScript resolveJsonModule enabled (+4 more)

### Community 72 - "Entra SSO & MFA Flow"
Cohesion: 0.18
Nodes (12): Entra ID SSO Client Flow (App.tsx/LoginForm), Mandatory MFA Enrollment Flow, QrCode.tsx (wraps qrcode-generator), App.tsx BrowserRouter Shell, Admin SPA Entry Point (index.html), MIT License (Jack Qiao) — public/fontjoy-license.txt, MIT License (Jack Qiao) — src/fontjoy-data/LICENSE.txt, Audit Log (audit_log table) (+4 more)

### Community 73 - "Alert Dialog Component"
Cohesion: 0.27
Nodes (10): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+2 more)

### Community 74 - "Clone Box Actions"
Cohesion: 0.29
Nodes (11): CloneBox(), promote(), refresh(), remove(), replace(), run(), stage(), SiteOpsPanel() (+3 more)

### Community 75 - "API Package Scripts"
Cohesion: 0.17
Nodes (12): scripts, build, db:generate, db:migrate, db:setup-role, dev, start, tenant:add (+4 more)

### Community 76 - "Uploads Volume Migration"
Cohesion: 0.42
Nodes (11): check_path(), copy_all(), copy_delta(), die(), ensure_volume(), ensure_writable(), env_get(), env_set() (+3 more)

### Community 77 - "Live Edit Security Headers"
Cohesion: 0.18
Nodes (11): Blocks Mode Canvas (DesignerCanvas.tsx), Free Positioning for Slide Elements, Live Edit Iframe Bridge, BaseLayout.astro Live Edit for Header/Footer, CSP / Security Response Headers (server.mjs), Sticky/Transparent Header Feature, liveEditDropTarget.ts (pure drop-target math), Live Edit Drag-to-Add Implementation Plan (+3 more)

### Community 78 - "Admin Dev Dependencies"
Cohesion: 0.18
Nodes (11): devDependencies, @playwright/test, tailwindcss, @tailwindcss/vite, tsx, @types/node, @types/react, @types/react-dom (+3 more)

### Community 80 - "Multi-Tenant Architecture Docs"
Cohesion: 0.22
Nodes (11): Database-per-Tenant Multi-Tenancy, getTenantConnection(), Astro SSR Renderer Architecture, Historical Product Brief (architecture.md), Advanced Payload CMS Features Concept, CLAUDE.md (Root Repository Guidance), CollectionConfig Registration Pattern, pnpm Workspace Monorepo (3 apps) (+3 more)

### Community 81 - "Frontend Package Core Deps"
Cohesion: 0.18
Nodes (11): dependencies, astro, @astrojs/node, daisyui, ioredis, sanitize-html, swiper, tailwindcss (+3 more)

### Community 82 - "Element Render TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, types, exclude (+2 more)

### Community 83 - "Element Schema TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, types, exclude (+2 more)

### Community 84 - "Element Style TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, types, exclude (+2 more)

### Community 85 - "Deploy.sh Blue-Green Script"
Cohesion: 0.38
Nodes (9): container_healthy(), dial_json(), do_deploy(), do_rollback(), promote(), pull_images(), deploy.sh script, smoke_test() (+1 more)

### Community 86 - "Admin Session Impersonation"
Cohesion: 0.22
Nodes (5): App(), loadSession(), Toaster(), ToasterProps, next-themes

### Community 88 - "Page Language Hook"
Cohesion: 0.44
Nodes (6): PageAndLanguageDeps, applyLangOverrides(), isTextKey(), migrateOldTranslation(), pathKey(), TRANSLATABLE_TEXT_KEYS

### Community 89 - "Admin App TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, baseUrl, jsx, lib, noEmit, paths, exclude, extends (+1 more)

### Community 90 - "Post Content Sanitization"
Cohesion: 0.27
Nodes (5): getPostBySlug(), resolvePostContent(), ALLOWED_TAGS, sanitizeCustomHtml(), requestedLang

### Community 92 - "Root Workspace Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev:admin, dev:api, dev:frontend, format, format:check, lint (+2 more)

### Community 93 - "Shared TS Compiler Options"
Cohesion: 0.20
Nodes (10): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution, resolveJsonModule, skipLibCheck (+2 more)

### Community 94 - "Menu Items Editor"
Cohesion: 0.36
Nodes (8): emptyItem(), MenuItemsEditor(), addItem(), moveItem(), patchItem(), removeItem(), update(), uid()

### Community 95 - "Mega Menu Editor"
Cohesion: 0.39
Nodes (9): emptyMegaColumnItem(), MegaMenuEditor(), addColumn(), addColumnItem(), patchColumn(), patchColumnItem(), removeColumn(), removeColumnItem() (+1 more)

### Community 96 - "API TS Config"
Cohesion: 0.22
Nodes (8): compilerOptions, module, moduleResolution, outDir, rootDir, types, extends, include

### Community 97 - "Frontend Cache/Tenant API"
Cohesion: 0.36
Nodes (7): apiGet(), getLanguages(), getTenantStatus(), getClient(), htmlCacheGet(), htmlCacheSet(), onRequest()

### Community 98 - "Playwright Smoke Tests"
Cohesion: 0.36
Nodes (4): extractCookieValue(), seedDesignerPage(), SeedResult, @playwright/test

### Community 99 - "Breakpoint Value Setters"
Cohesion: 0.39
Nodes (8): applyPreset(), setColSideValue(), setElSideValue(), setFourSideValue(), langKeysOverridden(), setLangValue(), toggleLangKeys(), mutate()

### Community 100 - "QR Code Generator Types"
Cohesion: 0.25
Nodes (3): ErrorCorrectionLevel, QRCode, qrcode-generator

### Community 101 - "Admin Static Server CSP"
Cohesion: 0.36
Nodes (7): adminOrigins, clientDir, contentSecurityPolicy(), MIME, server, serveStatic(), setSecurityHeaders()

### Community 102 - "Events ICS/Robots Routes"
Cohesion: 0.36
Nodes (5): getEventBySlug(), escapeIcs(), GET(), icsDate(), astro

### Community 103 - "Monitor Security Audit Script"
Cohesion: 0.39
Nodes (6): compareVersions(), getSecurityStatus(), runAudit(), tracked, trackedDependencyStatus(), handleSecurity()

### Community 104 - "Element Render Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, preview, test, test:e2e, typecheck

### Community 105 - "Blueprint Gallery Actions"
Cohesion: 0.38
Nodes (5): BlueprintGallery(), refresh(), remove(), saveEdit(), blueprintRows()

### Community 106 - "Social Icon Picker"
Cohesion: 0.33
Nodes (6): GENERIC, label(), PLATFORMS, SocialGlyph(), SocialPicker(), SocialStyleTiles()

### Community 107 - "Node TS Config"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, noEmit, extends, include, ../../tsconfig.base.json

### Community 108 - "I18n Phase Decisions"
Cohesion: 0.29
Nodes (7): i18n Phase 1: Global Language Registry, i18n Phase 2: Per-Tenant Language Subset, i18n Phase 3/4: Content Translations (Corrected Design), i18n Phase 3/4: Rejected First Design, i18n Phase 5 Follow-up: Default Language, i18n Phase 5: WPML-style Opt-in Switch, Design: Language Code Immutable

### Community 109 - "Element Schema Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, preview, start, test, typecheck

### Community 110 - "Live Scroll Stage"
Cohesion: 0.40
Nodes (4): LiveScrollStage(), apply(), onMessage(), Metrics

### Community 111 - "Header/Footer Chrome List"
Cohesion: 0.53
Nodes (5): ChromeList(), deleteForever(), emptyTrash(), rename(), run()

### Community 112 - "Roles Panel Actions"
Cohesion: 0.60
Nodes (6): RolesPanel(), create(), refresh(), remove(), renameRole(), togglePermission()

### Community 113 - "Admin TS References"
Cohesion: 0.33
Nodes (5): compilerOptions, baseUrl, paths, files, references

### Community 114 - "Posts Taxonomy & Security Design"
Cohesion: 0.33
Nodes (6): Posts Category: Managed Taxonomy, Posts Revisions: History Snapshots, Posts Table: Body HTML Sanitization, Security: Media Upload Extension Fix, Design: Category Name Snapshot in Post Revision, Design: Tags Freeform, Categories Managed

### Community 115 - "Tenant Backup Script"
Cohesion: 0.53
Nodes (4): derive_tenant_url(), dump_tenant(), backup.sh script, to_dbname()

### Community 116 - "Frontend Dev Dependencies"
Cohesion: 0.33
Nodes (6): devDependencies, @astrojs/check, tsx, @types/node, @types/sanitize-html, typescript

### Community 117 - "Backup Cron & CI Docs"
Cohesion: 0.40
Nodes (6): Backup Cron Automation (install_backup_cron), install-dev.mjs Local-Dev Installer, install.sh VPS Installer, Deploy ke Server Node.js Guide, Images Publish Workflow, GitLab CI publish-images Job

### Community 118 - "I18n System Rationale"
Cohesion: 0.33
Nodes (6): CLAUDE.md (technical source of truth), i18n system (5 phases), languages table (instance-level), tenant_languages table (per-tenant subset), translate.ts (MyMemory auto-translate wrapper), Rationale: translations jsonb single-row design (rejected one-row-per-language)

### Community 119 - "Frontend Static Server"
Cohesion: 0.40
Nodes (5): DIST_DIR, MIME, PORT, safeJoin(), server

### Community 120 - "ESLint/Prettier Dev Deps"
Cohesion: 0.33
Nodes (6): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, prettier, typescript-eslint

### Community 121 - "Link Input Autocomplete"
Cohesion: 0.50
Nodes (4): Hit, LinkInput(), LinkSiteContext, pageHref()

### Community 122 - "Security Panel MFA UI"
Cohesion: 0.60
Nodes (4): SecurityPanel(), confirmDisable(), confirmEnroll(), reload()

### Community 123 - "Media Backup Script"
Cohesion: 0.60
Nodes (3): live_uploads_dir(), backup-media.sh script, sync_one()

### Community 124 - "Backup Download Actions"
Cohesion: 0.50
Nodes (4): downloadClone(), downloadStaticExport(), downloadTenantBackup(), downloadZip()

### Community 125 - "Entra SSO Design Decisions"
Cohesion: 0.50
Nodes (4): Auth: Microsoft Entra ID SSO, Auth: Entra Login CSRF Fix, Auth: Session Cookie + CSRF Migration, Design: Never Auto-Provision from Entra

### Community 126 - "Frontend TS Config"
Cohesion: 0.50
Nodes (3): exclude, extends, astro/tsconfigs/strict

### Community 127 - "Install.ps1 Windows Script"
Cohesion: 0.50
Nodes (3): Set-IfBlank(), engines, node

### Community 128 - "Dashboard Test Fixtures"
Cohesion: 0.50
Nodes (3): html, literal, source

### Community 130 - "Monitor Access Env Script"
Cohesion: 0.83
Nodes (3): read_env(), monitor-access.sh script, write_env()

### Community 131 - "Spacing Drag Control"
Cohesion: 1.00
Nodes (3): startSpacingDrag(), onMove(), onUp()

### Community 132 - "Backup Destination Mapper"
Cohesion: 0.67
Nodes (3): getBackupDestination(), setBackupDestination(), toBackupDestination()

### Community 133 - "Login Settings Mapper"
Cohesion: 0.67
Nodes (3): getLoginSettings(), setLoginSettings(), toLoginSettings()

### Community 134 - "Pages/Posts List Query"
Cohesion: 0.67
Nodes (3): listPagesPage(), listPostsPage(), toQuery()

### Community 135 - "Menu Item Types"
Cohesion: 0.67
Nodes (3): MenuItem, MenuLinkFields, MenuMegaColumnItem

### Community 136 - "Media Upload Body Parser"
Cohesion: 0.67
Nodes (3): parseJsonBody(), uploadGlobalBranding(), uploadMedia()

### Community 137 - "Collections RLS Design"
Cohesion: 0.67
Nodes (3): Collections: Code-First System, Collections: Generic Query Filters, Design: RLS as Defense-in-Depth

### Community 138 - "Blue-Green Deploy Config"
Cohesion: 0.67
Nodes (3): Database and application configuration, Blue-green zero-downtime deployment, Multi-tenant database setup

### Community 139 - "ESLint Astro Exclusions"
Cohesion: 0.67
Nodes (3): Deferred .astro linting support, ESLint ignore patterns (dist, node_modules, .astro), apps/api and apps/frontend .ts file linting

## Ambiguous Edges - Review These
(none remaining — the one flagged edge was reviewed and removed as a false positive: Jack Qiao's MIT license covers the Fontjoy font-pairing data, unrelated to QrCode.tsx/qrcode-generator)

## Knowledge Gaps
- **720 isolated node(s):** `CreateForm`, `ButtonProps`, `FormFieldContextValue`, `FormItemContextValue`, `CreateForm` (+715 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 966 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **35 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `lucide-react` connect `Tailwind UI Class Helpers` to `Inspector Box Model Controls`, `Shadcn Accordion/Avatar Components`, `Admin App Shell & I18n`, `Admin SPA Editor Stack`, `Categories Panel List UI`, `Designer Canvas Block Path`, `Element Preview Free Position`, `Social Icon Picker`, `Field Group Controls UI`, `Designer Element Palette`, `Field Controls Inputs`, `BlockNote Bookmark Card`, `Admin Package Metadata`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Why does `USIM CMS` connect `Deployment Architecture Docs` to `Admin SPA Editor Stack`, `Monorepo Tooling & CI`, `Frontend Package Dependencies`, `Core API Collections & Crypto`, `Deploy.sh Blue-Green Script`, `I18n System Rationale`?**
  _High betweenness centrality (0.178) - this node is a cross-community bridge._
- **Why does `apps/admin (React SPA)` connect `Admin SPA Editor Stack` to `Tailwind UI Class Helpers`, `Deployment Architecture Docs`, `Frontend Package Dependencies`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **What connects `CreateForm`, `ButtonProps`, `FormFieldContextValue` to the rest of the system?**
  _720 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Collections CRUD Actions` be split into smaller, more focused modules?**
  _Cohesion score 0.02197802197802198 - nodes in this community are weakly interconnected._
- **Should `Shadcn Accordion/Avatar Components` be split into smaller, more focused modules?**
  _Cohesion score 0.03770287141073658 - nodes in this community are weakly interconnected._