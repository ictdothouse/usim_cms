// Header/Footer starting layouts for the Header/Footer Designer's Presets
// picker (ChromePresetsModal.tsx), modelled on common UI-kit headers/footers.
// Plain Block[] in the shape the canvas writes, from existing element types
// only, so applying one is an ordinary undoable layout replace and Live Edit/
// the site render it like any hand-built header. chromePresets.test.ts runs
// every preset through @ucms/element-schema's validateLayout.
import type { Key } from "@/i18n";
import type { Block, El, ElType, Row } from "./types";

export interface ChromePresetCtx {
  t: (k: Key) => string;
  logoUrl: string; // the site theme's logo; "" = a text "Logo" placeholder
  menuId: string; // the tenant's first menu; "" = pick one in the Inspector
}
export interface ChromePreset {
  id: string;
  kind: "header" | "footer";
  labelKey: Key;
  build: (c: ChromePresetCtx) => Block[];
}

const uid = () => Math.random().toString(36).slice(2, 10);
const el = (type: ElType, props: Record<string, string>, children?: El[]): El => ({ id: uid(), type, props, ...(children ? { children } : {}) });
// A horizontal flex box: logo/menu/button side by side in one column.
const hbox = (children: El[], props: Record<string, string> = {}) =>
  el("container", { flexDirection: "row", flexWrap: "nowrap", alignItems: "center", justifyContent: "space-between", gap: "1.5rem", ...props }, children);
const col = (span: number, elements: El[], props: Record<string, string> = {}) => ({ span, elements, props: { valign: "center", ...props } });
const row = (...columns: ReturnType<typeof col>[]): Row => ({ columns });
const section = (props: Record<string, string>, ...rows: Row[]): Block => ({
  type: "section",
  props: { width: "contained", paddingY: "1rem", ...props, rows },
});

// The logo links home, like on any site.
const logo = (c: ChromePresetCtx, align = "left") =>
  c.logoUrl ? el("image", { src: c.logoUrl, alt: "Logo", imgWidth: "150px", align, href: "/" }) : el("heading", { text: "Logo", level: "4", align });
const menu = (c: ChromePresetCtx, style: Record<string, string>) =>
  el("menu", { menuId: c.menuId, layout: "horizontal", dropdownTrigger: "hover", megaMenuWidth: "contained", fontSize: "15", fontWeight: "500", ...style });
const button = (label: string, props: Record<string, string> = {}) => el("button", { label, href: "#", variant: "primary", align: "right", ...props });
// Brand logos; the Inspector's platform search swaps them, each "#" waits for the real link.
const socials = (align = "right", socialStyle = "plain") =>
  el("socialicons", {
    socials: JSON.stringify(["facebook", "instagram", "x", "youtube"].map((platform) => ({ platform, url: "#" }))),
    align,
    socialStyle,
  });
const text = (value: string, props: Record<string, string> = {}) => el("text", { text: value, size: "0.875rem", align: "left", ...props });
const iconText = (icon: string, value: string) => hbox([el("icon", { name: icon, size: "1rem" }), text(value)], { justifyContent: "flex-start", gap: "0.5rem" });
const copyright = (c: ChromePresetCtx, props: Record<string, string> = {}) =>
  text(c.t("chrome-sample-copyright").replace("{year}", String(new Date().getFullYear())), props);

// Dark bars keep their dropdowns + mobile menu panel dark too.
const DARK = "#111827";
const DARK_MENU = { dropdownBg: "#1f2937", dropdownColor: "#f9fafb" };
const HAIRLINE = "0|1|0|0|#000000|0.08"; // a 1px line under a white bar

