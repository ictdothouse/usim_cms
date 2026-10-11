# Graph Report - usim_cms  (2026-10-08)

## Corpus Check
- 326 files · ~378,882 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2303 nodes · 5458 edges · 134 communities (106 shown, 25 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 166 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Design Canvas & Layout
- Collection Data Models
- Multi-Tenant Database
- Frontend API Client
- Backup & Migration
- Caching Layer
- i18n Infrastructure
- Authentication & MFA
- Component Preview
- Frontend Rendering
- Module 10
- Module 11
- Module 12
- Module 13
- Module 14
- Module 15
- Module 16
- Module 17
- Module 18
- Module 19
- Module 20
- Module 21
- Module 22
- Module 23
- Module 24
- Module 25
- Module 26
- Module 27
- Module 28
- Module 29
- Module 30
- Module 31
- Module 32
- Module 33
- Module 34
- Module 35
- Module 36
- Module 37
- Module 38
- Module 39
- Module 40
- Module 41
- Module 42
- Module 43
- Module 44
- Module 45
- Module 46
- Module 47
- Module 48
- Module 49
- Module 50
- Module 51
- Module 52
- Module 53
- Module 54
- Module 55
- Module 56
- Module 57
- Module 58
- Module 59
- Module 60
- Module 61
- Module 63
- Module 64
- Module 65
- Module 66
- Module 67
- Module 68
- Module 69
- Module 70
- Module 71
- Module 72
- Module 73
- Module 74
- Module 75
- Module 76
- Module 77
- Module 78
- Module 79
- Module 80
- Module 81
- Module 82
- Module 83
- Module 84
- Module 85
- Module 86
- Module 87
- Module 88
- Module 89
- Module 90
- Module 91
- Module 92
- Module 93
- Module 94
- Module 95
- Module 96
- Module 97
- Module 98
- Module 99
- Module 100
- Module 101
- Module 102
- Module 103
- Module 104
- Module 105
- Module 106
- Module 107
- Module 108
- Module 109
- Module 110
- Module 111
- Module 112
- Module 113
- Module 114
- Module 115
- Module 116
- Module 117
- Module 118
- Module 119
- Module 120
- Module 121
- Module 122
- Module 123
- Module 124
- Module 126
- Module 127
- Module 128
- Module 129
- Module 131
- Module 132
- Module 133

## God Nodes (most connected - your core abstractions)
1. `request()` - 128 edges
2. `cn()` - 113 edges
3. `ensurePublicSchema()` - 73 edges
4. `react` - 72 edges
5. `useT()` - 68 edges
6. `lucide-react` - 49 edges
7. `blockOpsFns()` - 42 edges
8. `Key` - 39 edges
9. `registerAuthRoutes()` - 37 edges
10. `Block` - 33 edges

## Surprising Connections (you probably didn't know these)
- `pnpm workspace monorepo` --references--> `Cross-app render-value computation`  [EXTRACTED]
  pnpm-workspace.yaml → packages/element-render/src/index.ts
- `typescript-eslint recommended configs` --semantically_similar_to--> `TypeScript strict mode enabled`  [INFERRED] [semantically similar]
  eslint.config.mjs → tsconfig.base.json
- `Set-IfBlank()` --calls--> `node`  [INFERRED]
  install.ps1 → package.json
- `RefIdPicker()` --calls--> `useT()`  [EXTRACTED]
  apps/admin/src/MenuItemsEditor.tsx → apps/admin/src/App.tsx
- `downloadDesignMd()` --calls--> `slugify()`  [EXTRACTED]
  apps/admin/src/ThemeForm.tsx → apps/admin/src/lib/utils.ts

## Import Cycles
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/PagesPanel.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/MediaManager.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/CategoriesPanel.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/MenusPanel.tsx -> apps/admin/src/MenuItemsEditor.tsx -> apps/admin/src/App.tsx`
- 3-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/PostsPanel.tsx -> apps/admin/src/App.tsx`
- 4-file cycle: `apps/admin/src/App.tsx -> apps/admin/src/ContentManager.tsx -> apps/admin/src/MenusPanel.tsx -> apps/admin/src/MenuItemsEditor.tsx -> apps/admin/src/App.tsx`

## Hyperedges (group relationships)
- **i18n Multi-Phase Implementation** — apps_api_i18n_phase_1_global_language_registry, apps_api_i18n_phase_2_per_tenant_subset, apps_api_i18n_phase_3_4_content_translations, apps_api_i18n_phase_5_opt_in_switch, apps_api_i18n_phase_5_default_language [INFERRED]
- **Auth Hardening Suite** — apps_api_auth_rate_limiting_tenant, apps_api_auth_login_rate_limiting, apps_api_auth_entra_id_sso, apps_api_auth_entra_login_csrf, apps_api_auth_mfa_totp, apps_api_auth_mfa_mandatory_enrollment, apps_api_auth_session_cookie_csrf [INFERRED]
- **Designer Canvas & Rendering System** — apps_admin_designer_page_builder, apps_admin_designer_live_edit, apps_admin_designer_device_preview_modal, apps_admin_designer_live_edit_preview_unified, apps_admin_designer_canva_draft_autosave, apps_api_pages_revisions_history [INFERRED]
- **Multi-Layer Data Isolation** — architecture_database_per_tenant, architecture_control_plane, architecture_tenant_identity, design_decision_rls_defense_in_depth [INFERRED]
- **Cross-app render consistency pattern** — packages_element_render_src_index_render_value_computation, apps_admin_designer_canvas, apps_frontend_renderer [INFERRED]
- **Security validation boundary** — packages_element_schema_src_index_validation, css_injection_threat_vector, xss_threat_vector [INFERRED]
- **Workspace-wide TypeScript + ESLint enforcement** —  [INFERRED]
- **Bundler-driven transpilation strategy** —  [INFERRED]

## Communities (134 total, 25 thin omitted)

### Community 0 - "Design Canvas & Layout"
Cohesion: 0.05
Nodes (88): section(), rowDragProps(), DesignerCanvas(), BlockControls(), bpColStyle(), pxLabel(), spacingBand(), DesignerDevicePreviewModal() (+80 more)

### Community 1 - "Collection Data Models"
Cohesion: 0.02
Nodes (81): createBlueprint(), createCategory(), createMediaFolder(), createMenu(), createPage(), createPortalRole(), createPortalUser(), createPost() (+73 more)

### Community 2 - "Multi-Tenant Database"
Cohesion: 0.08
Nodes (69): getTenantMaintenanceMode(), listSharedContent(), publishSharedContent(), setTenantMaintenanceMode(), bootstrapPublicSql, dbDir, ensurePublicSchema(), migrationFiles (+61 more)

### Community 3 - "Frontend API Client"
Cohesion: 0.03
Nodes (67): API_URL, CloneMeta, ContentSearchResult, createEvent(), createPortalLanguage(), createPortalTenant(), createThemePreset(), deleteCategory() (+59 more)

### Community 4 - "Backup & Migration"
Cohesion: 0.07
Nodes (63): CloneMeta, cloneStore, DATE_KEYS, deleteClone(), exportStaticSite(), exportTenantBackup(), exportTenantDesignClone(), getClone() (+55 more)

### Community 5 - "Caching Layer"
Cohesion: 0.06
Nodes (57): cacheGet(), cacheInvalidate(), cacheSet(), getCacheStats(), getClient(), AccessArgs, AccessFn, CollectionConfig (+49 more)

### Community 6 - "i18n Infrastructure"
Cohesion: 0.10
Nodes (40): BASE_LANG, DesignerCtx, BpToggle(), BufferedInput(), LangToggle(), FieldGroups(), COLUMN_FIELDS, COLUMN_SPACING_KEYS (+32 more)

### Community 7 - "Authentication & MFA"
Cohesion: 0.09
Nodes (51): base32Decode(), base32Encode(), generateCsrfToken(), generateTotpSecret(), hashPassword(), isMfaSetupRequired(), SESSION_TTL_MS, SessionPayload (+43 more)

### Community 8 - "Component Preview"
Cohesion: 0.10
Nodes (49): arePropsEqual(), ElPreviewImpl(), FreeRectPct, FreeSiblingPct, mergeElBp(), RESIZE_HANDLES, ResizeDir, selEq() (+41 more)

### Community 9 - "Frontend Rendering"
Cohesion: 0.07
Nodes (52): Designer.tsx admin canvas, Frontend site renderer, Per-breakpoint field overrides, CSS-injection via semicolon/paren/brace escaping, Unified design element system, WCAG contrast calculation, Free-positioned element style computation, Margin/padding style helpers (+44 more)

### Community 10 - "Module 10"
Cohesion: 0.10
Nodes (41): BlueprintGallery, ListEmpty(), ListLoading(), PAGE_SIZE, CreateForm, createSchema, Button, ButtonProps (+33 more)

### Community 11 - "Module 11"
Cohesion: 0.06
Nodes (41): apiGet(), applyLangOverrides(), BlueprintPreview, cache, Category, EventItem, fetchMenuLinkTargets(), getDefaultSiteChrome() (+33 more)

### Community 12 - "Module 12"
Cohesion: 0.10
Nodes (48): checkAuth(), composeArgsFor(), currentColor(), DEPLOY_LOG, deployState, getAllContainers(), getComposeStatus(), getGitInfo() (+40 more)

### Community 13 - "Module 13"
Cohesion: 0.07
Nodes (40): AccordionContent, AccordionItem, AccordionTrigger, Avatar, AvatarFallback, AvatarImage, CardDescription, CardFooter (+32 more)

### Community 14 - "Module 14"
Cohesion: 0.12
Nodes (44): configure_optional_integrations(), create_superadmin(), create_superadmin_production(), curl_reachable(), curl_reachable_host(), detect_os_family(), detect_public_host(), diagnose_reachability() (+36 more)

### Community 15 - "Module 15"
Cohesion: 0.05
Nodes (43): dependencies, @blocknote/core, @blocknote/mantine, @blocknote/react, class-variance-authority, clsx, cmdk, @hookform/resolvers (+35 more)

### Community 16 - "Module 16"
Cohesion: 0.14
Nodes (27): btnGhost, btnPrimary, card, FormError(), I18nCtx, inputCls, NavButton(), PERMISSION_LABEL_KEY (+19 more)

### Community 17 - "Module 17"
Cohesion: 0.12
Nodes (26): DesignerCanvasProps, ROW_PRESETS, DesignerPaletteProps, DEVICE_DIMS, ElPreview, BlockOpsDeps, __testOnly_blockOpsFns(), LiveEditBridgeDeps (+18 more)

### Community 18 - "Module 18"
Cohesion: 0.05
Nodes (38): dependencies, astro, @astrojs/node, daisyui, ioredis, swiper, tailwindcss, @tailwindcss/vite (+30 more)

### Community 19 - "Module 19"
Cohesion: 0.05
Nodes (33): tailwindcss, @tailwindcss/vite, tsx, @types/node, typescript, @ucms/element-render, @ucms/element-schema, @ucms/element-style (+25 more)

### Community 20 - "Module 20"
Cohesion: 0.08
Nodes (25): NAV_GROUP_LABEL, NAV_GROUP_ORDER, NavGroup, useT(), CategoryTranslations(), CONTENT_SUBTAB_GROUP, ContentManager(), ContentSubTab (+17 more)

### Community 21 - "Module 21"
Cohesion: 0.12
Nodes (28): CtxMenuState, DesignerDevicePreviewModalProps, PreviewModalState, DesignerHistoryModal(), DesignerHistoryModalProps, DesignerTemplatesModalProps, DesignerTopBarProps, BEZEL_PAD (+20 more)

### Community 22 - "Module 22"
Cohesion: 0.09
Nodes (21): ClipLevel, DesignerPalette(), CONTENT_KEYS, ELS, LAYOUT_PRESETS, LayoutPreset, BlockOpsClipboard, CLIP_KEYS (+13 more)

### Community 23 - "Module 23"
Cohesion: 0.11
Nodes (22): GOOGLE_FONTS, oklchToHex(), oklchToRgb(), DISPLAY_ONLY_FONTS, FONT_PAIRINGS, isLegibleFont(), presetToColors(), randomFontPairing() (+14 more)

### Community 24 - "Module 24"
Cohesion: 0.12
Nodes (24): BlueprintGallery(), refresh(), remove(), saveEdit(), blueprintRows(), EventsPanel(), onCreate(), openEdit() (+16 more)

### Community 25 - "Module 25"
Cohesion: 0.11
Nodes (20): SettingsPanel(), addLanguage(), pickRestoreFile(), reloadLanguages(), reloadLoginSettings(), reloadProxySettings(), reloadProxyTenants(), removeLanguage() (+12 more)

### Community 26 - "Module 26"
Cohesion: 0.07
Nodes (26): auditLog, categories, designTemplates, events, languages, loginAttempts, media, mediaFolders (+18 more)

### Community 27 - "Module 27"
Cohesion: 0.12
Nodes (17): bgUrl, v, getBlueprintPreview(), getLivePreviewOverride(), getPageBySlug(), getTheme(), SiteChrome, Block (+9 more)

### Community 28 - "Module 28"
Cohesion: 0.10
Nodes (17): SeoPreviewCard(), PostEditorPage, MediaPickerModal(), autoExcerpt(), DisplayOverride, effectiveDisplay(), fromDisplayOverride(), LangContent (+9 more)

### Community 29 - "Module 29"
Cohesion: 0.11
Nodes (22): bestTextColor(), BORDER, computeFreePositionStyle(), contrastRatio(), elBorderShadowStyle(), elMarginStyle(), elPaddingStyle(), elRadius() (+14 more)

### Community 30 - "Module 30"
Cohesion: 0.19
Nodes (16): block(), SRCSET_WIDTHS, string, renderInline(), cls(), elBorderShadowStyle(), fluidClamp(), fluidTextSize() (+8 more)

### Community 31 - "Module 31"
Cohesion: 0.16
Nodes (18): getRedisClient(), createPageBlueprint(), deletePageBlueprint(), getPageBlueprint(), listPageBlueprints(), updatePageBlueprint(), createThemePreset(), deleteThemePreset() (+10 more)

### Community 32 - "Module 32"
Cohesion: 0.20
Nodes (22): checkDocker(), createSuperadmin(), ensureCredentials(), ensureReachableOrReport(), fetchStatusCode(), fillEnvIfBlank(), findFreePort(), flags (+14 more)

### Community 33 - "Module 33"
Cohesion: 0.14
Nodes (19): CategoriesPanel(), onCreate(), refresh(), remove(), rename(), toggleMultilang(), slugify(), pageHasContent() (+11 more)

### Community 34 - "Module 34"
Cohesion: 0.10
Nodes (19): ioredis, tsx, @types/node, typescript, @ucms/element-schema, name, private, type (+11 more)

### Community 35 - "Module 35"
Cohesion: 0.10
Nodes (20): dependencies, @ucms/element-style, devDependencies, tsx, @types/node, typescript, tsx, @types/node (+12 more)

### Community 36 - "Module 36"
Cohesion: 0.13
Nodes (15): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut() (+7 more)

### Community 37 - "Module 37"
Cohesion: 0.12
Nodes (18): Canva-style Draft Autosave, Live Edit Bridge, Designer Page Builder Canvas, Recursive Container Element, Row Flex Container, Selection Path Mutation De-hardcoding, Slider/Banner Rework (2026-09-05), Slider Canvas Canva-style Controls (+10 more)

### Community 38 - "Module 38"
Cohesion: 0.24
Nodes (16): guideLine(), startFreeElDrag(), move(), up(), startFreeElResize(), move(), up(), startFreeElRotate() (+8 more)

### Community 39 - "Module 39"
Cohesion: 0.24
Nodes (15): getMergedStorageLimits(), deleteImageVariants(), generateImageVariants(), ImageMeta, SRCSET_WIDTHS, registerMediaRoutes(), deleteFile(), getS3Client() (+7 more)

### Community 40 - "Module 40"
Cohesion: 0.11
Nodes (17): devDependencies, tsx, @types/node, typescript, tsx, @types/node, typescript, main (+9 more)

### Community 41 - "Module 41"
Cohesion: 0.11
Nodes (17): devDependencies, tsx, @types/node, typescript, tsx, @types/node, typescript, main (+9 more)

### Community 42 - "Module 42"
Cohesion: 0.20
Nodes (13): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+5 more)

