import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual browser worker message protocol with Node's File/Blob.
// Only the browser FileReader transport is substituted; parsing and limits are real.
const messages = [];
let cancelOnProgress = null;
globalThis.self = { postMessage(message) {
  messages.push(message);
  if (cancelOnProgress === message.id && message.progress?.startsWith('Preparing CSV')) {
    self.onmessage({ data: { type: 'cancel-export', payload: { id: message.id } } });
  }
} };
globalThis.FileReader = class {
  readAsText(blob) { blob.text().then(text => this.onload({ target: { result: text } })).catch(e => { this.error = e; this.onerror?.(e); }); }
};
await import('../src/pipeline.worker.js');
let id = 0;
async function send(type, payload) {
  const requestId = ++id;
  await self.onmessage({ data: { id: requestId, type, payload } });
  return messages.findLast(m => m.id === requestId && ('result' in m || 'error' in m));
}
const valid = new File(['B,Mon,Tue\nA,1,2'], 'valid.csv');
test('worker imports chunked files, exports every page and retains precision', async () => {
  const loaded = await send('load', { generated:1000 });
  assert.deepEqual(loaded.result.counts,[7000,7000,7000]);
  const page = await send('page',{source:2,mode:'detail',page:5,size:50});
  assert.equal(page.result.rows.length,50);
  const csv = await send('export',{source:2,mode:'detail'});
  const text = await csv.result.blob.text();
  assert.equal(csv.result.rows,7000);
  assert.equal(text.trim().split(/\r?\n/).length,7001);
  assert.ok(text.includes('Person 01000'));
});
test('worker rejects excessive columns, file bytes and total cells without replacing its last model', async () => {
  const wide = new File(['A,'+Array.from({length:513},(_,i)=>`C${i}`).join(',')+'\nA,'+Array(513).fill('1').join(',')],'wide.csv');
  assert.match((await send('load',{files:[wide,valid]})).error,/512 value columns/);
  const huge = new File(['x'.repeat(5*1024*1024+1)],'large.csv');
  assert.match((await send('load',{files:[huge,valid]})).error,/5 MiB/);
  const columns=Array.from({length:20},(_,i)=>`C${i}`).join(',');
  const many = new File(['A,'+columns+'\n'+Array.from({length:13000},(_,i)=>`Group ${i},${Array(20).fill(1).join(',')}`).join('\n')],'many.csv');
  assert.match((await send('load',{files:[many,valid]})).error,/250,000-cell/);
  assert.equal((await send('page',{mode:'detail'})).result.total,7000);
});
test('worker cancels CSV generation cooperatively and keeps the data usable', async () => {
  cancelOnProgress = id + 1;
  const result = await send('export',{source:2,mode:'detail'});
  assert.match(result.error,/cancelled/);
  cancelOnProgress = null;
  assert.equal((await send('page',{mode:'detail'})).result.total,7000);
});

test('worker view, paginated table and complete CSV honor per-chart legend exclusions', async () => {
  await send('load', {generated:1000});
  const hidden = ['Person 00001'];
  const view = await send('view', {hiddenBySource:[[],[],hidden]});
  assert.deepEqual(view.result.counts, [7000,7000,6993]);
  const page = await send('page', {source:2,mode:'detail',excludedGroups:hidden});
  assert.equal(page.result.total,6993);
  const csv = await send('export', {source:2,mode:'detail',excludedGroups:hidden});
  assert.equal(csv.result.rows,6993);
  assert.ok(!(await csv.result.blob.text()).includes('Person 00001'));
});
