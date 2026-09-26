import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chartSvg, heatingBands, measurePoints } from '../public/chart.js';

describe('measurePoints', () => {
  it('flattens Netatmo measure groups into timestamped points', () => {
    const body = [
      { beg_time: 1000, step_time: 600, value: [[20.5], [20.7], [21]] },
      { beg_time: 2800, step_time: 600, value: [[21.1]] },
    ];
    assert.deepEqual(measurePoints(body), [
      { t: 1000, v: 20.5 },
      { t: 1600, v: 20.7 },
      { t: 2200, v: 21 },
      { t: 2800, v: 21.1 },
    ]);
  });

  it('skips missing samples', () => {
    const body = [{ beg_time: 1000, step_time: 600, value: [[20.5], [null], [21]] }];
    assert.deepEqual(measurePoints(body), [
      { t: 1000, v: 20.5 },
      { t: 2200, v: 21 },
    ]);
    assert.deepEqual(measurePoints([]), []);
  });
});

describe('heatingBands', () => {
  it('keeps only buckets with heating and merges adjacent ones', () => {
    const body = [
      {
        beg_time: 1000,
        step_time: 1800,
        value: [[0], [333], [120], [0], [60]],
      },
    ];
    assert.deepEqual(heatingBands(body), [
      { from: 2800, to: 6400 },
      { from: 8200, to: 10000 },
    ]);
  });

  it('merges contiguous buckets across groups', () => {
    const body = [
      { beg_time: 1000, step_time: 1800, value: [[10]] },
      { beg_time: 2800, step_time: 1800, value: [[10]] },
    ];
    assert.deepEqual(heatingBands(body), [{ from: 1000, to: 4600 }]);
    assert.deepEqual(heatingBands([]), []);
  });
});

describe('chartSvg', () => {
  const from = 1000;
  const to = 1000 + 24 * 3600;
  const points = [
    { t: from, v: 20 },
    { t: from + 600, v: 21 },
    { t: from + 1200, v: 22 },
    { t: to, v: 21 },
  ];

  it('renders the temperature line and heating bands', () => {
    const svg = chartSvg({ points, bands: [{ from: from + 300, to: from + 900 }], from, to });
    assert.match(svg, /^<svg /);
    assert.match(svg, /polyline/);
    assert.match(svg, /rgba\(243,111,33,0\.13\)/);
    assert.match(svg, /<\/svg>$/);
  });

  it('returns empty string without points', () => {
    assert.equal(chartSvg({ points: [], bands: [], from, to }), '');
    assert.equal(chartSvg({ from, to }), '');
  });

  it('breaks the line across data gaps', () => {
    const gapped = [
      { t: from, v: 20 },
      { t: from + 600, v: 20.5 },
      { t: from + 20 * 3600, v: 22 },
      { t: from + 20 * 3600 + 600, v: 22.5 },
    ];
    const svg = chartSvg({ points: gapped, from, to });
    const polylines = svg.match(/<polyline/g) ?? [];
    assert.equal(polylines.length, 2);
  });
});
