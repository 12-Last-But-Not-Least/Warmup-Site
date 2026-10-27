// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawScatter } from '../src/chart.js';

let container;
let resizeCallbacks;

beforeEach(() => {
  resizeCallbacks = [];
  globalThis.ResizeObserver = class {
    constructor(cb) { resizeCallbacks.push(cb); }
    observe() {}
    disconnect() {}
  };
  SVGElement.prototype.setPointerCapture = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  container.remove();
  vi.restoreAllMocks();
});

const base = { title: 'T', xLabel: 'X axis', yLabel: 'Y axis' };
const pt = (x, y, group) => ({ x, y, group });
const svgOf = () => container.querySelector('svg[role="img"]');
const points = () => [...container.querySelectorAll('path.point')].filter(p => p.closest('svg[role="img"]'));
const text = el => el.textContent;

/** Pixel position of a rendered point (jsdom's getBoundingClientRect is all zeros, so client = local). */
function posOf(el) {
  const [, px, py] = el.getAttribute('transform').match(/translate\(([-\d.e]+),([-\d.e]+)\)/);
  return { clientX: Number(px), clientY: Number(py) };
}

const fire = (target, type, init = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('drawScatter: structure', () => {
  it('renders a title and an empty message when there is nothing to plot', () => {
    drawScatter(container, { ...base, points: [] });
    expect(container.querySelector('h2').textContent).toBe('T');
    expect(container.querySelector('.scatter-empty').textContent).toBe('No data to plot.');
    expect(svgOf()).toBeNull();
  });

  it('ignores points with non-finite coordinates', () => {
    drawScatter(container, { ...base, points: [pt(NaN, 1), pt(1, Infinity)] });
    expect(container.querySelector('.scatter-empty')).not.toBeNull();
    drawScatter(container, { ...base, points: [pt(NaN, 1), pt(1, 2)] });
    expect(points()).toHaveLength(1);
  });

  it('replaces previous contents when redrawn', () => {
    drawScatter(container, { ...base, points: [pt(1, 1)] });
    drawScatter(container, { ...base, points: [pt(1, 1), pt(2, 2)] });
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(points()).toHaveLength(2);
  });

  it('labels the svg and axes', () => {
    drawScatter(container, { ...base, points: [pt(1, 1), pt(2, 3)] });
    expect(svgOf().getAttribute('aria-label')).toBe('T: Y axis against X axis');
    const titles = [...container.querySelectorAll('.axis-title')].map(text);
    expect(titles).toEqual(['X axis', 'Y axis']);
  });

  it('omits axis titles that are empty', () => {
    drawScatter(container, { title: 'T', xLabel: '', yLabel: '', points: [pt(1, 1)] });
    expect(container.querySelectorAll('.axis-title')).toHaveLength(0);
  });

  it('gives each chart on a page its own clip path id', () => {
    const other = document.createElement('div');
    document.body.append(other);
    drawScatter(container, { ...base, points: [pt(1, 1)] });
    drawScatter(other, { ...base, points: [pt(1, 1)] });
    const id = el => el.querySelector('clipPath').id;
    expect(id(container)).not.toBe(id(other));
    other.remove();
  });

  it('uses categorical tick labels when provided', () => {
    drawScatter(container, { ...base, points: [pt(0, 1), pt(2, 3)], xTickLabels: { 0: 'Mon', 1: 'Tue', 2: 'Wed' } });
    const ticks = [...container.querySelectorAll('.tick-label')].map(text);
    expect(ticks).toEqual(expect.arrayContaining(['Mon', 'Tue', 'Wed']));
  });
});

describe('drawScatter: groups and legend', () => {
  it('has no legend buttons or Group column without groups', () => {
    drawScatter(container, { ...base, points: [pt(1, 1), pt(2, 2)] });
    expect(container.querySelectorAll('.legend-item')).toHaveLength(0);
    expect([...container.querySelectorAll('th')].map(text)).toEqual(['X axis', 'Y axis']);
  });

  it('makes a legend button per group, sorted by name', () => {
    drawScatter(container, { ...base, points: [pt(1, 1, 'Zed'), pt(2, 2, 'Amy')] });
    expect([...container.querySelectorAll('.legend-item')].map(text)).toEqual(['Amy', 'Zed']);
    expect([...container.querySelectorAll('th')].map(text)).toEqual(['Group', 'X axis', 'Y axis']);
  });

  it('assigns colors by sorted group, independent of input order', () => {
    drawScatter(container, { ...base, points: [pt(1, 1, 'B'), pt(2, 2, 'A')] });
    const fills = points().map(p => p.getAttribute('fill'));
    expect(fills).toEqual(['var(--series-2)', 'var(--series-1)']);
  });

  it('toggles a group off and on from the legend', () => {
    drawScatter(container, { ...base, points: [pt(1, 1, 'A'), pt(2, 2, 'B')] });
    const [a] = container.querySelectorAll('.legend-item');
    a.click();
    expect(a.getAttribute('aria-pressed')).toBe('false');
    expect(points()).toHaveLength(1);
    a.click();
    expect(a.getAttribute('aria-pressed')).toBe('true');
    expect(points()).toHaveLength(2);
  });

  it('dims other groups while a legend item is hovered or focused', () => {
    drawScatter(container, { ...base, points: [pt(1, 1, 'A'), pt(2, 2, 'B')] });
    const [a] = container.querySelectorAll('.legend-item');
    fire(a, 'mouseenter');
    expect(points().map(p => p.classList.contains('dimmed'))).toEqual([false, true]);
    fire(a, 'mouseleave');
    expect(points().some(p => p.classList.contains('dimmed'))).toBe(false);
    a.dispatchEvent(new FocusEvent('focus'));
    expect(points()[1].classList.contains('dimmed')).toBe(true);
    a.dispatchEvent(new FocusEvent('blur'));
    expect(points()[1].classList.contains('dimmed')).toBe(false);
  });

  it('labels an empty group name "(no group)" when other groups exist', () => {
    drawScatter(container, { ...base, points: [pt(1, 1, ''), pt(2, 2, 'A')] });
    expect([...container.querySelectorAll('.legend-item')].map(text)).toContain('(no group)');
  });

  it('falls back to the "other" color beyond eight groups', () => {
    const many = Array.from({ length: 10 }, (_, i) => pt(i, i, `g${i}`));
    drawScatter(container, { ...base, points: many });
    const fills = points().map(p => p.getAttribute('fill'));
    expect(fills[7]).toBe('var(--series-8)');
    expect(fills[8]).toBe('var(--series-other)');
    expect(fills[9]).toBe('var(--series-other)');
  });
});

describe('drawScatter: lines, trend, means', () => {
  it('draws one line per group with at least two points when connecting', () => {
    drawScatter(container, {
      ...base, connectGroups: true,
      points: [pt(0, 1, 'A'), pt(1, 2, 'A'), pt(0, 5, 'B')],
    });
    expect(container.querySelectorAll('path.series-line')).toHaveLength(1);
  });

  it('draws no lines unless connectGroups is set', () => {
    drawScatter(container, { ...base, points: [pt(0, 1, 'A'), pt(1, 2, 'A')] });
    expect(container.querySelectorAll('path.series-line')).toHaveLength(0);
  });

  it('ignores jitter when connecting groups and applies it otherwise', () => {
    const pts = [pt(1, 1), pt(1, 2), pt(1, 3)];
    drawScatter(container, { ...base, points: pts, connectGroups: true, jitter: 0.4 });
    const xs = points().map(p => posOf(p).clientX);
    expect(new Set(xs).size).toBe(1);
    drawScatter(container, { ...base, points: pts, jitter: 0.4 });
    expect(new Set(points().map(p => posOf(p).clientX)).size).toBeGreaterThan(1);
  });

  it('shows a trend line and correlation when requested', () => {
    drawScatter(container, { ...base, showTrend: true, points: [pt(1, 1), pt(2, 2), pt(3, 3)] });
    expect(svgOf().querySelector('line.trend')).not.toBeNull();
    expect(container.querySelector('.corner-label').textContent).toBe('r = 1.00  (n = 3)');
  });

  it('shows a dash for r when it is undefined', () => {
    drawScatter(container, { ...base, showTrend: true, points: [pt(1, 1), pt(2, 1)] });
    expect(container.querySelector('.corner-label').textContent).toBe('r = —  (n = 2)');
  });

  it('omits the trend line when x has no variance', () => {
    drawScatter(container, { ...base, showTrend: true, points: [pt(1, 1), pt(1, 2)] });
    expect(svgOf().querySelector('line.trend')).toBeNull();
  });

  it('omits trend with a single visible point', () => {
    drawScatter(container, { ...base, showTrend: true, points: [pt(1, 1)] });
    expect(container.querySelector('.corner-label')).toBeNull();
  });

  it('draws a mean bar per distinct x', () => {
    drawScatter(container, { ...base, showMeans: true, points: [pt(0, 1), pt(0, 3), pt(1, 5)] });
    expect(svgOf().querySelectorAll('line.mean')).toHaveLength(2);
    expect(container.querySelector('.legend-key')).not.toBeNull();
  });
});

describe('drawScatter: tooltip', () => {
  it('shows the nearest point and hides when far away', () => {
    drawScatter(container, { ...base, points: [pt(1, 10, 'Ana'), pt(2, 20, 'Ben')] });
    const tip = container.querySelector('.scatter-tooltip');
    expect(tip.hidden).toBe(true);
    const pos = posOf(points()[0]);
    fire(svgOf(), 'pointermove', pos);
    expect(tip.hidden).toBe(false);
    expect(tip.querySelector('.tt-heading').textContent).toBe('Ana');
    expect([...tip.querySelectorAll('.tt-key')].map(text)).toEqual(['X axis', 'Y axis']);
    expect([...tip.querySelectorAll('.tt-value')].map(text)).toEqual(['1', '10']);
    fire(svgOf(), 'pointermove', { clientX: pos.clientX + 200, clientY: pos.clientY + 200 });
    expect(tip.hidden).toBe(true);
    fire(svgOf(), 'pointermove', pos);
    fire(svgOf(), 'pointerleave');
    expect(tip.hidden).toBe(true);
  });

  it('has no heading for ungrouped points and uses tick labels for x', () => {
    drawScatter(container, { ...base, points: [pt(0, 10)], xTickLabels: { 0: 'Mon' } });
    fire(svgOf(), 'pointermove', posOf(points()[0]));
    const tip = container.querySelector('.scatter-tooltip');
    expect(tip.querySelector('.tt-heading')).toBeNull();
    expect(tip.querySelector('.tt-value').textContent).toBe('Mon');
  });

  it('describes a mean bar', () => {
    drawScatter(container, { ...base, showMeans: true, points: [pt(0, 2), pt(0, 4)] });
    const mean = svgOf().querySelector('line.mean');
    fire(svgOf(), 'pointermove', {
      clientX: (Number(mean.getAttribute('x1')) + Number(mean.getAttribute('x2'))) / 2,
      clientY: Number(mean.getAttribute('y1')) + 3,
    });
    const tip = container.querySelector('.scatter-tooltip');
    expect(tip.querySelector('.tt-heading').textContent).toBe('Mean');
    expect([...tip.querySelectorAll('.tt-key')].map(text)).toEqual(['X axis', 'Y axis', 'n']);
    expect([...tip.querySelectorAll('.tt-value')].map(text).pop()).toBe('2');
  });

  it('flips the tooltip to the left near the right edge', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    drawScatter(container, { ...base, points: [pt(0, 0), pt(10, 10)] });
    const last = points()[1];
    const pos = posOf(last);
    fire(svgOf(), 'pointermove', pos);
    const left = parseFloat(container.querySelector('.scatter-tooltip').style.left);
    expect(left).toBe(pos.clientX - 16 - 100);
  });

  it('shows "(no group)" for ungrouped points mixed with groups', () => {
    drawScatter(container, { ...base, points: [pt(1, 1, ''), pt(5, 5, 'A')] });
    fire(svgOf(), 'pointermove', posOf(points()[0]));
    expect(container.querySelector('.tt-heading').textContent).toBe('(no group)');
  });
});

