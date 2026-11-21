export const modelKey = name => String(name ?? '').normalize('NFKC').toLocaleLowerCase().trim().replace(/\bsigenstore(?=\s)/g, 'sigenstor')
    .replace(/\s*(?:\(\s*new\s*\)|สินค้าโปรโมชั่น)\s*$/i, '')
    .replace(/\s+/g, ' ').trim();

export function buildModelSegments(reportProductSegments) {
  const modelSegments = new Map();
  for (const [main, group, model] of reportProductSegments) {
    const key = modelKey(model);
    const earlier = modelSegments.get(key);
    modelSegments.set(key, earlier === undefined ? {main, group} :
      earlier?.main === main && earlier?.group === group ? earlier : null);
  }
  return modelSegments;
}
