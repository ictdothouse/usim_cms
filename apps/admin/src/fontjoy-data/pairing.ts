import vectors from "./vectors.json";

// A small, locally bundled subset of Fontjoy's 2017 regular-face vectors.
// Source and MIT notice: https://github.com/Jack000/fontjoy (LICENSE.txt).
// These vectors describe visual character, not accessibility. Body candidates
// are reviewed separately for long-form readability and every suggestion can
// still be edited by hand.
const headingFaces = [
  "Playfair Display", "Merriweather", "Lora", "Libre Baskerville",
  "Crimson Text", "Domine", "Bitter", "EB Garamond", "Vollkorn",
  "Montserrat", "Raleway", "Poppins", "Josefin Sans", "Rubik",
] as const;
const subheadingFaces = [
  "Montserrat", "Raleway", "Poppins", "Nunito", "Rubik", "Work Sans",
  "Quicksand", "Josefin Sans", "Karla", "Fira Sans", "Cabin", "Ubuntu",
  "Titillium Web", "Source Sans Pro",
] as const;
const readingFaces = [
  "Source Sans Pro", "Noto Sans", "Open Sans", "Roboto", "Lato",
  "PT Sans", "Karla", "Work Sans", "Fira Sans", "Ubuntu", "Cabin", "Hind",
] as const;

export type FontjoyPairing = { heading: string; subheading: string; body: string };

const fontVectors = vectors as Record<string, number[]>;
const similarityCache = new Map<string, number>();

function similarity(first: string, second: string): number {
  const key = [first, second].sort().join("|");
  const cached = similarityCache.get(key);
  if (cached !== undefined) return cached;
  const a = fontVectors[first];
  const b = fontVectors[second];
  // The included vectors have unit length, so their dot product is cosine
  // similarity. Higher means closer in visual character.
  const score = a.reduce((total, value, index) => total + value * b[index], 0);
  similarityCache.set(key, score);
  return score;
}

function matchingScore(pairing: FontjoyPairing): number {
  const titleBody = similarity(pairing.heading, pairing.body);
  const titleSubheading = similarity(pairing.heading, pairing.subheading);
  const subheadingBody = similarity(pairing.subheading, pairing.body);
  // A contrasting title and more closely related secondary/body faces create
  // hierarchy without making the three faces look unrelated. Targets were
  // calibrated against this licensed subset, not claimed as Fontjoy's exact
  // proprietary ranking algorithm.
  return Math.abs(titleBody - 0.08) * 1.2
    + Math.abs(titleSubheading - 0.12) * 0.8
    + Math.abs(subheadingBody - 0.58);
}

const rankedPairings: FontjoyPairing[] = headingFaces.flatMap((heading) =>
  subheadingFaces.flatMap((subheading) =>
    readingFaces
      .filter((body) => new Set([heading, subheading, body]).size === 3)
      .map((body) => ({ heading, subheading, body })),
  ),
).sort((a, b) => matchingScore(a) - matchingScore(b));

export function suggestFontjoyPairing(current: FontjoyPairing): FontjoyPairing {
  // Randomise within the strongest matches; exclude the current result so a
  // second click always offers a visibly different set.
  const candidates = rankedPairings.slice(0, 120).filter((pairing) =>
    pairing.heading !== current.heading ||
    pairing.subheading !== current.subheading ||
    pairing.body !== current.body,
  );
  return candidates[Math.floor(Math.random() * candidates.length)] ?? rankedPairings[0];
}