### Community 43 - "Module 43"
Cohesion: 0.21
Nodes (12): MediaManager(), addFolder(), bulkDelete(), onDrop(), onFileChosen(), refreshFolders(), refreshItems(), remove() (+4 more)

### Community 44 - "Module 44"
Cohesion: 0.13
Nodes (7): Designer(), fourSideValue(), onKey(), AnyFn, useStableFns(), redo(), undo()

### Community 45 - "Module 45"
Cohesion: 0.17
Nodes (8): usePageAndLanguage(), clickPageLanguagePill(), elTypeAtPath(), langStackKeysOverridden(), retranslatePageLanguage(), seedMissingTextOverrides(), switchPageLanguage(), toggleLangStackKeys()

### Community 46 - "Module 46"
Cohesion: 0.22
Nodes (13): CloneBox(), promote(), refresh(), remove(), replace(), run(), stage(), isStagingTenant() (+5 more)

### Community 47 - "Module 47"
Cohesion: 0.13
Nodes (15): dependencies, @aws-sdk/client-s3, @aws-sdk/lib-storage, drizzle-orm, fastify, @fastify/cors, @fastify/helmet, @fastify/multipart (+7 more)

### Community 48 - "Module 48"
Cohesion: 0.15
Nodes (13): ESLint Flat Config (v9+), @eslint/js recommended config, eslint-plugin-react-hooks, apps/admin TypeScript/TSX linting scope, name, packageManager, private, version (+5 more)

