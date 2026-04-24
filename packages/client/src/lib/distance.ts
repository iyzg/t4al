// Chicago block ≈ 100 meters (1/8 mile grid).
const METERS_PER_BLOCK = 100;

export function metersToBlocks(meters: number): number {
  return meters / METERS_PER_BLOCK;
}

export function formatBlocks(meters: number): string {
  const blocks = metersToBlocks(meters);
  if (blocks < 1) {
    const rounded = Math.round(blocks * 10) / 10;
    return `${rounded} block${rounded === 1 ? '' : 's'}`;
  }
  const rounded = Math.round(blocks);
  return `${rounded} block${rounded === 1 ? '' : 's'}`;
}
