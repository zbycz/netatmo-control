import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chartWindow, renderTemperatureChart } from '../public/chart.js';

// Minimal SVG stand-in: chart.js only needs createElementNS/setAttribute/appendChild.
function svgNode(name) {
  return {
    name,
    attrs: {},
    children: [],
    textContent: '',
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}
globalThis.document = { createElementNS: (_ns, name) => svgNode(name) };

const HOUR_MS = 3600_000;
const NOW = 1_800_000_000_000;

const series = (hoursBack, stepMin) => {
  const points = [];
  for (let i = hoursBack * 60; i >= 0; i -= stepMin) {
    points.push({ time: NOW - i * 60_000, temp: 20, setpoint: 18 });
  }
  return points;
};

const flatten = (node) => [node, ...node.children.flatMap(flatten)];

const linePoints = (svg) => {
  const line = flatten(svg).find((n) => n.attrs.class === 'chart-line');
  return (line.attrs.d.match(/[ML]/g) ?? []).length;
};

const texts = (svg) =>
  flatten(svg)
    .filter((n) => n.name === 'text')
    .map((n) => n.textContent);

describe('chartWindow', () => {
  it('spans the requested hours back from now', () => {
    const { from, to, ticks } = chartWindow(6, NOW);
    assert.equal(to, NOW);
    assert.equal(from, NOW - 6 * HOUR_MS);
    assert.deepEqual(ticks.map(([time]) => time), [NOW - 6 * HOUR_MS, NOW - 3 * HOUR_MS, NOW]);
  });

  it('labels the axis with window start, midpoint and now', () => {
    assert.deepEqual(chartWindow(6, NOW).ticks.map(([, label]) => label), ['-6 h', '-3 h', 'now']);
    assert.deepEqual(chartWindow(24, NOW).ticks.map(([, label]) => label), ['-24 h', '-12 h', 'now']);
  });
});

describe('renderTemperatureChart', () => {
  it('shows only the last 6 hours by default', () => {
    assert.equal(linePoints(renderTemperatureChart(series(12, 30), [], NOW)), 13);
  });

  it('shows the whole day when asked for 24 hours', () => {
    assert.equal(linePoints(renderTemperatureChart(series(24, 30), [], NOW, 24)), 49);
  });

  it('labels the x axis for the chosen window', () => {
    const sixHours = texts(renderTemperatureChart(series(12, 30), [], NOW));
    const day = texts(renderTemperatureChart(series(24, 30), [], NOW, 24));
    assert.deepEqual(sixHours.slice(-3), ['-6 h', '-3 h', 'now']);
    assert.deepEqual(day.slice(-3), ['-24 h', '-12 h', 'now']);
  });
});