### Community 49 - "Module 49"
Cohesion: 0.22
Nodes (10): emptyItem(), ItemTranslations(), MenuItemsEditor(), addItem(), moveItem(), patchItem(), removeItem(), update() (+2 more)

### Community 50 - "Module 50"
Cohesion: 0.15
Nodes (12): aliases, components, utils, iconLibrary, rsc, $schema, style, tailwind (+4 more)

### Community 51 - "Module 51"
Cohesion: 0.22
Nodes (10): InspectorRowPanel(), colStyle(), elBorderShadowStyle(), gapPx(), H_SIZE, overlayColors(), renderInline(), safeHref() (+2 more)

### Community 52 - "Module 52"
Cohesion: 0.29
Nodes (10): Bp, BpStyleApi, bpStyleFns(), bpGetValue(), bpKey(), bpKeysOverridden(), sideValue(), toggleBpKeys() (+2 more)

### Community 53 - "Module 53"
Cohesion: 0.17
Nodes (12): scripts, build, db:generate, db:migrate, db:setup-role, dev, start, tenant:add (+4 more)

### Community 54 - "Module 54"
Cohesion: 0.29
Nodes (10): LINK_TYPES, LinkType, validateCommonItemFields(), validateItem(), validateLinkFields(), validateMegaMenu(), validateMegaMenuItem(), validateMenuItems() (+2 more)

