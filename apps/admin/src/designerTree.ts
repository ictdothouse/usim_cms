import type { Block, SectionProps } from "./Designer";

export function moveSection(blocks: Block[], from: number, to: number): void {
  blocks.splice(to, 0, blocks.splice(from, 1)[0]);
}

export function moveColumn(blocks: Block[], b: number, r: number, from: number, to: number): void {
  const cols = (blocks[b].props as unknown as SectionProps).rows[r].columns;
  cols.splice(to, 0, cols.splice(from, 1)[0]);
}
