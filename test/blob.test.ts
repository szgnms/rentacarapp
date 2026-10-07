import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, { data: Buffer; access: string }>();
mock.module('@vercel/blob', {
  namedExports: {
    put: async (key: string, data: Buffer, opts: { access: string; addRandomSuffix: boolean }) => {
      assert.equal(opts.addRandomSuffix, false);
      if (store.has(key)) throw new Error('exists');
      store.set(key, { data: Buffer.from(data), access: opts.access });
      return { url: `https://blob.example/${key}`, pathname: key };
    },
    get: async (key: string, opts: { access: string }) => {
      const b = store.get(key);
      if (!b) return null;
      assert.equal(opts.access, b.access);
      return { stream: new Blob([new Uint8Array(b.data)]).stream(), blob: { pathname: key } };
    },
  },
});

test('Vercel Blob deposu: private yükleme, blob: anahtarı, okuma ve bütünlük', async () => {
  process.env.BLOB_READ_WRITE_TOKEN = 'test';
  const { openDb, closeDb } = await import('../lib/db');
  await openDb(':memory:');
  const { saveFile, readFile } = await import('../lib/files');
  const data = Buffer.from('%PDF-1.4 test');
  const f = await saveFile({ kind: 'pdf', entity: 'rental', entityId: 1, name: 'a.pdf', mime: 'application/pdf', data });
  assert.match(f.path, /^blob:rentacar\/\d{4}\/\d{2}\/[0-9a-f]{16}-[0-9a-f]{8}\.pdf$/);
  const [entry] = [...store.values()];
  assert.equal(entry.access, 'private');
  const r = await readFile(f.id);
  assert.deepEqual(r.data, data);
  assert.equal(r.intact, true);
  await closeDb();
});
