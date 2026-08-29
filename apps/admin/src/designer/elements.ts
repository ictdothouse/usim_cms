// Element-type registry: for each ElType, its label, palette icon, default
// prop values, and Inspector field list. Split out of Designer.tsx as part
// of Layer 1b (Inspector/ElPreview extraction, see
// docs/superpowers/specs/2026-08-20-designer-tsx-refactor-design.md) — a
// plain module-level table with zero closure dependency on Designer() state,
// but ElPreview.tsx needs it directly and designer/ files can never import
// back from Designer.tsx (see designer/types.ts's own note), so it has to
// live in designer/ too.
//
// This table is the closest thing this codebase has today to a plugin/
// element registry: adding a new element type still also means touching
// ElPreview.tsx's render switch, apps/api's validate-layout.ts, and
// SectionBlock.astro's own render switch — a single ElementDefinition
// object combining schema + canvas-render + site-render + validator is a
// bigger, separate design question, not attempted here.
import {
  Bell,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  Code2,
  FileText,
  GalleryHorizontal,
  Heading1,
  History,
  Image as ImageIcon,
  Images,
  Info,
  LayoutGrid,
  LayoutPanelTop,
  List,
  MapPin,
  Megaphone,
  Menu,
  Minus,
  MousePointerClick,
  MoveVertical,
  Newspaper,
  Quote,
  Radio,
  Share2,
  Star,
  Type,
  Users,
  Video,
} from "lucide-react";
import type { Key } from "@/i18n";
import type { CardItem, ElType, Field } from "./types";
import { TYPOGRAPHY_FIELDS } from "./fields";
import { ICONS } from "./icons";