### Community 55 - "Module 55"
Cohesion: 0.23
Nodes (8): TenantDb, UnknownTenantError, fastify, FastifyRequest, tenantPlugin(), isTenantRateLimited(), MAX_PER_WINDOW, memoryBuckets

### Community 56 - "Module 56"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, types, exclude (+3 more)

### Community 57 - "Module 57"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, types, exclude (+3 more)

### Community 58 - "Module 58"
Cohesion: 0.17
Nodes (11): compilerOptions, declaration, module, moduleResolution, outDir, rootDir, types, exclude (+3 more)

### Community 59 - "Module 59"
Cohesion: 0.18
Nodes (11): devDependencies, @playwright/test, tailwindcss, @tailwindcss/vite, tsx, @types/node, @types/react, @types/react-dom (+3 more)

### Community 60 - "Module 60"
Cohesion: 0.18
Nodes (10): compilerOptions, baseUrl, jsx, lib, noEmit, paths, exclude, extends (+2 more)

### Community 61 - "Module 61"
Cohesion: 0.20
Nodes (9): bootstrapSql, client, [email, password, role, tenantHost], bootstrapSql, client, [json], sql, client (+1 more)

### Community 63 - "Module 63"
Cohesion: 0.22
Nodes (5): App(), loadSession(), Toaster(), ToasterProps, next-themes

