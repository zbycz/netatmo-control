const SVG_NS = 'http://www.w3.org/2000/svg';

const W = 320;
const H = 140;
const PAD = { top: 12, right: 8, bottom: 18, left: 30 };

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Renders the last 24 h of room temperature with heating periods
 * highlighted under the curve. Returns an <svg> node.
 *
 * points: [{ time: ms, temp: °C, setpoint: °C }]
 * heating: [{ start: ms, end: ms }]
 */
export function renderTemperatureChart(points, heating = [], now = Date.now()) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });

  const clean = points.filter((p) => typeof p.temp === 'number');
  if (clean.length < 2) {
    svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' }))
      .textContent = 'Bez dat';
    return svg;
  }

  const t0 = now - 24 * 3600_000;
  const temps = clean.flatMap((p) => [p.temp, p.setpoint].filter((v) => typeof v === 'number'));
  const min = Math.floor(Math.min(...temps) - 0.5);
  const max = Math.max(Math.ceil(Math.max(...temps) + 0.5), min + 2);

  const x = (time) => PAD.left + ((time - t0) / (now - t0)) * innerW;
  const y = (temp) => PAD.top + (1 - (temp - min) / (max - min)) * innerH;

  // Heating bands along the bottom edge
  heating.forEach(({ start, end }) => {
    const from = Math.max(start, t0);
    const to = Math.min(end, now);
    const width = Math.max(x(to) - x(from), 3);
    if (to < from) return;
    svg.appendChild(
      el('rect', {
        x: x(from).toFixed(1),
        y: (PAD.top + innerH - 4).toFixed(1),
        width: width.toFixed(1),
        height: 4,
        class: 'chart-band',
      })
    );
  });

  // Setpoint (program) steps — horizontal segments, no interpolation
  const setpoints = clean.filter((p) => typeof p.setpoint === 'number');
  if (setpoints.length > 1) {
    let d = `M${x(setpoints[0].time).toFixed(1)},${y(setpoints[0].setpoint).toFixed(1)}`;
    for (let i = 1; i < setpoints.length; i++) {
      const px = x(setpoints[i - 1].time).toFixed(1);
      const nx = x(setpoints[i].time).toFixed(1);
      const ny = y(setpoints[i].setpoint).toFixed(1);
      d += `L${nx},${y(setpoints[i - 1].setpoint).toFixed(1)}L${nx},${ny}`;
    }
    svg.appendChild(el('path', { d, class: 'chart-setpoint' }));
  }

  // Temperature line
  svg.appendChild(
    el('path', {
      d: clean.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.temp).toFixed(1)}`).join(''),
      class: 'chart-line',
    })
  );

  // Current temperature dot
  const last = clean[clean.length - 1];
  svg.appendChild(el('circle', { cx: x(last.time).toFixed(1), cy: y(last.temp).toFixed(1), r: 3, class: 'chart-dot' }));

  // Y axis labels (min / max)
  [max, min].forEach((t) => {
    const label = el('text', { x: PAD.left - 5, y: y(t) + 3.5, 'text-anchor': 'end', class: 'chart-label' });
    label.textContent = `${t}°`;
    svg.appendChild(label);
  });

  // X axis labels: -24 h, -12 h, now
  [
    [t0, '-24 h'],
    [t0 + 12 * 3600_000, '-12 h'],
    [now, 'now'],
  ].forEach(([time, label]) => {
    const node = el('text', { x: x(time).toFixed(1), y: H - 4, 'text-anchor': 'middle', class: 'chart-label' });
    node.textContent = label;
    svg.appendChild(node);
  });

  return svg;
}

export function formatChartHint() {
  return `Čára: teplota · Schodová: program · Oranžové: topení (${fmtTime(Date.now())})`;
}