export const ELS: Record<ElType, { labelKey: Key; icon: typeof Type; defaults: Record<string, string>; fields: Field[] }> = {
  heading: {
    labelKey: "designer-el-heading",
    icon: Heading1,
    defaults: { text: "Heading", level: "2", align: "left" },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "level", labelKey: "designer-f-level", kind: "select", options: ["1", "2", "3", "4"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
      ...TYPOGRAPHY_FIELDS,
    ],
  },
  text: {
    labelKey: "designer-el-text",
    icon: Type,
    defaults: { text: "", size: "1rem", align: "left" },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "size", labelKey: "designer-f-size", kind: "length" },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
      ...TYPOGRAPHY_FIELDS,
    ],
  },
  image: {
    labelKey: "designer-el-image",
    icon: ImageIcon,
    defaults: { src: "", alt: "", radius: "md" },
    fields: [
      { key: "src", labelKey: "designer-f-src", kind: "image" },
      { key: "alt", labelKey: "designer-f-alt", kind: "text" },
      // radius edited via FourSideControl (element Inspector) — see ELS-radius branch.
      { key: "shadow", labelKey: "designer-s-shadow", kind: "shadow" },
    ],
  },
  button: {
    labelKey: "designer-el-button",
    icon: MousePointerClick,
    defaults: { label: "Button", href: "#", variant: "primary", align: "left" },
    fields: [
      { key: "label", labelKey: "designer-f-label", kind: "text" },
      { key: "href", labelKey: "designer-f-href", kind: "text" },
      { key: "variant", labelKey: "designer-f-variant", kind: "select", options: ["primary", "outline"] },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  spacer: {
    labelKey: "designer-el-spacer",
    icon: MoveVertical,
    defaults: { height: "md" },
    fields: [{ key: "height", labelKey: "designer-f-height", kind: "text" }],
  },
  divider: { labelKey: "designer-el-divider", icon: Minus, defaults: {}, fields: [] },
  embed: {
    labelKey: "designer-el-embed",
    icon: Video,
    defaults: { url: "", ratio: "16:9", radius: "md" },
    fields: [
      { key: "url", labelKey: "designer-f-url", kind: "text" },
      { key: "ratio", labelKey: "designer-f-ratio", kind: "select", options: ["16:9", "4:3", "1:1"] },
      // radius edited via FourSideControl (element Inspector) — see ELS-radius branch.
      { key: "shadow", labelKey: "designer-s-shadow", kind: "shadow" },
    ],
  },
  icon: {
    labelKey: "designer-el-icon",
    icon: Star,
    defaults: { name: "check", size: "1.5rem", color: "", align: "left" },
    fields: [
      { key: "name", labelKey: "designer-f-icon-name", kind: "icon", options: Object.keys(ICONS) },
      { key: "size", labelKey: "designer-f-icon-size", kind: "length" },
      { key: "color", labelKey: "designer-f-icon-color", kind: "color" },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  list: {
    labelKey: "designer-el-list",
    icon: List,
    defaults: { items: "", style: "bullet" },
    fields: [
      { key: "items", labelKey: "designer-f-list-items", kind: "textarea" },
      { key: "style", labelKey: "designer-f-list-style", kind: "select", options: ["bullet", "numbered", "none"] },
      ...TYPOGRAPHY_FIELDS,
    ],
  },
  html: {
    labelKey: "designer-el-html",
    icon: Code2,
    // Pairs with cssClass on section/column/element (see COLUMN_FIELDS):
    // there's no separate site-wide custom-CSS field, so a <style> tag
    // dropped in here is how a cssClass actually gets styled.
    defaults: { html: "" },
    fields: [{ key: "html", labelKey: "designer-f-html", kind: "textarea" }],
  },
  gallery: {
    labelKey: "designer-el-gallery",
    icon: Images,
    defaults: { images: "", columns: "3", radius: "md" },
    fields: [
      { key: "images", labelKey: "designer-f-gallery-images", kind: "gallery" },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
      // radius edited via FourSideControl (element Inspector) — see ELS-radius branch.
    ],
  },
  // Question|Answer pairs, one per line — same simple delimited-line
  // convention as `list`'s items, chosen over building a whole new
  // structured-repeater Field kind just for this. Rendered as native
  // <details>/<summary> (SectionBlock.astro) — zero client JS, free
  // accessibility, matches this app's "no client-side JS" frontend
  // convention exactly instead of fighting it.
  accordion: {
    labelKey: "designer-el-accordion",
    icon: ChevronsUpDown,
    defaults: { items: "Question one|Answer to question one\nQuestion two|Answer to question two", exclusive: "false" },
    fields: [
      {
        key: "items",
        labelKey: "designer-f-accordion-items",
        kind: "pairs",
        subLabels: ["designer-f-accordion-question", "designer-f-accordion-answer"],
      },
      { key: "exclusive", labelKey: "designer-f-accordion-exclusive", kind: "select", options: ["false", "true"] },
    ],
  },
  // Icon + heading + short text — the common "feature card" building block
  // (Elementor's Icon Box). Drop 3 of these into a 3-column Row for a
  // features section; background/border/shadow "card" look comes from the
  // Column it sits in (see COLUMN_FIELDS), not from this element itself.
  infobox: {
    labelKey: "designer-el-infobox",
    icon: Info,
    defaults: { name: "star", heading: "Feature title", text: "Feature description", align: "left", iconPosition: "top" },
    fields: [
      { key: "name", labelKey: "designer-f-icon-name", kind: "icon", options: Object.keys(ICONS) },
      { key: "color", labelKey: "designer-f-icon-color", kind: "color" },
      { key: "heading", labelKey: "designer-f-infobox-heading", kind: "text" },
      { key: "text", labelKey: "designer-f-text", kind: "textarea" },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center"] },
      { key: "iconPosition", labelKey: "designer-f-infobox-iconposition", kind: "select", options: ["top", "left"] },
    ],
  },
  // Label|Content pairs, one per line — same delimited-line convention as
  // accordion. Switching panels needs a click handler (unlike accordion's
  // native <details>), so this is the one static element that ships a small
  // vanilla-JS listener (SectionBlock.astro's own <script>, event-delegated
  // so it initializes every .ds-tabs instance on the page with one listener,
  // not a heavier tabs library).
  tabs: {
    labelKey: "designer-el-tabs",
    icon: LayoutPanelTop,
    defaults: { items: "Tab one|Content for tab one\nTab two|Content for tab two" },
    fields: [
      {
        key: "items",
        labelKey: "designer-f-tabs-items",
        kind: "pairs",
        subLabels: ["designer-f-tabs-label", "designer-f-tabs-content"],
      },
    ],
  },
  // A JSON array of slide objects (image, heading, subtitle, text position,
  // overlay color/opacity, multiple buttons) — see parseSlides/stringifySlides
  // (designer/parsers.ts). Rendered by SectionBlock.astro via Embla Carousel
  // (headless, vanilla JS — drag/swipe/momentum/looping) instead of
  // hand-rolled scroll math, with an optional autoplay plugin.
  slider: {
    labelKey: "designer-el-slider",
    icon: GalleryHorizontal,
    defaults: {
      slides: JSON.stringify([
        { imageUrl: "", heading: "Slide one heading", subtitle: "Slide one subtitle", textPosition: "center", overlayColor: "#000000", overlayOpacity: "35", buttons: [] },
        { imageUrl: "", heading: "Slide two heading", subtitle: "Slide two subtitle", textPosition: "center", overlayColor: "#000000", overlayOpacity: "35", buttons: [] },
      ]),
      autoplay: "0",
      // A literal length now that the field itself accepts one directly
      // (kind "length", below) — "32rem" is exactly what the old "md" preset
      // keyword already resolved to (SLIDER_HEIGHT in designer/style.ts and
      // SectionBlock.astro), so a freshly-added slider looks identical to
      // before. Pages saved before this change keep the "sm"/"md"/"lg"/"full"
      // keyword itself, which lengthValue() still resolves the exact same
      // way — never a hard migration, upgrades silently on next edit, same
      // convention as every other schema evolution in this element.
      height: "32rem",
      navStyle: "arrows",
      dotsStyle: "dots",
      transition: "slide",
    },
    fields: [
      { key: "slides", labelKey: "designer-f-slider-slides", kind: "slides" },
      { key: "autoplay", labelKey: "designer-f-slider-autoplay", kind: "select", options: ["0", "3", "5", "8"] },
      // px/%/em/rem/vh/vw via the shared "length" kind — was a closed
      // sm/md/lg/full select, which could never express a custom px or vh
      // value at all. 100vh now covers the old "full" preset directly.
      { key: "height", labelKey: "designer-f-slider-height", kind: "length" },
      { key: "navStyle", labelKey: "designer-f-slider-nav", kind: "select", options: ["arrows", "minimal", "none"] },
      { key: "dotsStyle", labelKey: "designer-f-slider-pagination", kind: "select", options: ["dots", "lines", "numbers", "none"] },
      { key: "transition", labelKey: "designer-f-slider-transition", kind: "select", options: ["slide", "fade"] },
    ],
  },
  // Drops a saved Menu (built in the Menus admin panel) into any page — the
  // element itself just holds a reference (menuId) plus render options; the
  // actual item tree lives on the Menu row, edited elsewhere.
  menu: {
    labelKey: "designer-el-menu",
    icon: Menu,
    defaults: { menuId: "", layout: "horizontal", dropdownTrigger: "hover", megaMenuWidth: "contained" },
    fields: [
      { key: "menuId", labelKey: "designer-f-menu", kind: "menu-select" },
      { key: "layout", labelKey: "designer-f-menu-layout", kind: "select", options: ["horizontal", "vertical"] },
      { key: "dropdownTrigger", labelKey: "designer-f-menu-trigger", kind: "select", options: ["hover", "click"] },
      { key: "megaMenuWidth", labelKey: "designer-f-menu-width", kind: "select", options: ["contained", "full-width"] },
    ],
  },
  // Sprint 5 (docs/laporan-audit-ui-ux.md section 5.6) — most versatile
  // content block per the audit's own ranking: news, quick links, services,
  // programs. `cards` is a JSON array (CardItem[], see designer/parsers.ts's
  // parseCards/stringifyCards) — a brand new element, unlike slider, so no
  // legacy delimited-line format to support.
  cardgrid: {
    labelKey: "designer-el-cardgrid",
    icon: LayoutGrid,
    defaults: {
      cards: JSON.stringify([
        { image: "", title: "Card one", description: "Short description", href: "#", buttonLabel: "" },
        { image: "", title: "Card two", description: "Short description", href: "#", buttonLabel: "" },
        { image: "", title: "Card three", description: "Short description", href: "#", buttonLabel: "" },
      ] satisfies CardItem[]),
      columns: "3",
      equalHeight: "true",
    },
    fields: [
      { key: "cards", labelKey: "designer-f-cardgrid-items", kind: "cards" },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
      { key: "equalHeight", labelKey: "designer-f-cardgrid-equalheight", kind: "select", options: ["true", "false"] },
    ],
  },
  // Conversion element — heading/description + up to 2 buttons + optional
  // background color/image. Flat props (no repeater), unlike cardgrid.
  ctabanner: {
    labelKey: "designer-el-ctabanner",
    icon: Megaphone,
    defaults: {
      heading: "Ready to get started?",
      description: "",
      button1Label: "Learn more",
      button1Href: "#",
      button2Label: "",
      button2Href: "",
      align: "center",
      bgColor: "",
      bgImage: "",
    },
    fields: [
      { key: "heading", labelKey: "designer-f-ctabanner-heading", kind: "text" },
      { key: "description", labelKey: "designer-f-text", kind: "textarea" },
      { key: "button1Label", labelKey: "designer-f-ctabanner-btn1label", kind: "text" },
      { key: "button1Href", labelKey: "designer-f-href", kind: "text" },
      { key: "button2Label", labelKey: "designer-f-ctabanner-btn2label", kind: "text" },
      { key: "button2Href", labelKey: "designer-f-href", kind: "text" },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
      { key: "bgColor", labelKey: "designer-s-bg", kind: "color" },
      { key: "bgImage", labelKey: "designer-s-bgimage", kind: "image" },
    ],
  },
  // Time-sensitive institutional notice, meant to sit at the very top of a
  // page (audit report 5.6 item 4). Dismissible client-side only (no
  // per-visitor persistence — reappears on reload, same as any static-site
  // convention here: no cookie/localStorage plumbing for this one banner).
  announcementbar: {
    labelKey: "designer-el-announcementbar",
    icon: Bell,
    defaults: {
      text: "Important announcement",
      linkLabel: "",
      linkHref: "",
      bgColor: "#111827",
      textColor: "#ffffff",
      dismissible: "true",
    },
    fields: [
      { key: "text", labelKey: "designer-f-text", kind: "text" },
      { key: "linkLabel", labelKey: "designer-f-announcementbar-linklabel", kind: "text" },
      { key: "linkHref", labelKey: "designer-f-href", kind: "text" },
      { key: "bgColor", labelKey: "designer-s-bg", kind: "color" },
      { key: "textColor", labelKey: "designer-s-textcolor", kind: "color" },
      { key: "dismissible", labelKey: "designer-f-announcementbar-dismissible", kind: "select", options: ["true", "false"] },
    ],
  },
  // Pulls from the tenant's own posts collection (audit report 5.6 item 5 —
  // "guna content CMS sedia ada, bukan duplicate content manual"), never
  // duplicated content of its own. categoryId is a reference only (like
  // menu's menuId) — the actual posts are fetched at render time
  // (apps/frontend's PostListBlock.astro).
  postlist: {
    labelKey: "designer-el-postlist",
    icon: Newspaper,
    defaults: { categoryId: "", count: "3", columns: "3", postLayout: "grid" },
    fields: [
      { key: "categoryId", labelKey: "designer-f-postlist-category", kind: "category-select" },
      { key: "count", labelKey: "designer-f-postlist-count", kind: "select", options: ["3", "4", "6", "9"] },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
      { key: "postLayout", labelKey: "designer-f-postlist-layout", kind: "select", options: ["grid", "list"] },
    ],
  },
  // Event listing (UX audit backlog, deferred alongside Contact form) — same
  // "reference, not a copy" idea as postlist/menu: only a count/layout
  // config lives here, the actual events are fetched at render time
  // (apps/frontend's EventListBlock.astro) from the events collection
  // (EventsPanel/CategoriesPanel-style admin CRUD, superadmin ContentManager
  // sub-tab + webmaster top-level Tab, see App.tsx).
  eventlist: {
    labelKey: "designer-el-eventlist",
    icon: CalendarDays,
    defaults: { count: "3", columns: "3", eventLayout: "grid" },
    fields: [
      { key: "count", labelKey: "designer-f-eventlist-count", kind: "select", options: ["3", "4", "6", "9"] },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
      { key: "eventLayout", labelKey: "designer-f-eventlist-layout", kind: "select", options: ["grid", "list"] },
    ],
  },
  // Batch of simple, no-backend elements (audit report 5.2/5.7) — each a
  // repeater (see FieldKind "repeater") except googlemap/announcementticker.
  // Each repeater's own prop key (testimonials/stats/people/socials/logos/
  // timelineItems/documents/tickerItems) is deliberately NOT "items" — that
  // name is already accordion/tabs' own free-text pipe-line field, and
  // packages/element-schema's validateValue dispatches purely by key name;
  // reusing "items" would have let a repeater's JSON array (containing
  // image/url fields that need real checks) through that free-text branch
  // completely unvalidated. Own key per element also matches the existing
  // cardgrid ("cards") / slider ("slides") convention.
  testimonial: {
    labelKey: "designer-el-testimonial",
    icon: Quote,
    defaults: {
      testimonials: JSON.stringify([
        { avatar: "", quote: "Great programme, helped me grow professionally.", name: "Jane Doe", role: "Alumni", meta: "" },
        { avatar: "", quote: "Excellent collaboration and support.", name: "John Smith", role: "Industry Partner", meta: "" },
      ]),
      columns: "2",
    },
    fields: [
      {
        key: "testimonials",
        labelKey: "designer-f-testimonial-items",
        kind: "repeater",
        itemFields: [
          { key: "avatar", labelKey: "designer-f-testimonial-avatar", type: "image" },
          { key: "quote", labelKey: "designer-f-testimonial-quote", type: "textarea" },
          { key: "name", labelKey: "designer-f-testimonial-name", type: "text" },
          { key: "role", labelKey: "designer-f-testimonial-role", type: "text" },
          { key: "meta", labelKey: "designer-f-testimonial-meta", type: "text" },
        ],
      },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3"] },
    ],
  },
  statscounter: {
    labelKey: "designer-el-statscounter",
    icon: BarChart3,
    defaults: {
      stats: JSON.stringify([
        { number: "1200+", label: "Students", icon: "graduation-cap" },
        { number: "50+", label: "Programmes", icon: "book-open" },
        { number: "10", label: "Years", icon: "award" },
      ]),
      columns: "3",
    },
    fields: [
      {
        key: "stats",
        labelKey: "designer-f-statscounter-items",
        kind: "repeater",
        itemFields: [
          { key: "number", labelKey: "designer-f-statscounter-number", type: "text" },
          { key: "label", labelKey: "designer-f-label", type: "text" },
          { key: "icon", labelKey: "designer-f-icon-name", type: "icon" },
        ],
      },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
    ],
  },
  // Consolidates "Team card" and "People/directory card" (both structurally
  // photo+name+role+contact) into one element — see CLAUDE.md's Page
  // Blueprint/element-registry note for this decision.
  peoplegrid: {
    labelKey: "designer-el-peoplegrid",
    icon: Users,
    defaults: {
      people: JSON.stringify([
        { photo: "", name: "Full Name", role: "Job Title", department: "", email: "", phone: "", href: "" },
      ]),
      columns: "3",
    },
    fields: [
      {
        key: "people",
        labelKey: "designer-f-peoplegrid-items",
        kind: "repeater",
        itemFields: [
          { key: "photo", labelKey: "designer-f-peoplegrid-photo", type: "image" },
          { key: "name", labelKey: "designer-f-peoplegrid-name", type: "text" },
          { key: "role", labelKey: "designer-f-peoplegrid-role", type: "text" },
          { key: "department", labelKey: "designer-f-peoplegrid-department", type: "text" },
          { key: "email", labelKey: "designer-f-peoplegrid-email", type: "text" },
          { key: "phone", labelKey: "designer-f-peoplegrid-phone", type: "text" },
          { key: "href", labelKey: "designer-f-href", type: "text" },
        ],
      },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
    ],
  },
  socialicons: {
    labelKey: "designer-el-socialicons",
    icon: Share2,
    defaults: {
      socials: JSON.stringify([
        { platform: "globe", url: "#" },
        { platform: "mail", url: "#" },
      ]),
      align: "left",
    },
    fields: [
      {
        key: "socials",
        labelKey: "designer-f-socialicons-items",
        kind: "repeater",
        itemFields: [
          { key: "platform", labelKey: "designer-f-socialicons-platform", type: "icon" },
          { key: "url", labelKey: "designer-f-href", type: "text" },
        ],
      },
      { key: "align", labelKey: "designer-f-align", kind: "select", options: ["left", "center", "right"] },
    ],
  },
  logocloud: {
    labelKey: "designer-el-logocloud",
    icon: Building2,
    defaults: {
      logos: JSON.stringify([
        { image: "", href: "", alt: "" },
        { image: "", href: "", alt: "" },
      ]),
      columns: "4",
    },
    fields: [
      {
        key: "logos",
        labelKey: "designer-f-logocloud-items",
        kind: "repeater",
        itemFields: [
          { key: "image", labelKey: "designer-f-src", type: "image" },
          { key: "href", labelKey: "designer-f-href", type: "text" },
          { key: "alt", labelKey: "designer-f-logocloud-alt", type: "text" },
        ],
      },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["2", "3", "4"] },
    ],
  },
  timeline: {
    labelKey: "designer-el-timeline",
    icon: History,
    defaults: {
      timelineItems: JSON.stringify([
        { date: "2020", title: "Founded", description: "" },
        { date: "2024", title: "Milestone", description: "" },
      ]),
    },
    fields: [
      {
        key: "timelineItems",
        labelKey: "designer-f-timeline-items",
        kind: "repeater",
        itemFields: [
          { key: "date", labelKey: "designer-f-timeline-date", type: "text" },
          { key: "title", labelKey: "designer-f-cardgrid-title", type: "text" },
          { key: "description", labelKey: "designer-f-timeline-desc", type: "textarea" },
        ],
      },
    ],
  },
  documentdownload: {
    labelKey: "designer-el-documentdownload",
    icon: FileText,
    defaults: {
      documents: JSON.stringify([{ fileUrl: "", label: "Document.pdf", fileType: "PDF", fileSize: "" }]),
      columns: "2",
    },
    fields: [
      {
        key: "documents",
        labelKey: "designer-f-docdownload-items",
        kind: "repeater",
        itemFields: [
          { key: "fileUrl", labelKey: "designer-f-docdownload-fileurl", type: "text" },
          { key: "label", labelKey: "designer-f-label", type: "text" },
          { key: "fileType", labelKey: "designer-f-docdownload-filetype", type: "text" },
          { key: "fileSize", labelKey: "designer-f-docdownload-filesize", type: "text" },
        ],
      },
      { key: "columns", labelKey: "designer-f-gallery-columns", kind: "select", options: ["1", "2", "3"] },
    ],
  },
  // Audit report 5.3 flags map embeds as needing "consent/cookie policy dan
  // fallback address text" — requireConsent gates the iframe behind a
  // click-to-load placeholder (no cookie/localStorage, same reappears-on-
  // reload convention as announcementbar's own dismiss), and address is
  // always rendered so the map is never the page's only location info.
  googlemap: {
    labelKey: "designer-el-googlemap",
    icon: MapPin,
    defaults: { embedUrl: "", address: "", height: "24rem", requireConsent: "false" },
    fields: [
      { key: "embedUrl", labelKey: "designer-f-googlemap-embedurl", kind: "text" },
      { key: "address", labelKey: "designer-f-googlemap-address", kind: "text" },
      { key: "height", labelKey: "designer-f-height", kind: "length" },
      { key: "requireConsent", labelKey: "designer-f-googlemap-consent", kind: "select", options: ["false", "true"] },
    ],
  },
  // Distinct from announcementbar (dismissible, single message, sits above
  // the page) — a continuously-scrolling marquee of one or more messages,
  // never dismissed.
  announcementticker: {
    labelKey: "designer-el-announcementticker",
    icon: Radio,
    defaults: {
      tickerItems: JSON.stringify([{ text: "Important notice", href: "" }]),
      speed: "normal",
      bgColor: "#111827",
      textColor: "#ffffff",
    },
    fields: [
      {
        key: "tickerItems",
        labelKey: "designer-f-ticker-items",
        kind: "repeater",
        itemFields: [
          { key: "text", labelKey: "designer-f-text", type: "text" },
          { key: "href", labelKey: "designer-f-href", type: "text" },
        ],
      },
      { key: "speed", labelKey: "designer-f-ticker-speed", kind: "select", options: ["slow", "normal", "fast"] },
      { key: "bgColor", labelKey: "designer-s-bg", kind: "color" },
      { key: "textColor", labelKey: "designer-s-textcolor", kind: "color" },
    ],
  },
};