### Community 64 - "Module 64"
Cohesion: 0.22
Nodes (9): SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle, sheetVariants (+1 more)

### Community 65 - "Module 65"
Cohesion: 0.44
Nodes (6): PageAndLanguageDeps, applyLangOverrides(), isTextKey(), migrateOldTranslation(), pathKey(), TRANSLATABLE_TEXT_KEYS

### Community 66 - "Module 66"
Cohesion: 0.31
Nodes (7): UsersPanel(), assignRole(), create(), refresh(), removeUser(), saveEditTenantHosts(), setUserExtraPermissions()

### Community 67 - "Module 67"
Cohesion: 0.20
Nodes (9): compilerOptions, module, moduleResolution, outDir, rootDir, types, extends, include (+1 more)

### Community 68 - "Module 68"
Cohesion: 0.24
Nodes (6): listCategories(), listPages(), listPosts(), category, GET(), astro

### Community 69 - "Module 69"
Cohesion: 0.20
Nodes (10): scripts, build, dev:admin, dev:api, dev:frontend, format, format:check, lint (+2 more)

### Community 70 - "Module 70"
Cohesion: 0.24
Nodes (9): TypeScript esModuleInterop enabled, TypeScript isolatedModules enabled, TypeScript module: ESNext, TypeScript moduleResolution: Bundler, TypeScript resolveJsonModule enabled, TypeScript skipLibCheck enabled, TypeScript strict mode enabled, TypeScript target: ES2022 (+1 more)

