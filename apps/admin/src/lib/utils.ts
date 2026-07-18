import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Shared by App.tsx's page-create flow and Designer.tsx's slug-rename field
// — both need the exact same sanitizing rules so a slug typed in either
// place ends up looking the same.
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Björn Ottosson's OKLab reference conversion (the basis for CSS Color 4's
// oklch()) — used to turn daisyUI's theme tokens (shipped as oklch() in
// node_modules/daisyui/themes.css) into the #rrggbb strings <input
// type="color"> requires, and to derive the "Generate" random palette below
// from the same math instead of a second, ad-hoc color model.
function oklchToRgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  const rl = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gl = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(gamma(v) * 255)));
  return [clamp(rl), clamp(gl), clamp(bl)];
}

export function oklchToHex(l: number, c: number, hDeg: number): string {
  const [r, g, b] = oklchToRgb(l, c, hDeg);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
