# Graph Report - usim_cms  (2026-09-23)

## Corpus Check
- 70 files · ~344,098 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2278 nodes · 4963 edges · 186 communities (120 shown, 59 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 181 edges (avg confidence: 0.84)
- Token cost: 160,300 input · 0 output

## Community Hubs (Navigation)
- Admin API Client Layer
- Admin API URL Helpers
- Monitor Server
- Admin Categories & UI Basics
- Admin TS Config
- API Security Hardening Notes
- Designer Elements & Fields
- Installer Superadmin Setup
- Admin UI Kit (Avatar/Card)
- API Redis Cache Layer
- Admin Package Deps (BlockNote/UI)
- Frontend API Client
- Admin UI Buttons/Permissions
- Designer Block Controls
- Admin Nav & Category Translations
- Designer Element Preview
- Designer Field Controls
- Frontend Content Blocks
- Designer Block Path & Context
- API Auth (TOTP/CSRF)
- Shadcn Admin Foundation Plan Docs
- Collection Config Types
- Tenant Pool Theme/Storage
- Tenant Pool CRUD (Users/Roles/Languages)
- Admin App Shell & i18n Context
- Categories Panel
- Designer Core State
- Element Schema Package
- Admin Package Manifest
- Frontend Hero/Generic Blocks
- Tenant Domain SSL & Menu Plans
- Admin Designer CLAUDE Notes
- API DB Schema
- ESLint Config
- Designer Page/Language Hook
- Settings Panel
- Designer Live-Edit Bridge
- Installer Dev Mode
- API Backup/Clone Store
- Admin UI Kit (Checkbox/Scroll)
- Designer Breakpoint Styling
- Designer Clipboard
- Cross-App Tailwind Deps
- API Package Manifest
- API Image Variants/Storage
- API Proxy Sync (Caddy)
- Media Manager
- API Package Deps (AWS/Drizzle)
- Deployment CLAUDE Notes
- Branding Feature Spec Docs
- Security/Auth CLAUDE Notes
- Admin Component Aliases
- Designer Side-Value Setters
- Designer Tree & Live-Edit API
- API Entra SSO
- Admin Dev Dependencies
- Pages Panel
- API Package Scripts
- API Cookie Helpers
- Admin UI Kit (Alert Dialog)
- Designer Field Groups/Input
- Post Editor Page
- Tenants Panel Clone Box
- API add-user Script
- Menu Link Validation
- TS Base Config
- Admin App Session/Impersonation
- Users Panel
- Admin UI Kit (Badge/Label)
- Admin UI Kit (Sheet)
- Admin UI Kit (Table)
- Designer Undo/Redo
- Menu Items Editor
- Mega Menu Editor
- API i18n/Language Docs
- Element Style Package Manifest
- Element Schema Package Manifest
- Frontend Package Dependencies
- Monitor Static File Server
- QR Code Generator Types
- Frontend HTML Cache & Middleware
- Frontend/Admin CLAUDE Cross-Notes
- Admin E2E Test Seed
- Admin Package Scripts
- Events Panel
- API Dev Dependencies
- Frontend Dev Server
- Page Blueprint Plan Docs
- Designer Site Chrome Hook
- Roles Panel
- Admin TS Config (root)
- API Translation Service
- Frontend Package Scripts
- CI/Collection Config Notes
- Admin UI Kit (Accordion)
- Admin UI Kit (Tabs)
- Designer Clipboard Copy/Read Fns
- Menus Panel
- Posts Panel
- Security Panel (MFA)
- API add-tenant Script
- Docker Compose Services
- Admin UI Kit (Radio Group)
- Admin Download/Export API
- Backup Media Script
- Frontend TS Config
- Architecture Overview Docs
- Roadmap & Audit Docs
- Installer Hardening Design Docs
- Element Schema Dev Deps
- Element Schema Scripts
- Element Style Dev Deps
- Element Style Scripts
- Admin UI Kit (Popover)
- Admin UI Kit (Progress)
- Admin UI Kit (Separator)
- Admin UI Kit (Switch)
- Admin Login Settings API
- Admin Pages/Posts Query API
- Admin Menu Item API Types
- Admin Upload/Media API
- Overview CLAUDE Docs
- Rate Limit & Cache Notes
- API Backup Script
- Frontend Container Block
- Frontend Event List Block
- Deployment Install Scripts
- Docker DB Service & CI
- UI/UX Audit Gaps
- Admin Entry & Post Routing
- Control Plane DB Notes
- Static Export/Backup Notes
- DB Role Rotation Script
- Admin CI Test Step
- Backup Scripts (media/sh)
- Docker Proxy & Blue-Green
- Architecture Known Gaps
- Designer Layers Panel Docs
- Layers Panel Drag Reorder Docs
- Prettier Config
- Entra SSO Client Note
- Post Editor Page Note
- ThemeForm Note
- Maintenance Mode Note
- Theme Presets Note
- Frontend Chrome Preview Note
- Frontend Middleware Note
- Architecture Payload Features
- Frontend CLAUDE Note
- pnpm Workspace Note
- Proxy Resilience Note
- Tenant Usage Panel Note
- Docker Admin Service
- Multitenancy Docs
- Tech Stack Docs
- Announcement Feature Doc
- Designer Blocks Feature Doc
- Dynamic Collections Doc
- Events Calendar Doc
- Admin Env Docs
- API Env Docs
- UI/UX Audit Score Doc
- Cache-Not-Shared Risk Doc
- Connection Pool Risk Doc
- Architecture Score Doc
- Post Editor Bookmark Plan
- Post Editor Categories Plan
- Post Editor Full Page Plan
- Live Edit Toolbar Action Plan
- Live Edit Toolbar Component Plan
- Post Metadata Display Plan
- Post Metadata Theme Keys Plan
- Admin Features Spec
- Frontend Features Spec
- GitHub Dependabot Config
- CI Build Step
- CI Overview
- CI Typecheck Step
- pnpm Workspace Overrides

## God Nodes (most connected - your core abstractions)
1. `request()` - 124 edges
2. `cn()` - 113 edges
3. `Designer()` - 103 edges
4. `useT()` - 66 edges
5. `react` - 65 edges
6. `ensurePublicSchema()` - 61 edges
7. `lucide-react` - 37 edges
8. `blockOpsFns()` - 33 edges
9. `Block` - 29 edges
10. `Key` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Bug: Copy Style / Paste Style Non-Functional for Slider` --rationale_for--> `Slider/Banner Element Rework (2026-09-05)`  [AMBIGUOUS]
  docs/SliderProblem.pdf → apps/admin/CLAUDE.md
- `Animated Headline Hero Template` --semantically_similar_to--> `Slider/Banner Element Rework (2026-09-05)`  [INFERRED] [semantically similar]
  docs/animated-headline.html → apps/admin/CLAUDE.md
- `Brutalist Text-Only Hero Template` --semantically_similar_to--> `Slider/Banner Element Rework (2026-09-05)`  [INFERRED] [semantically similar]
  docs/brutalist-text-only.html → apps/admin/CLAUDE.md
- `Centered Classic Hero Template` --semantically_similar_to--> `Slider/Banner Element Rework (2026-09-05)`  [INFERRED] [semantically similar]
  docs/centered-classic.html → apps/admin/CLAUDE.md
- `Bug: Background/Overlay Color UX Confusing + Wrong Default` --rationale_for--> `Slider/Banner Element Rework (2026-09-05)`  [INFERRED]
  docs/SliderProblem.pdf → apps/admin/CLAUDE.md

## Import Cycles
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/MenusPanel.tsx -> apps/admin/src/MenuItemsEditor.tsx -> apps/admin/src/App.tsx`
- 4-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/MenusPanel.tsx -> apps/admin/src/MenuItemsEditor.tsx -> apps/admin/src/App.tsx`

## Hyperedges (group relationships)
- **Menu + Header/Footer Feature Evolution (menu shipped, site_sections superseded by siteChrome)** — docs_superpowers_specs_2026_08_13_menu_header_footer_design_doc, docs_superpowers_plans_2026_08_13_menu_management_plan, docs_superpowers_specs_2026_09_04_header_footer_designer_design_doc [EXTRACTED 0.90]
- **Designer.tsx God-Component Modularization** — apps_admin_claude_designer, apps_admin_claude_designertree_refactor, apps_admin_claude_recursive_container, apps_admin_claude_row_flex_container, apps_admin_claude_element_schema_package [EXTRACTED 1.00]
- **Designer.tsx God-Component Refactor Program (Layer 0, Layer 1a, Slider Rework)** — docs_superpowers_specs_2026_08_20_designer_tsx_refactor_design_doc, docs_superpowers_plans_2026_08_20_designer_layer0_pure_helpers_plan, docs_superpowers_plans_2026_08_21_designer_layer1a_field_controls_plan, docs_superpowers_specs_2026_09_05_slider_banner_rework_design_doc [INFERRED 0.80]
- **Architecture-audit findings resolved by PgBouncer/Redis/metrics fixes** — docs_laporan_penambahbaikan_seni_bina_connection_pool_risk, docs_laporan_penambahbaikan_seni_bina_cache_not_shared_risk, apps_api_claude_metrics_endpoint [INFERRED 0.85]
- **Page Blueprint proposed as top-priority feature across product docs** — docs_cadangan_ciri_penting_cms_page_blueprint, docs_laporan_audit_ui_ux_page_blueprint_recommendation, docs_cadangan_ciri_penting_cms_roadmap [INFERRED 0.85]
- **Proxy/Domain/SSL Automation + Settings + HA Infra Program** — docs_superpowers_specs_2026_08_12_tenant_domain_ssl_automation_design_doc, docs_superpowers_plans_2026_08_12_tenant_domain_ssl_automation_plan, docs_superpowers_specs_2026_08_13_settings_tabs_design_doc, docs_superpowers_specs_2026_09_06_proxy_db_ha_options_design_doc [INFERRED 0.85]
- **CI Build & Test Pipeline** — github_workflows_ci_overview, github_workflows_ci_typecheck_step, github_workflows_ci_build_step, github_workflows_ci_api_test_step, github_workflows_ci_admin_test_step [EXTRACTED 1.00]
- **Auth Hardening Mechanisms** — apps_api_claude_login_rate_limiting, apps_api_claude_mfa_totp, apps_api_claude_mandatory_mfa_enrollment, apps_api_claude_entra_sso, apps_api_claude_audit_log, apps_api_claude_session_cookie_csrf_migration [INFERRED 0.85]
- **Blue-Green Deploy Pipeline** — dep_deploy_sh, dep_smoke_test, dep_deploy_promote_endpoint, dep_build_caddy_config, dep_test_gate_rollback [EXTRACTED 1.00]

## Communities (186 total, 59 thin omitted)

### Community 0 - "Admin API Client Layer"
Cohesion: 0.03
Nodes (78): createBlueprint(), createCategory(), createMediaFolder(), createPage(), createPortalTenant(), createPortalUser(), createSiteChrome(), createSymbol() (+70 more)

### Community 1 - "Admin API URL Helpers"
Cohesion: 0.03
Nodes (65): API_URL, CloneMeta, ContentSearchResult, createEvent(), createMenu(), createPortalLanguage(), createPortalRole(), createPost() (+57 more)

### Community 2 - "Monitor Server"
Cohesion: 0.08
Nodes (53): checkAuth(), composeArgsFor(), crypto, currentColor(), DEPLOY_LOG, deployState, { execFile, spawn }, fs (+45 more)

### Community 3 - "Admin Categories & UI Basics"
Cohesion: 0.12
Nodes (39): card, ListEmpty(), ListLoading(), PAGE_SIZE, CreateForm, createSchema, Button, ButtonProps (+31 more)

### Community 4 - "Admin TS Config"
Cohesion: 0.04
Nodes (43): compilerOptions, baseUrl, jsx, lib, noEmit, paths, exclude, extends (+35 more)

### Community 5 - "API Security Hardening Notes"
Cohesion: 0.08
Nodes (46): assertValidTenantHost (createTenant DNS validation), DELETE /api/portal/clones/:id (clone + staging teardown), getTenantConnection(tenantHost), GET /metrics (hand-rolled Prometheus exposition), Missing FK indexes fix (posts/pages/media), Tenant-host check deny-list fix (role !== superadmin), Tenant pool idle eviction (IDLE_POOL_EVICT_MS sweep), assertValidTenantHost() (+38 more)

### Community 6 - "Designer Elements & Fields"
Cohesion: 0.08
Nodes (31): ELS, COLUMN_FIELDS, COLUMN_SPACING_KEYS, CSS_CLASS_FIELD, FIELD_GROUP_BY_KEY, FIELD_ICONS, FieldLabel(), GROUP_META (+23 more)

### Community 7 - "Installer Superadmin Setup"
Cohesion: 0.12
Nodes (43): create_superadmin(), create_superadmin_production(), curl_reachable(), curl_reachable_host(), detect_os_family(), detect_public_host(), diagnose_reachability(), ensure_app_database() (+35 more)

### Community 8 - "Admin UI Kit (Avatar/Card)"
Cohesion: 0.08
Nodes (39): Avatar, AvatarFallback, AvatarImage, CardDescription, CardFooter, CardHeader, CardTitle, Command (+31 more)

### Community 9 - "API Redis Cache Layer"
Cohesion: 0.09
Nodes (34): cacheGet(), cacheInvalidate(), cacheSet(), getCacheStats(), getClient(), getRedisClient(), getPoolStats(), publishSharedContent() (+26 more)

### Community 10 - "Admin Package Deps (BlockNote/UI)"
Cohesion: 0.05
Nodes (41): dependencies, @blocknote/core, @blocknote/mantine, @blocknote/react, class-variance-authority, clsx, cmdk, @hookform/resolvers (+33 more)

### Community 11 - "Frontend API Client"
Cohesion: 0.07
Nodes (36): apiGet(), applyLangOverrides(), BlueprintPreview, cache, Category, EventItem, fetchMenuLinkTargets(), getDefaultSiteChrome() (+28 more)

### Community 12 - "Admin UI Buttons/Permissions"
Cohesion: 0.13
Nodes (23): btnGhost, btnPrimary, FormError(), inputCls, PERMISSION_LABEL_KEY, PERMISSIONS, SESSION_KEY, QrCode() (+15 more)

### Community 13 - "Designer Block Controls"
Cohesion: 0.12
Nodes (38): BlockControls(), LiveEditToolbar(), rowDragProps(), blockOpsFns(), copyColumn(), copyElement(), copyRow(), copySection() (+30 more)

### Community 14 - "Admin Nav & Category Translations"
Cohesion: 0.06
Nodes (23): NavButton(), useT(), CategoryTranslations(), Dashboard(), PortalFeedPanel(), ChromeList(), onCreate(), remove() (+15 more)

### Community 15 - "Designer Element Preview"
Cohesion: 0.12
Nodes (33): ElPreview(), mergeElBp(), scaleLength(), SectionPropsLike, startFreeElDrag(), up(), startFreeElResize(), move() (+25 more)

### Community 16 - "Designer Field Controls"
Cohesion: 0.12
Nodes (34): BpToggle(), BufferedInput(), BufferedTextarea(), DragNumber(), FontPickerInput(), LangToggle(), NumberStepper(), addSlideElement() (+26 more)

### Community 17 - "Frontend Content Blocks"
Cohesion: 0.12
Nodes (24): renderInline(), BORDER, cls(), elBorderShadowStyle(), elEntranceClass(), elHoverClass(), elRadius(), fluidClamp() (+16 more)

### Community 18 - "Designer Block Path & Context"
Cohesion: 0.15
Nodes (24): BASE_LANG, DesignerCtx, BlockOpsDeps, __testOnly_blockOpsFns(), useBlockOps(), LiveEditBridgeDeps, PersistDeps, TemplateLibraryDeps (+16 more)

### Community 19 - "API Auth (TOTP/CSRF)"
Cohesion: 0.13
Nodes (31): base32Decode(), base32Encode(), generateCsrfToken(), generateTotpSecret(), hashPassword(), isMfaSetupRequired(), SESSION_TTL_MS, SessionPayload (+23 more)

### Community 20 - "Shadcn Admin Foundation Plan Docs"
Cohesion: 0.07
Nodes (36): MediaPickerModal Dialog Rewrite, shadcn Foundation + App.tsx Migration Phase 1 Plan, react-hook-form + zod Quick-Create Pattern, useConfirm Promise-Based Dialog Hook, designer/geometry.ts Module, designer/parsers.ts Module, Designer.tsx Layer 0 Pure Helper Extraction Plan, 18-of-25 Functions Scope Narrowing (+28 more)

### Community 21 - "Collection Config Types"
Cohesion: 0.07
Nodes (21): AccessArgs, AccessFn, CollectionConfig, CollectionHooks, getTenantLanguageSelection(), canWriteBlueprint(), categoriesCollection, eventsCollection (+13 more)

### Community 22 - "Tenant Pool Theme/Storage"
Cohesion: 0.10
Nodes (32): createThemePreset(), deleteThemePreset(), getGlobalStorageLimits(), getGlobalTheme(), getTenantStorageLimits(), listSharedContent(), listThemePresets(), setEntraSettings() (+24 more)

### Community 23 - "Tenant Pool CRUD (Users/Roles/Languages)"
Cohesion: 0.15
Nodes (32): createLanguage(), createPageBlueprint(), createRole(), createUser(), deleteLanguage(), deletePageBlueprint(), deleteRole(), deleteUser() (+24 more)

### Community 24 - "Admin App Shell & i18n Context"
Cohesion: 0.10
Nodes (24): BlueprintGallery, I18nCtx, NAV_GROUP_LABEL, NAV_GROUP_ORDER, NavGroup, PostEditorPage, Tab, TAB_GROUP (+16 more)

### Community 25 - "Categories Panel"
Cohesion: 0.09
Nodes (25): CategoriesPanel(), onCreate(), refresh(), remove(), rename(), toggleMultilang(), slugify(), DISPLAY_ONLY_FONTS (+17 more)

### Community 26 - "Designer Core State"
Cohesion: 0.10
Nodes (21): clone(), Designer(), LayersTree(), pick(), toggleExpand(), selEq(), clone(), usePersist() (+13 more)

### Community 27 - "Element Schema Package"
Cohesion: 0.14
Nodes (31): ATTR_URL_KEYS, COLOR_KEYS, ENUM_VALUES, FREE_TEXT_KEYS, isSafeCard(), isSafeCards(), isSafeCssUrl(), isSafeRepeaterItem() (+23 more)

### Community 28 - "Admin Package Manifest"
Cohesion: 0.07
Nodes (26): tsx, name, private, type, version, BOOKMARK_CARD_STYLE, bookmarkCardBlockSpec, bookmarkCardSchema (+18 more)

### Community 29 - "Frontend Hero/Generic Blocks"
Cohesion: 0.10
Nodes (21): bgUrl, v, getBlueprintPreview(), getLivePreviewOverride(), getPageBySlug(), getTheme(), listCategories(), listPosts() (+13 more)

### Community 30 - "Tenant Domain SSL & Menu Plans"
Cohesion: 0.08
Nodes (30): Custom Certificate Upload/Revert Routes, Tenant Domain + SSL Automation Plan, platform_settings Singleton Table, proxy-sync.ts Module, Menu Label Always-Editable Simplification, MenuItemsEditor Component, menus Table (jsonb item tree), Menu Management Implementation Plan (+22 more)

### Community 31 - "Admin Designer CLAUDE Notes"
Cohesion: 0.10
Nodes (27): Per-Breakpoint Style-Override Bag (bp), Designer.tsx Page-Builder Canvas, designerTree.ts Depth-Agnostic Path Primitives, Live Edit postMessage Bridge (iframe selection), First Designer.tsx Playwright E2E Smoke Test, Recursive Container Element (v1), Row Flex Container Layout Mode, Slider/Banner Element Rework (2026-09-05) (+19 more)

### Community 32 - "API DB Schema"
Cohesion: 0.07
Nodes (26): auditLog, categories, designTemplates, events, languages, loginAttempts, media, mediaFolders (+18 more)

### Community 33 - "ESLint Config"
Cohesion: 0.08
Nodes (25): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, prettier, typescript-eslint, name, packageManager (+17 more)

### Community 34 - "Designer Page/Language Hook"
Cohesion: 0.16
Nodes (16): clone(), PageAndLanguageDeps, usePageAndLanguage(), clickPageLanguagePill(), elTypeAtPath(), langStackKeysOverridden(), retranslatePageLanguage(), seedMissingTextOverrides() (+8 more)

### Community 35 - "Settings Panel"
Cohesion: 0.13
Nodes (20): SettingsPanel(), addLanguage(), pickRestoreFile(), reloadLanguages(), reloadLoginSettings(), reloadProxySettings(), reloadProxyTenants(), removeLanguage() (+12 more)

### Community 36 - "Designer Live-Edit Bridge"
Cohesion: 0.13
Nodes (21): section(), useLiveEditBridge(), onMessage(), toggleLive(), clone(), uid(), useTemplateLibrary(), confirmMakeComponent() (+13 more)

### Community 37 - "Installer Dev Mode"
Cohesion: 0.20
Nodes (22): checkDocker(), createSuperadmin(), ensureCredentials(), ensureReachableOrReport(), fetchStatusCode(), fillEnvIfBlank(), findFreePort(), flags (+14 more)

### Community 38 - "API Backup/Clone Store"
Cohesion: 0.19
Nodes (20): CloneMeta, cloneStore, DATE_KEYS, deleteClone(), exportStaticSite(), exportTenantBackup(), exportTenantDesignClone(), getClone() (+12 more)

### Community 39 - "Admin UI Kit (Checkbox/Scroll)"
Cohesion: 0.10
Nodes (15): Checkbox, ScrollArea, ScrollBar, Skeleton(), Textarea, TooltipContent, contrastRatio(), oklchToHex() (+7 more)

### Community 40 - "Designer Breakpoint Styling"
Cohesion: 0.17
Nodes (17): bpColStyle(), bpMarginStyle(), bpPaddingStyle(), fourSideValue(), rowGridTemplate(), sectionBpStyle(), writeDragSideKeys(), Bp (+9 more)

### Community 41 - "Designer Clipboard"
Cohesion: 0.14
Nodes (14): ClipLevel, CONTENT_KEYS, BlockOpsClipboard, CLIP_KEYS, ClipboardApi, CLIPSTYLE_KEYS, __testOnly_clipboardFns(), useClipboard() (+6 more)

### Community 42 - "Cross-App Tailwind Deps"
Cohesion: 0.12
Nodes (15): tailwindcss, @ucms/element-style, ioredis, devDependencies, @astrojs/check, typescript, name, private (+7 more)

### Community 43 - "API Package Manifest"
Cohesion: 0.12
Nodes (15): tsx, @ucms/element-schema, name, private, type, version, drizzle-kit, @fastify/cors (+7 more)

### Community 44 - "API Image Variants/Storage"
Cohesion: 0.18
Nodes (15): deleteImageVariants(), generateImageVariants(), ImageMeta, SRCSET_WIDTHS, deleteFile(), getS3Client(), isLocalDriver, localUploadsDir (+7 more)

### Community 45 - "API Proxy Sync (Caddy)"
Cohesion: 0.24
Nodes (14): buildCaddyConfig(), caddyRequest(), CaddyResponse, CaddyUpstreams, certId(), CLOUDFLARE_IP_RANGES, dials(), isValidDialTargets() (+6 more)

### Community 46 - "Media Manager"
Cohesion: 0.21
Nodes (12): MediaManager(), addFolder(), bulkDelete(), onDrop(), onFileChosen(), refreshFolders(), refreshItems(), remove() (+4 more)

### Community 47 - "API Package Deps (AWS/Drizzle)"
Cohesion: 0.13
Nodes (15): dependencies, @aws-sdk/client-s3, @aws-sdk/lib-storage, drizzle-orm, fastify, @fastify/cors, @fastify/helmet, @fastify/multipart (+7 more)

### Community 48 - "Deployment CLAUDE Notes"
Cohesion: 0.14
Nodes (15): Usage & Cost Discipline policy (subagents/worktrees/skills), Blue-green zero-downtime deploys, Branded uploads fix (no api.<domain> leak), buildCaddyConfig / syncCaddy (proxy-sync.ts), Caddy reverse proxy / TLS terminator (proxy service), POST /api/ssl/issue (certbot auto-SSL for nginx), POST /internal/deploy/promote, scripts/deploy.sh (blue-green deploy driver) (+7 more)

### Community 49 - "Branding Feature Spec Docs"
Cohesion: 0.16
Nodes (15): BrandingPanel Component, Superadmin Control Plane Follow-up (deferred: permissions, copy-on-place, clone tenant), Admin Restyle + Branding + Post/Media Design, media Library Collection, posts Collection (v1), site_theme.settings Fixed Schema, bookmarkCard BlockNote Custom Block, categories Table + posts.categoryId FK (+7 more)

### Community 50 - "Security/Auth CLAUDE Notes"
Cohesion: 0.14
Nodes (14): Mandatory MFA Enrollment UI + QR Code, audit_log (instance-wide/cross-tenant action log), Designer.tsx (PageDesignerRoute, applyLangOverrides), Microsoft Entra ID SSO (entra.ts OIDC flow), Fastify global route-table lesson (no public+protected same path), generic-crud.ts (registerPublicCollectionRoutes, elevateIfAuthenticated), Entra login-CSRF fix (state nonce + cookie binding), isLoginRateLimited / recordLoginAttempt (login_attempts table) (+6 more)

### Community 51 - "Admin Component Aliases"
Cohesion: 0.14
Nodes (13): aliases, components, utils, iconLibrary, rsc, $schema, style, tailwind (+5 more)

### Community 52 - "Designer Side-Value Setters"
Cohesion: 0.22
Nodes (14): onKey(), setColSideValue(), setElSideValue(), setFourSideValue(), langKeysOverridden(), setLangValue(), toggleLangKeys(), clone() (+6 more)

### Community 53 - "Designer Tree & Live-Edit API"
Cohesion: 0.34
Nodes (10): LiveEditBridgeApi, BORDER, childrenOf(), getNode(), insertAt(), locate(), moveColumn(), moveSection() (+2 more)

### Community 54 - "API Entra SSO"
Cohesion: 0.22
Nodes (12): base64UrlDecode(), EntraClaims, exchangeEntraCode(), getEntraAuthorizeUrl(), getJwks(), isEntraStateValid(), isPasswordLoginAllowed(), Jwk (+4 more)

### Community 55 - "Admin Dev Dependencies"
Cohesion: 0.17
Nodes (12): devDependencies, autoprefixer, @playwright/test, postcss, tailwindcss, tsx, @types/node, @types/react (+4 more)

### Community 56 - "Pages Panel"
Cohesion: 0.24
Nodes (10): pageHasContent(), PagesPanel(), onCreate(), refresh(), remove(), setHome(), setStatus(), useBlueprint() (+2 more)

### Community 57 - "API Package Scripts"
Cohesion: 0.17
Nodes (12): scripts, build, db:generate, db:migrate, db:setup-role, dev, start, tenant:add (+4 more)

### Community 58 - "API Cookie Helpers"
Cohesion: 0.32
Nodes (11): appendSetCookie(), baseAttrs(), clearEntraStateCookie(), clearSessionCookie(), ENTRA_STATE_COOKIE_NAME, getCookie(), getEntraStateCookie(), getSessionCookie() (+3 more)

### Community 59 - "Admin UI Kit (Alert Dialog)"
Cohesion: 0.22
Nodes (10): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+2 more)

### Community 60 - "Designer Field Groups/Input"
Cohesion: 0.38
Nodes (10): FieldGroups(), FieldGroupsProps, FieldInput(), FieldInputProps, Bp, Field, FieldGroupKey, Category (+2 more)

### Community 61 - "Post Editor Page"
Cohesion: 0.22
Nodes (9): autoExcerpt(), effectiveDisplay(), fromDisplayOverride(), PostEditorPage(), askResyncLangs(), clickLanguagePill(), save(), switchLanguage() (+1 more)

### Community 62 - "Tenants Panel Clone Box"
Cohesion: 0.33
Nodes (10): CloneBox(), promote(), refresh(), remove(), replace(), run(), stage(), SiteOpsPanel() (+2 more)

### Community 63 - "API add-user Script"
Cohesion: 0.18
Nodes (9): bootstrapSql, client, [email, password, role, tenantHost], bootstrapSql, client, [json], sql, client (+1 more)

### Community 64 - "Menu Link Validation"
Cohesion: 0.33
Nodes (9): LINK_TYPES, LinkType, validateCommonItemFields(), validateItem(), validateLinkFields(), validateMegaMenu(), validateMegaMenuItem(), validateMenuItems() (+1 more)

### Community 65 - "TS Base Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution, resolveJsonModule, skipLibCheck (+2 more)

### Community 66 - "Admin App Session/Impersonation"
Cohesion: 0.22
Nodes (5): App(), loadSession(), Toaster(), ToasterProps, next-themes

### Community 67 - "Users Panel"
Cohesion: 0.31
Nodes (7): UsersPanel(), assignRole(), create(), refresh(), removeUser(), saveEditTenantHosts(), setUserExtraPermissions()

### Community 68 - "Admin UI Kit (Badge/Label)"
Cohesion: 0.28
Nodes (7): Badge(), BadgeProps, badgeVariants, Label, labelVariants, class-variance-authority, @radix-ui/react-label

### Community 69 - "Admin UI Kit (Sheet)"
Cohesion: 0.25
Nodes (8): SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle, sheetVariants

### Community 70 - "Admin UI Kit (Table)"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 71 - "Designer Undo/Redo"
Cohesion: 0.31
Nodes (5): SetHoverBand, __testOnly_undoRedoFns(), UndoRedoApi, undoRedoFns(), useUndoRedo()

### Community 72 - "Menu Items Editor"
Cohesion: 0.36
Nodes (8): emptyItem(), MenuItemsEditor(), addItem(), moveItem(), patchItem(), removeItem(), update(), uid()

### Community 73 - "Mega Menu Editor"
Cohesion: 0.39
Nodes (9): emptyMegaColumnItem(), MegaMenuEditor(), addColumn(), addColumnItem(), patchColumn(), patchColumnItem(), removeColumn(), removeColumnItem() (+1 more)

### Community 74 - "API i18n/Language Docs"
Cohesion: 0.25
Nodes (9): Category i18n follow-up (translations/multilangEnabled), getTenantLanguageSelection / setTenantLanguageSelection, i18n Phase 3/4: one-row-holds-every-language design (posts/pages), Language-switcher placement/style settings, i18n Phase 1: global language registry (languages table), i18n Phase 5: WPML-style opt-in multilangEnabled switches, PostEditorPage (language pill switcher editor), i18n Phase 2: tenant_languages per-tenant enabled subset (+1 more)

### Community 75 - "Element Style Package Manifest"
Cohesion: 0.22
Nodes (8): @types/node, tsx, main, name, private, type, types, version

### Community 76 - "Element Schema Package Manifest"
Cohesion: 0.22
Nodes (8): typescript, tsx, main, name, private, type, types, version

### Community 77 - "Frontend Package Dependencies"
Cohesion: 0.22
Nodes (9): dependencies, astro, @astrojs/node, daisyui, ioredis, swiper, tailwindcss, @tailwindcss/vite (+1 more)

### Community 78 - "Monitor Static File Server"
Cohesion: 0.25
Nodes (8): DIST_DIR, fs, http, MIME, path, PORT, safeJoin(), server

### Community 79 - "QR Code Generator Types"
Cohesion: 0.25
Nodes (3): ErrorCorrectionLevel, QRCode, qrcode-generator

### Community 80 - "Frontend HTML Cache & Middleware"
Cohesion: 0.50
Nodes (6): getTenantStatus(), getClient(), htmlCacheGet(), htmlCacheSet(), onRequest(), astro

### Community 81 - "Frontend/Admin CLAUDE Cross-Notes"
Cohesion: 0.29
Nodes (7): @ucms/element-schema Shared Validator Package, @ucms/element-style Shared Sanitizer Package, Astro SSR Renderer ([...slug].astro), apps/frontend build-time/runtime env (API_URL, HOST, PORT), designer:selectedRect postMessage bridge (ResizeObserver + scroll), tag/category/author archive pages in apps/frontend, pnpm-workspace.yaml packages glob (apps/*, packages/*)

### Community 82 - "Admin E2E Test Seed"
Cohesion: 0.43
Nodes (4): extractCookieValue(), seedDesignerPage(), SeedResult, @playwright/test

### Community 83 - "Admin Package Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, preview, test, test:e2e, typecheck

### Community 84 - "Events Panel"
Cohesion: 0.48
Nodes (7): EventsPanel(), onCreate(), openEdit(), refresh(), remove(), save(), toLocalInput()

### Community 85 - "API Dev Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, drizzle-kit, tsx, @types/node, @types/pg, @types/sanitize-html, typescript

### Community 86 - "Frontend Dev Server"
Cohesion: 0.38
Nodes (6): clientDir, CSP, MIME, server, serveStatic(), setSecurityHeaders()

### Community 87 - "Page Blueprint Plan Docs"
Cohesion: 0.43
Nodes (7): BlueprintGallery Component, page_blueprints Control-Plane Table, Page Blueprint Implementation Plan, TemplatePreview Extraction, Control-Plane Not Per-Tenant-DB Rationale, Page Blueprint Design, page_blueprints Table

### Community 88 - "Designer Site Chrome Hook"
Cohesion: 0.33
Nodes (3): SiteChromeDeps, useSiteChrome(), patchChromeMeta()

### Community 89 - "Roles Panel"
Cohesion: 0.60
Nodes (6): RolesPanel(), create(), refresh(), remove(), renameRole(), togglePermission()

### Community 90 - "Admin TS Config (root)"
Cohesion: 0.33
Nodes (5): compilerOptions, baseUrl, paths, files, references

### Community 91 - "API Translation Service"
Cohesion: 0.53
Nodes (5): chunkText(), escapeHtml(), MyMemoryResponse, translateHtmlBody(), translatePlainText()

### Community 92 - "Frontend Package Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, preview, start, typecheck

### Community 93 - "CI/Collection Config Notes"
Cohesion: 0.33
Nodes (6): apps/api (Fastify + Drizzle backend), CollectionConfig registration pattern, pnpm --filter @ucms/api db:generate, pnpm --filter @ucms/api db:migrate (not for normal use), ensureTenantDatabase (tenant-pool.ts migration replay), pnpm --filter @ucms/api test step

### Community 94 - "Admin UI Kit (Accordion)"
Cohesion: 0.40
Nodes (4): AccordionContent, AccordionItem, AccordionTrigger, @radix-ui/react-accordion

### Community 95 - "Admin UI Kit (Tabs)"
Cohesion: 0.40
Nodes (4): TabsContent, TabsList, TabsTrigger, @radix-ui/react-tabs

### Community 97 - "Menus Panel"
Cohesion: 0.70
Nodes (5): MenusPanel(), onCreate(), refresh(), remove(), rename()

### Community 98 - "Posts Panel"
Cohesion: 0.60
Nodes (4): PostsPanel(), onCreate(), refresh(), remove()

### Community 99 - "Security Panel (MFA)"
Cohesion: 0.60
Nodes (4): SecurityPanel(), confirmDisable(), confirmEnroll(), reload()

### Community 100 - "API add-tenant Script"
Cohesion: 0.40
Nodes (4): bootstrapSql, client, departmentName, [host, ...nameParts]

### Community 101 - "Docker Compose Services"
Cohesion: 0.40
Nodes (5): pgbouncer service (edoburu/pgbouncer, session pool_mode), redis service (shared public-read cache), api service (blue-green release compose), frontend service (blue-green release compose), Target scalable architecture diagram (CDN, LB, PgBouncer, Redis, S3)

### Community 102 - "Admin UI Kit (Radio Group)"
Cohesion: 0.50
Nodes (3): RadioGroup, RadioGroupItem, @radix-ui/react-radio-group

### Community 103 - "Admin Download/Export API"
Cohesion: 0.50
Nodes (4): downloadClone(), downloadStaticExport(), downloadTenantBackup(), downloadZip()

### Community 105 - "Frontend TS Config"
Cohesion: 0.50
Nodes (3): exclude, extends, astro/tsconfigs/strict

### Community 106 - "Architecture Overview Docs"
Cohesion: 0.50
Nodes (4): Core stack: pnpm workspaces, Fastify+Drizzle, Vite+React, Multi-tenancy/JSONB layout/no-bloat token-saving constraints, USIM CMS current-state architecture summary (27 Ogos 2026), Backend engine features (multi-tenant router, generic REST, local API SDK)

### Community 107 - "Roadmap & Audit Docs"
Cohesion: 0.50
Nodes (4): Page Blueprint / starter template feature proposal, Phased feature roadmap (fasa 1-5), Page Blueprint gallery as highest-priority Designer recommendation, 4-phase engineering improvement plan (stability, query, cache/CDN, load test)

### Community 108 - "Installer Hardening Design Docs"
Cohesion: 0.50
Nodes (4): Installer Hardening + Dev Installer Design, install-dev.mjs Local Installer, OS/Package-Manager Abstraction (apt/dnf), External Reachability Verification (2-stage)

### Community 109 - "Element Schema Dev Deps"
Cohesion: 0.50
Nodes (4): devDependencies, tsx, @types/node, typescript

### Community 110 - "Element Schema Scripts"
Cohesion: 0.50
Nodes (4): scripts, build, test, typecheck

### Community 111 - "Element Style Dev Deps"
Cohesion: 0.50
Nodes (4): devDependencies, tsx, @types/node, typescript

### Community 112 - "Element Style Scripts"
Cohesion: 0.50
Nodes (4): scripts, build, test, typecheck

### Community 117 - "Admin Login Settings API"
Cohesion: 0.67
Nodes (3): getLoginSettings(), setLoginSettings(), toLoginSettings()

### Community 118 - "Admin Pages/Posts Query API"
Cohesion: 0.67
Nodes (3): listPagesPage(), listPostsPage(), toQuery()

### Community 119 - "Admin Menu Item API Types"
Cohesion: 0.67
Nodes (3): MenuItem, MenuLinkFields, MenuMegaColumnItem

### Community 120 - "Admin Upload/Media API"
Cohesion: 0.67
Nodes (3): parseJsonBody(), uploadGlobalBranding(), uploadMedia()

### Community 121 - "Overview CLAUDE Docs"
Cohesion: 0.67
Nodes (3): apps/api/CLAUDE.md (multi-tenancy + auth hardening doc), root CLAUDE.md (repo guidance), deployment SKILL.md (deployment/ops reference)

### Community 122 - "Rate Limit & Cache Notes"
Cohesion: 0.67
Nodes (3): rate-limit.ts isTenantRateLimited (per-tenant request budget), apps/frontend html-cache.ts (rendered-HTML cache), redis service + cache.ts (public GET cache)

### Community 126 - "Deployment Install Scripts"
Cohesion: 0.67
Nodes (3): docker-compose.trial.yml (install.sh trial flow), install-dev.mjs (local-dev installer), install.sh (VPS installer, docker/bare-metal)

### Community 127 - "Docker DB Service & CI"
Cohesion: 0.67
Nodes (3): db service (Postgres, setup-db-role + md5 password rotation), install.sh trial mode: single-container api/frontend/admin, no Caddy, Dependabot ignore rule for postgres major-version bumps

### Community 128 - "UI/UX Audit Gaps"
Cohesion: 0.67
Nodes (3): Inconsistent form/status accessibility (P0), 4-sprint UX implementation backlog, Admin panel not fully responsive (P0)

## Ambiguous Edges - Review These
- `Bug: Copy Style / Paste Style Non-Functional for Slider` → `Slider/Banner Element Rework (2026-09-05)`  [AMBIGUOUS]
  docs/SliderProblem.pdf · relation: rationale_for
- `Slider/Banner Element Rework (2026-09-05)` → `Recommendation to avoid too many carousel/animation variations early`  [AMBIGUOUS]
  docs/laporan-audit-ui-ux.md · relation: conceptually_related_to

## Knowledge Gaps
- **608 isolated node(s):** `ImageMeta`, `UploadResult`, `DisplayOverride`, `LangContent`, `PostStatus` (+603 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 783 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **59 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Bug: Copy Style / Paste Style Non-Functional for Slider` and `Slider/Banner Element Rework (2026-09-05)`?**
  _Edge tagged AMBIGUOUS (relation: rationale_for) - confidence is low._
- **What is the exact relationship between `Slider/Banner Element Rework (2026-09-05)` and `Recommendation to avoid too many carousel/animation variations early`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `react` connect `Admin UI Buttons/Permissions` to `Admin Categories & UI Basics`, `Designer Elements & Fields`, `Admin UI Kit (Avatar/Card)`, `Admin Nav & Category Translations`, `Designer Field Controls`, `Designer Block Path & Context`, `Admin App Shell & i18n Context`, `Categories Panel`, `Admin Package Manifest`, `Designer Page/Language Hook`, `Admin UI Kit (Checkbox/Scroll)`, `Designer Breakpoint Styling`, `Designer Clipboard`, `Designer Tree & Live-Edit API`, `Admin UI Kit (Alert Dialog)`, `Admin App Session/Impersonation`, `Admin UI Kit (Badge/Label)`, `Admin UI Kit (Sheet)`, `Admin UI Kit (Table)`, `Designer Undo/Redo`, `Designer Site Chrome Hook`, `Admin UI Kit (Accordion)`, `Admin UI Kit (Tabs)`, `Admin UI Kit (Radio Group)`, `Admin UI Kit (Popover)`, `Admin UI Kit (Progress)`, `Admin UI Kit (Separator)`, `Admin UI Kit (Switch)`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `Admin UI Buttons/Permissions` to `Admin Categories & UI Basics`, `Admin UI Kit (Sheet)`, `Admin UI Kit (Radio Group)`, `Admin UI Kit (Checkbox/Scroll)`, `Admin UI Kit (Avatar/Card)`, `Designer Elements & Fields`, `Admin Nav & Category Translations`, `Designer Element Preview`, `Designer Field Controls`, `Designer Field Groups/Input`, `Admin App Shell & i18n Context`, `Categories Panel`, `Admin Package Manifest`, `Admin UI Kit (Accordion)`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `typescript` connect `Element Schema Package Manifest` to `Element Style Package Manifest`, `Cross-App Tailwind Deps`, `API Package Manifest`, `Admin Package Manifest`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `Designer()` (e.g. with `bumpStructural()` and `fourSideValue()`) actually correct?**
  _`Designer()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ImageMeta`, `UploadResult`, `DisplayOverride` to the rest of the system?**
  _608 weakly-connected nodes found - possible documentation gaps or missing edges._