describe('drawScatter: pan and zoom', () => {
  const pts = [pt(0, 0), pt(10, 10)];
  const firstX = () => posOf(points()[0]).clientX;
  const spread = () => posOf(points()[1]).clientX - firstX();
  const zoom = (deltaY, key = 'ctrlKey') => svgOf().dispatchEvent(
    new WheelEvent('wheel', { deltaY, [key]: true, clientX: 300, clientY: 150, bubbles: true, cancelable: true }));

  it('pans while dragging and stops after release', () => {
    drawScatter(container, { ...base, points: pts });
    const before = firstX();
    fire(svgOf(), 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    expect(SVGElement.prototype.setPointerCapture).toHaveBeenCalled();
    expect(svgOf().classList.contains('dragging')).toBe(true);
    fire(svgOf(), 'pointermove', { clientX: 150, clientY: 100 });
    expect(firstX()).toBeCloseTo(before + 50);
    fire(svgOf(), 'pointerup');
    expect(svgOf().classList.contains('dragging')).toBe(false);
    fire(svgOf(), 'pointermove', { clientX: 300, clientY: 100 });
    expect(firstX()).toBeCloseTo(before + 50);
  });

  it('ignores non-primary buttons', () => {
    drawScatter(container, { ...base, points: pts });
    const before = firstX();
    fire(svgOf(), 'pointerdown', { button: 2, clientX: 100, clientY: 100 });
    fire(svgOf(), 'pointermove', { clientX: 150, clientY: 100 });
    expect(firstX()).toBe(before);
  });

  it('cancels a drag on pointercancel', () => {
    drawScatter(container, { ...base, points: pts });
    fire(svgOf(), 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    fire(svgOf(), 'pointercancel');
    expect(svgOf().classList.contains('dragging')).toBe(false);
  });

  it('ignores the wheel without Ctrl or Meta', () => {
    drawScatter(container, { ...base, points: pts });
    const before = firstX();
    const e = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    svgOf().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(firstX()).toBe(before);
  });

  it('zooms in about the cursor with Ctrl and with Meta', () => {
    drawScatter(container, { ...base, points: pts });
    const before = spread();
    expect(zoom(-100)).toBe(false); // preventDefault was called
    const afterCtrl = spread();
    expect(afterCtrl).toBeGreaterThan(before);
    zoom(-100, 'metaKey');
    expect(spread()).toBeGreaterThan(afterCtrl);
  });

  it('refuses to zoom beyond the limits', () => {
    drawScatter(container, { ...base, points: pts });
    for (let i = 0; i < 20; i++) zoom(-300); // far past 50x in
    const zoomedIn = spread();
    zoom(-300);
    expect(spread()).toBe(zoomedIn);
    for (let i = 0; i < 20; i++) zoom(300); // far past 10x out
    const zoomedOut = spread();
    zoom(300);
    expect(spread()).toBe(zoomedOut);
  });

  it('resets the view with the button and with a double click', () => {
    drawScatter(container, { ...base, points: pts });
    const home = firstX();
    fire(svgOf(), 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    fire(svgOf(), 'pointermove', { clientX: 200, clientY: 100 });
    fire(svgOf(), 'pointerup');
    expect(firstX()).not.toBeCloseTo(home);
    container.querySelector('.scatter-reset').click();
    expect(firstX()).toBeCloseTo(home);
    fire(svgOf(), 'pointerdown', { button: 0, clientX: 100, clientY: 100 });
    fire(svgOf(), 'pointermove', { clientX: 200, clientY: 100 });
    fire(svgOf(), 'pointerup');
    fire(svgOf(), 'dblclick');
    expect(firstX()).toBeCloseTo(home);
  });
});

describe('drawScatter: resize and table', () => {
  it('re-renders when the plot width changes, but not otherwise', () => {
    drawScatter(container, { ...base, points: [pt(0, 0), pt(1, 1)] });
    expect(svgOf().getAttribute('width')).toBe('640');
    const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
    resizeCallbacks[0]();
    expect(svgOf().getAttribute('width')).toBe('500');
    const first = points()[0];
    resizeCallbacks[0]();
    expect(points()[0]).toBe(first); // same width: no re-render
    spy.mockReturnValue(100);
    resizeCallbacks[0]();
    expect(svgOf().getAttribute('width')).toBe('320'); // clamped to the minimum
  });

  it('lists data sorted by group then x', () => {
    drawScatter(container, { ...base, points: [pt(2, 20, 'B'), pt(2, 21, 'A'), pt(1, 11, 'A')] });
    const rows = [...container.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(text));
    expect(rows).toEqual([['A', '1', '11'], ['A', '2', '21'], ['B', '2', '20']]);
  });

  it('uses tick labels in the table', () => {
    drawScatter(container, { ...base, points: [pt(0, 5)], xTickLabels: { 0: 'Mon' } });
    expect([...container.querySelectorAll('tbody td')].map(text)).toEqual(['Mon', '5']);
  });

  it('falls back to X and Y table headings for empty labels', () => {
    drawScatter(container, { title: 'T', xLabel: '', yLabel: '', points: [pt(1, 1)] });
    expect([...container.querySelectorAll('th')].map(text)).toEqual(['X', 'Y']);
  });
});

describe('drawScatter: untrusted text', () => {
  it('never turns group names or titles into markup', () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    drawScatter(container, { title: evil, xLabel: evil, yLabel: evil, points: [pt(1, 1, evil), pt(2, 2, 'ok')] });
    fire(svgOf(), 'pointermove', posOf(points()[0]));
    expect(container.querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(container.querySelector('h2').textContent).toBe(evil);
    expect(container.querySelector('.tt-heading').textContent).toBe(evil);
  });
});
