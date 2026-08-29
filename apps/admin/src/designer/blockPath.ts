import type { Block, El, SectionProps } from "./types";

export function section(bs: Block[], b: number): SectionProps {
  return bs[b].props as unknown as SectionProps;
}

export function removeAt(bs: Block[], path: number[]): El {
  const [b, r, c, e] = path;
  return section(bs, b).rows[r].columns[c].elements.splice(e, 1)[0];
}

export function insertEl(bs: Block[], colPath: number[], el: El, index?: number) {
  const [b, r, c] = colPath;
  const list = section(bs, b).rows[r].columns[c].elements;
  list.splice(index ?? list.length, 0, el);
}
