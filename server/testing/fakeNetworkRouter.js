'use strict';
// Stateful RouterOS command fixture: supports query filters and records mutations.
function fakeNetworkRouter(initial = {}) {
  const tables = structuredClone(initial), writes = [];
  let sequence = 0;
  async function send(path, words = []) {
    const base = path.slice(0, path.lastIndexOf('/')), action = path.split('/').at(-1);
    const table = tables[base] ||= [];
    const values = Object.fromEntries(words.filter(w => w.startsWith('=')).map(w => { const at = w.indexOf('=', 1); return [w.slice(1, at), w.slice(at + 1)]; }));
    if (action === 'print') return structuredClone(table.filter(row => words.filter(w => w.startsWith('?')).every(w => { const at = w.indexOf('='); return String(row[w.slice(1, at)]) === w.slice(at + 1); })));
    writes.push({ path, words });
    const id = values['.id'] || values.numbers;
    if (action === 'add') table.push({ ...values, '.id': '*' + (++sequence), disabled: values.disabled || 'no' });
    else if (action === 'set') { const row = table.find(r => r['.id'] === id); if (!row) throw new Error('Missing row'); Object.assign(row, values); }
    else if (action === 'remove') tables[base] = table.filter(r => r['.id'] !== id);
    else if (action !== 'move') throw new Error('Unsupported fake command');
    return [];
  }
  return { send, tables, writes };
}
module.exports = { fakeNetworkRouter };
