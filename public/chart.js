const GAP_BREAK_S = 30 * 60;

export function measurePoints(body) {
  const points = [];
  for (const group of body ?? []) {
    const beg = group.beg_time;
    const step = group.step_time;
    for (const [i, entry] of (group.value ?? []).entries()) {
      const v = Array.isArray(entry) ? entry[0] : entry;
      if (typeof v === 'number') points.push({ t: beg + i * step, v });
    }
  }
  return points;
}

export function heatingBands(body) {
  const bands = [];
  for (const group of body ?? []) {
    const beg = group.beg_time;
    const step = group.step_time;
    for (const [i, entry] of (group.value ?? []).entries()) {
      const v = Array.isArray(entry) ? entry[0] : entry;
      if (typeof v !== 'number' || v <= 0) continue;
      const from = beg + i * step;
      const to = from + step;
      const last = bands[bands.length - 1];
      if (last && last.to >= from) last.to = Math.max(last.to, to);
      else bands.push({ from, to });
    }
  }
  return bands;
}

function segments(points) {
  const segs = [];
  let current = [];
  for (const p of points) {
    if (current.length && p.t - current[current.length - 1].t > GAP_BREAK_S) {
      segs.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length) segs.push(current);
  return segs;
}

function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function timeLabel(t) {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();
const f = (n) => Math.round(n * 10) / 10;

export function chartSvg({ points = [], bands = [], from, to, width = 640, height = 240 } = {}) {
  if (!points.length) return '';

  const pad = { l: 38, r: 10, t: 12, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const span = to - from || 1;
  const x = (t) => pad.l + ((t - from) / span) * w;

  const values = points.map((p) => p.v);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  } else {
    const margin = (hi - lo) * 0.15;
    lo -= margin;
    hi += margin;
  }

  const yStep = niceStep(hi - lo, 4);
  const y0 = Math.floor(lo / yStep) * yStep;
  const y1 = Math.ceil(hi / yStep) * yStep;
  const y = (v) => pad.t + ((y1 - v) / (y1 - y0)) * h;

  const parts = [];

  for (const band of bands) {
    const bx1 = Math.max(pad.l, x(band.from));
    const bx2 = Math.min(width - pad.r, x(band.to));
    if (bx2 <= bx1) continue;
    parts.push(
      `<rect x="${f(bx1)}" y="${pad.t}" width="${f(bx2 - bx1)}" height="${h}" fill="rgba(243,111,33,0.13)"/>`
    );
  }

  for (let v = y0; v <= y1 + 1e-9; v += yStep) {
    const gy = y(v);
    parts.push(
      `<line x1="${pad.l}" y1="${f(gy)}" x2="${width - pad.r}" y2="${f(gy)}" stroke="#262b34" stroke-width="1"/>`,
      `<text x="${pad.l - 6}" y="${f(gy)}" fill="#9aa3b0" font-size="11" text-anchor="end" dominant-baseline="middle">${fmt(v)}</text>`
    );
  }

  const firstHour = new Date(from * 1000);
  firstHour.setMinutes(0, 0, 0);
  let tick = firstHour.getTime() / 1000;
  if (tick < from) tick += 3600;
  for (; tick <= to; tick += 3 * 3600) {
    parts.push(
      `<text x="${f(x(tick))}" y="${height - 8}" fill="#9aa3b0" font-size="11" text-anchor="middle">${timeLabel(tick)}</text>`
    );
  }

  for (const seg of segments(points)) {
    const inside = seg.filter((p) => p.t >= from && p.t <= to);
    if (inside.length < 2) continue;
    const coords = inside.map((p) => `${f(x(p.t))},${f(y(p.v))}`);
    const base = f(y(y0));
    parts.push(
      `<path d="M ${f(x(inside[0].t))},${base} L ${coords.join(' L ')} L ${f(x(inside[inside.length - 1].t))},${base} Z" fill="rgba(243,111,33,0.10)"/>`,
      `<polyline points="${coords.join(' ')}" fill="none" stroke="#f36f21" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    );
    const last = inside[inside.length - 1];
    parts.push(`<circle cx="${f(x(last.t))}" cy="${f(y(last.v))}" r="3" fill="#f36f21"/>`);
  }

  return (
    `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="100%" ` +
    `role="img" aria-label="Teplota za posledních 24 hodin">${parts.join('')}</svg>`
  );
}