### Community 71 - "Module 71"
Cohesion: 0.20
Nodes (10): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution, resolveJsonModule, skipLibCheck (+2 more)

### Community 72 - "Module 72"
Cohesion: 0.28
Nodes (7): Badge(), BadgeProps, badgeVariants, Label, labelVariants, class-variance-authority, @radix-ui/react-label

### Community 73 - "Module 73"
Cohesion: 0.39
Nodes (9): emptyMegaColumnItem(), MegaMenuEditor(), addColumn(), addColumnItem(), patchColumn(), patchColumnItem(), removeColumn(), removeColumnItem() (+1 more)

### Community 74 - "Module 74"
Cohesion: 0.25
Nodes (6): BOOKMARK_CARD_STYLE, bookmarkCardBlockSpec, bookmarkCardSchema, createBookmarkCardBlockSpec, @blocknote/core, @blocknote/react

### Community 76 - "Module 76"
Cohesion: 0.25
Nodes (3): ErrorCorrectionLevel, QRCode, qrcode-generator

### Community 77 - "Module 77"
Cohesion: 0.43
Nodes (4): extractCookieValue(), seedDesignerPage(), SeedResult, @playwright/test

### Community 78 - "Module 78"
Cohesion: 0.29
Nodes (7): scripts, build, dev, preview, test, test:e2e, typecheck

### Community 79 - "Module 79"
Cohesion: 0.48
Nodes (7): setColSideValue(), setElSideValue(), setFourSideValue(), langKeysOverridden(), setLangValue(), toggleLangKeys(), mutate()

### Community 80 - "Module 80"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, noEmit, extends, include, ../../tsconfig.base.json

### Community 81 - "Module 81"
Cohesion: 0.29
Nodes (7): i18n Phase 1: Global Language Registry, i18n Phase 2: Per-Tenant Language Subset, i18n Phase 3/4: Content Translations (Corrected Design), i18n Phase 3/4: Rejected First Design, i18n Phase 5 Follow-up: Default Language, i18n Phase 5: WPML-style Opt-in Switch, Design: Language Code Immutable

### Community 82 - "Module 82"
Cohesion: 0.29
Nodes (7): devDependencies, drizzle-kit, tsx, @types/node, @types/pg, @types/sanitize-html, typescript

### Community 83 - "Module 83"
Cohesion: 0.38
Nodes (6): clientDir, CSP, MIME, server, serveStatic(), setSecurityHeaders()

### Community 84 - "Module 84"
Cohesion: 0.62
Nodes (5): getTenantStatus(), getClient(), htmlCacheGet(), htmlCacheSet(), onRequest()

### Community 85 - "Module 85"
Cohesion: 0.33
Nodes (5): compilerOptions, baseUrl, paths, files, references

### Community 86 - "Module 86"
Cohesion: 0.40
Nodes (6): Multi-tenancy: Database-per-Tenant Architecture, Control Plane Database, Database-per-Tenant Model, Single Instance Multiple Deployments, Multi-tenant Headless CMS, Tenant Identity via x-tenant-host Header

### Community 87 - "Module 87"
Cohesion: 0.33
Nodes (6): Posts Category: Managed Taxonomy, Posts Revisions: History Snapshots, Posts Table: Body HTML Sanitization, Security: Media Upload Extension Fix, Design: Category Name Snapshot in Post Revision, Design: Tags Freeform, Categories Managed

