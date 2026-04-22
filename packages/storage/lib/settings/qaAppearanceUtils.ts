const HEX = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export function normalizeHexColor(input: string): string {
  const t = input.trim();
  if (!t) return '';
  const m = HEX.exec(t);
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) {
    h = h
      .split('')
      .map(c => c + c)
      .join('');
  }
  return `#${h.toLowerCase()}`;
}

export function sanitizeQaFontFamily(input: string): string {
  return input
    .slice(0, 200)
    .replace(/[\n\r<>{}]/g, '')
    .trim();
}

export function clampOptionalFontSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(max, Math.max(min, Math.round(value)));
}
