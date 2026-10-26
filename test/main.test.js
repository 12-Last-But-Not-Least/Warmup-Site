// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve('index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

const csvA = 'Steps,Mon,Tue\nAna,10,20\nBen,30,40\n';
const csvB = 'Sleep,Mon,Tue\nAna,7,8\nBen,6,5\n';

const $ = id => document.getElementById(id);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function loadMain() {
  vi.resetModules();
  await import('../src/main.js');
}

// jsdom's File has no text(), which main.js uses to read uploads.
const fakeFile = (name, content) => ({ name, text: async () => content });

function pickFile(input, name, content) {
  const file = fakeFile(name, content);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  document.body.innerHTML = body;
  globalThis.ResizeObserver = class { observe() {} };
  SVGElement.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('main.js', () => {
  it('fails loudly when index.html is missing an expected element', async () => {
    $('status').remove();
    await expect(loadMain()).rejects.toThrow('Missing #status in index.html');
  });

  it('asks for the other file when only one is chosen', async () => {
    await loadMain();
    pickFile($('file-a'), 'a.csv', csvA);
    await settle();
    expect($('status').textContent).toBe('Now pick the other file to see the charts.');
    expect($('charts').hidden).toBe(true);
  });

  it('hides earlier charts and messages when a file is cleared', async () => {
    await loadMain();
    pickFile($('file-a'), 'a.csv', csvA);
    pickFile($('file-b'), 'b.csv', csvB);
    await settle();
    expect($('charts').hidden).toBe(false);
    Object.defineProperty($('file-b'), 'files', { value: [], configurable: true });
    $('file-b').dispatchEvent(new Event('change'));
    await settle();
    expect($('charts').hidden).toBe(true);
    expect($('warnings').hidden).toBe(true);
  });

  it('draws three charts once both files are chosen', async () => {
    await loadMain();
    pickFile($('file-a'), 'a.csv', csvA);
    await settle();
    pickFile($('file-b'), 'b.csv', csvB);
    await settle();
    expect($('charts').hidden).toBe(false);
    for (const id of ['chart-a', 'chart-b', 'chart-scatter']) {
      expect($(id).querySelector('svg[role="img"]')).not.toBeNull();
    }
    expect($('chart-scatter').querySelector('h2').textContent).toBe('Steps vs. Sleep');
    expect($('status').textContent).toBe('Showing a.csv and b.csv: 2 groups, 4 matched pairs on the scatter plot.');
    expect($('warnings').hidden).toBe(true);
  });

  it('prefixes errors with the file name and hides charts when a file fails validation', async () => {
    await loadMain();
    pickFile($('file-a'), 'a.csv', csvA);
    pickFile($('file-b'), 'bad.csv', '');
    await settle();
    expect($('charts').hidden).toBe(true);
    expect($('status').textContent).toBe(
      'One of the files failed validation or has no usable data. See the messages below.');
    expect($('warnings').hidden).toBe(false);
    expect($('warnings').textContent).toBe('bad.csv: Error: CSV input must be nonempty text');
  });

  it('prefixes warnings with the file name but still draws the charts', async () => {
    await loadMain();
    pickFile($('file-a'), 'a.csv', 'Steps,Mon,Tue\nAna,10,\nBen,30,40');
    pickFile($('file-b'), 'b.csv', csvB);
    await settle();
    expect($('charts').hidden).toBe(false);
    expect($('warnings').textContent).toBe('a.csv: CSV record 2, column 3 ("Tue") skipped: value is blank');
  });

  it('explains an empty scatter plot when the files share no person or category', async () => {
    await loadMain();
    pickFile($('file-a'), 'a.csv', csvA);
    pickFile($('file-b'), 'b.csv', 'Sleep,Wed\nCy,5');
    await settle();
    expect($('charts').hidden).toBe(false);
    expect($('warnings').textContent).toContain('No matching numeric observations');
  });

  it('shows warnings as text, not markup', async () => {
    await loadMain();
    pickFile($('file-a'), 'a.csv', 'V,<b>x</b>\nAna,oops\n');
    pickFile($('file-b'), '<img src=x>.csv', csvB);
    await settle();
    expect($('warnings').querySelector('b, img')).toBeNull();
  });

  it('reports an error if a file cannot be read', async () => {
    await loadMain();
    const input = $('file-a');
    const broken = { name: 'a.csv', text: () => Promise.reject(new Error('disk on fire')) };
    Object.defineProperty(input, 'files', { value: [broken], configurable: true });
    Object.defineProperty($('file-b'), 'files', { value: [fakeFile('b.csv', csvB)], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect($('charts').hidden).toBe(true);
    expect($('warnings').textContent).toBe("Couldn't read the files: disk on fire");
    expect($('status').textContent).toBe('Something went wrong reading the files. See the message below.');
  });

  describe('example buttons', () => {
    const exampleButton = () => document.querySelector('button[data-a="data/examples/quiz_scores.csv"]');

    it('fetch both files and draw the charts', async () => {
      const fetchMock = vi.fn(async path => ({
        ok: true,
        text: async () => readFileSync(resolve(path), 'utf8'),
      }));
      vi.stubGlobal('fetch', fetchMock);
      await loadMain();
      exampleButton().click();
      await settle();
      expect(fetchMock).toHaveBeenCalledWith('data/examples/quiz_scores.csv');
      expect(fetchMock).toHaveBeenCalledWith('data/examples/study_hours.csv');
      expect($('charts').hidden).toBe(false);
      expect($('status').textContent).toMatch(/^Showing quiz_scores\.csv and study_hours\.csv: \d+ groups/);
    });

    it('report a failed download', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
      await loadMain();
      exampleButton().click();
      await settle();
      expect($('charts').hidden).toBe(true);
      expect($('warnings').textContent).toContain('could not be loaded (404)');
    });

    it('report a network failure', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
      await loadMain();
      exampleButton().click();
      await settle();
      expect($('warnings').textContent).toBe("Couldn't read the files: offline");
    });

    it('clear the file pickers', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
      await loadMain();
      const clear = vi.fn();
      Object.defineProperty($('file-a'), 'value', { set: clear, configurable: true });
      exampleButton().click();
      await settle();
      expect(clear).toHaveBeenCalledWith('');
    });
  });
});
