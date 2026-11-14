export interface MasonryPosition {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface MasonryLayout {
  positions: MasonryPosition[];
  height: number;
}
export const sameMasonryPrefix = (previous: readonly string[], current: readonly string[]) =>
  previous.length <= current.length && previous.every((value, index) => value === current[index]);
export const orderMeasuredCards = (nodeIds: readonly string[], rectangles: unknown): unknown[] | null => {
  if (new Set(nodeIds).size !== nodeIds.length || !Array.isArray(rectangles)
    || rectangles.length !== nodeIds.length) return null;
  const byId = new Map<string, unknown>();
  for (const rectangle of rectangles) {
    if (!rectangle || typeof rectangle !== 'object' || !('id' in rectangle)
      || typeof rectangle.id !== 'string' || byId.has(rectangle.id)) return null;
    byId.set(rectangle.id, rectangle);
  }
  if (nodeIds.some(id => !byId.has(id))) return null;
  return nodeIds.map(id => byId.get(id));
};
export const layoutMeasuredCards = (
  ids: readonly string[], containerWidth: unknown, rectangles: unknown,
): MasonryLayout | null => {
  if (!ids.length) return { positions: [], height: 0 };
  if (new Set(ids).size !== ids.length || typeof containerWidth !== 'number'
    || !Number.isFinite(containerWidth) || containerWidth <= 0
    || !Array.isArray(rectangles) || rectangles.length !== ids.length) return null;
  const sizes: { width: number; height: number }[] = [];
  for (const rectangle of rectangles) {
    if (typeof rectangle !== 'object' || rectangle === null) return null;
    const { width, height } = rectangle as Record<string, unknown>;
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width)
      || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    sizes.push({ width, height });
  }
  const cardWidth = sizes[0].width;
  const gap = containerWidth - cardWidth * 2;
  if (gap < -0.5 || sizes.some(size => Math.abs(size.width - cardWidth) > 0.5)) return null;
  const spacing = Math.max(0, gap);
  const columns = [0, 0];
  const positions = sizes.map((size, index) => {
    const column = columns[0] <= columns[1] ? 0 : 1;
    const position = { id: ids[index], left: column * (cardWidth + spacing),
      top: columns[column], width: size.width, height: size.height };
    columns[column] += size.height + spacing;
    return position;
  });
  const height = Math.max(...columns) - spacing;
  return Number.isFinite(height) ? { positions, height } : null;
};