export const CHROME_PRESETS: ChromePreset[] = [
  {
    id: "classic",
    kind: "header",
    labelKey: "chrome-preset-classic",
    build: (c) => [
      section(
        { bg: "#ffffff", textColor: "#1f2937", shadow: HAIRLINE },
        row(col(1, [logo(c)]), col(3, [menu(c, { align: "right", menuEffect: "underline" })])),
      ),
    ],
  },
  {
    id: "floating",
    kind: "header",
    labelKey: "chrome-preset-floating",
    build: (c) => [
      section(
        { textColor: "#1f2937" },
        row(
          col(1, [
            hbox(
              [
                logo(c),
                menu(c, { menuEffect: "pill" }),
                button(c.t("chrome-sample-start"), { hideMobile: "true" }),
              ],
              { bg: "#ffffff", radius: "full", shadow: "0|8|24|0|#000000|0.08", paddingTop: "0.6rem", paddingBottom: "0.6rem", paddingLeft: "1.5rem", paddingRight: "0.75rem" },
            ),
          ]),
        ),
      ),
    ],
  },
  {
    id: "dark-cta",
    kind: "header",
    labelKey: "chrome-preset-dark-cta",
    build: (c) => [
      section(
        { bg: DARK, textColor: "#ffffff" },
        row(
          col(1, [logo(c)]),
          col(3, [menu(c, { align: "center", menuEffect: "underline", color: "#d1d5db", hoverColor: "#ffffff", accentColor: "#ffffff", ...DARK_MENU })]),
          col(1, [button(c.t("chrome-sample-contact"), { variant: "outline", color: "#ffffff" })], { hideMobile: "true" }),
        ),
      ),
    ],
  },
  {
    id: "topbar",
    kind: "header",
    labelKey: "chrome-preset-topbar",
    build: (c) => [
      section(
        { bg: "#f3f4f6", textColor: "#374151", paddingY: "0.4rem", hideMobile: "true" },
        row(
          col(3, [hbox([iconText("map-pin", c.t("chrome-sample-address")), iconText("phone", "+60 0-000 0000")], { justifyContent: "flex-start" })]),
          col(1, [socials()]),
        ),
      ),
      section(
        { bg: "#ffffff", textColor: "#1f2937", shadow: HAIRLINE },
        row(
          col(1, [logo(c)]),
          col(3, [menu(c, { align: "right", menuEffect: "underline" })]),
          col(1, [button(c.t("chrome-sample-contact"))], { hideMobile: "true" }),
        ),
      ),
    ],
  },
  {
    id: "centered",
    kind: "header",
    labelKey: "chrome-preset-centered",
    build: (c) => [
      section({ bg: "#ffffff", textColor: "#1f2937", paddingY: "1.25rem" }, row(col(1, [logo(c, "center")]))),
      section(
        { bg: "#ffffff", textColor: "#1f2937", paddingY: "0", shadow: "0|-1|0|0|#000000|0.08" },
        row(col(1, [menu(c, { align: "center", menuEffect: "overline", textTransform: "uppercase", letterSpacing: "1", fontSize: "13", fontWeight: "600" })])),
      ),
    ],
  },
  {
    id: "dark-pill",
    kind: "header",
    labelKey: "chrome-preset-dark-pill",
    build: (c) => [
      section(
        { bg: DARK, textColor: "#ffffff" },
        row(
          col(1, [logo(c)]),
          col(3, [menu(c, { align: "center", menuEffect: "pill", gap: "0.25rem", color: "#9ca3af", hoverColor: "#ffffff", accentColor: "#374151", ...DARK_MENU })]),
          col(1, [socials()], { hideMobile: "true" }),
        ),
      ),
    ],
  },
  {
    id: "simple",
    kind: "footer",
    labelKey: "chrome-preset-footer-simple",
    build: (c) => [
      section(
        { bg: "#f9fafb", textColor: "#4b5563", paddingY: "2.5rem" },
        row(
          col(1, [
            logo(c, "center"),
            menu(c, { align: "center", fontSize: "14", hoverColor: "#111827" }),
            socials("center", "brand"),
            copyright(c, { align: "center" }),
          ]),
        ),
      ),
    ],
  },
  {
    id: "columns",
    kind: "footer",
    labelKey: "chrome-preset-footer-columns",
    build: (c) => [
      section(
        { bg: DARK, textColor: "#d1d5db", paddingY: "3rem" },
        row(
          col(1, [logo(c), text(c.t("chrome-sample-about")), socials("left", "outline")], { valign: "top" }),
          col(1, [el("heading", { text: c.t("chrome-sample-links"), level: "4", color: "#ffffff" }), menu(c, { layout: "vertical", fontSize: "14", hoverColor: "#ffffff" })], { valign: "top" }),
          col(
            1,
            [
              el("heading", { text: c.t("chrome-sample-contact"), level: "4", color: "#ffffff" }),
              iconText("map-pin", c.t("chrome-sample-address")),
              iconText("phone", "+60 0-000 0000"),
              iconText("mail", "info@contoh.my"),
            ],
            { valign: "top" },
          ),
          col(1, [el("heading", { text: c.t("chrome-sample-hours"), level: "4", color: "#ffffff" }), text(c.t("chrome-sample-hours-text"))], { valign: "top" }),
        ),
        row(col(1, [el("divider", {}), copyright(c, { align: "center" })])),
      ),
    ],
  },
  {
    id: "bar",
    kind: "footer",
    labelKey: "chrome-preset-footer-bar",
    build: (c) => [
      section({ bg: DARK, textColor: "#9ca3af", paddingY: "1.25rem" }, row(col(2, [copyright(c)]), col(1, [socials()]))),
    ],
  },
  {
    id: "contact",
    kind: "footer",
    labelKey: "chrome-preset-footer-contact",
    build: (c) => [
      section(
        { bg: "#ffffff", textColor: "#374151", paddingY: "2.5rem", shadow: "0|-1|0|0|#000000|0.08" },
        row(
          col(1, [logo(c), text(c.t("chrome-sample-about"))], { valign: "top" }),
          col(
            1,
            [
              el("heading", { text: c.t("chrome-sample-contact"), level: "4" }),
              iconText("map-pin", c.t("chrome-sample-address")),
              iconText("phone", "+60 0-000 0000"),
              iconText("mail", "info@contoh.my"),
            ],
            { valign: "top" },
          ),
          col(1, [el("heading", { text: c.t("chrome-sample-follow"), level: "4" }), socials("left", "brand")], { valign: "top" }),
        ),
        row(col(1, [copyright(c, { align: "center", size: "0.8rem" })])),
      ),
    ],
  },
];