### Community 88 - "Module 88"
Cohesion: 0.53
Nodes (4): derive_tenant_url(), dump_tenant(), backup.sh script, to_dbname()

### Community 89 - "Module 89"
Cohesion: 0.40
Nodes (5): DIST_DIR, MIME, PORT, safeJoin(), server

### Community 90 - "Module 90"
Cohesion: 0.33
Nodes (6): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, prettier, typescript-eslint

### Community 91 - "Module 91"
Cohesion: 0.60
Nodes (5): useLiveEditBridge(), enterLive(), handleFrameLoad(), postShowSlides(), toggleLive()

### Community 92 - "Module 92"
Cohesion: 0.60
Nodes (4): SecurityPanel(), confirmDisable(), confirmEnroll(), reload()

### Community 93 - "Module 93"
Cohesion: 0.40
Nodes (4): bootstrapSql, client, departmentName, [host, ...nameParts]

### Community 94 - "Module 94"
Cohesion: 0.50
Nodes (3): RadioGroup, RadioGroupItem, @radix-ui/react-radio-group

### Community 95 - "Module 95"
Cohesion: 0.50
Nodes (3): ScrollArea, ScrollBar, @radix-ui/react-scroll-area

### Community 96 - "Module 96"
Cohesion: 0.50
Nodes (4): downloadClone(), downloadStaticExport(), downloadTenantBackup(), downloadZip()

### Community 97 - "Module 97"
Cohesion: 0.50
Nodes (4): Auth: Microsoft Entra ID SSO, Auth: Entra Login CSRF Fix, Auth: Session Cookie + CSRF Migration, Design: Never Auto-Provision from Entra

### Community 99 - "Module 99"
Cohesion: 0.50
Nodes (3): exclude, extends, astro/tsconfigs/strict

### Community 100 - "Module 100"
Cohesion: 0.50
Nodes (3): Set-IfBlank(), engines, node

### Community 106 - "Module 106"
Cohesion: 0.67
Nodes (3): getLoginSettings(), setLoginSettings(), toLoginSettings()

### Community 107 - "Module 107"
Cohesion: 0.67
Nodes (3): listPagesPage(), listPostsPage(), toQuery()

### Community 108 - "Module 108"
Cohesion: 0.67
Nodes (3): MenuItem, MenuLinkFields, MenuMegaColumnItem

### Community 109 - "Module 109"
Cohesion: 0.67
Nodes (3): parseJsonBody(), uploadGlobalBranding(), uploadMedia()

### Community 110 - "Module 110"
Cohesion: 0.67
Nodes (3): Collections: Code-First System, Collections: Generic Query Filters, Design: RLS as Defense-in-Depth

### Community 112 - "Module 112"
Cohesion: 0.67
Nodes (3): Database and application configuration, Blue-green zero-downtime deployment, Multi-tenant database setup

### Community 113 - "Module 113"
Cohesion: 0.67
Nodes (3): Deferred .astro linting support, ESLint ignore patterns (dist, node_modules, .astro), apps/api and apps/frontend .ts file linting

### Community 115 - "Module 115"
Cohesion: 0.67
Nodes (3): Drizzle ORM, Fastify Backend Framework, No Bloat Principle

## Knowledge Gaps
- **578 isolated node(s):** `printWidth`, `$schema`, `style`, `rsc`, `tsx` (+573 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 779 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DangerZone()` connect `Module 20` to `Module 16`?**
  _High betweenness centrality (0.263) - this node is a cross-community bridge._
- **Why does `del()` connect `Module 20` to `Module 27`?**
  _High betweenness centrality (0.263) - this node is a cross-community bridge._
- **Why does `line()` connect `Caching Layer` to `Module 27`?**
  _High betweenness centrality (0.230) - this node is a cross-community bridge._
- **What connects `printWidth`, `$schema`, `style` to the rest of the system?**
  _578 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Design Canvas & Layout` be split into smaller, more focused modules?**
  _Cohesion score 0.0526111434672879 - nodes in this community are weakly interconnected._
- **Should `Collection Data Models` be split into smaller, more focused modules?**
  _Cohesion score 0.024691358024691357 - nodes in this community are weakly interconnected._
- **Should `Multi-Tenant Database` be split into smaller, more focused modules?**
  _Cohesion score 0.08291708291708291 - nodes in this community are weakly interconnected._