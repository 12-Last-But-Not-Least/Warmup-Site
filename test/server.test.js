import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { createServer } = createRequire(import.meta.url)('../server.js');

let server;
let base;

beforeAll(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

describe('static server', () => {
  it('serves index.html at /', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(await res.text()).toContain('<title>');
  });

  it.each([
    ['/src/main.js', 'text/javascript'],
    ['/styles.css', 'text/css'],
    ['/data/examples/quiz_scores.csv', 'text/csv'],
  ])('serves %s as %s', async (url, type) => {
    const res = await fetch(base + url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(type);
  });

  it('serves unknown extensions as octet-stream', async () => {
    const res = await fetch(`${base}/.gitignore`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('decodes percent-escapes in file names', async () => {
    const res = await fetch(`${base}/data/DATA%20-%20Step%20Count.csv`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for missing files', async () => {
    expect((await fetch(`${base}/nope.txt`)).status).toBe(404);
  });

  it('returns 403 for encoded paths that escape the root', async () => {
    // "..%2f" is only a traversal after decoding, so URL parsing doesn't normalise it away.
    const res = await fetch(`${base}/..%2f..%2fetc/passwd`);
    expect(res.status).toBe(403);
  });

  it('returns 400 instead of crashing on a malformed escape', async () => {
    const res = await fetch(`${base}/%E0%A4%A`);
    expect(res.status).toBe(400);
    expect((await fetch(`${base}/`)).status).toBe(200); // still alive
  });
});
