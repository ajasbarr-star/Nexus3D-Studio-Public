import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nativePath = new URL('../../native/android/NexusProjectFilesPlugin.java', import.meta.url);
const appPath = new URL('../../src/App.tsx', import.meta.url);

test('native project save verifies the written document before resolving success', async () => {
  const source = await readFile(nativePath, 'utf8');
  assert.ok(source.includes('private long writeDocument(Uri uri, String content)'));
  assert.ok(source.includes('openInputStream(uri)'));
  assert.ok(source.includes('Saved project verification failed'));
  assert.ok(source.includes('response.put("writtenBytes", writtenBytes)'));
});

test('native project load rejects an empty document before JSON parsing', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.ok(source.includes('selectedFile.content.trim().length === 0'));
  assert.ok(source.includes('0 bytes'));
});

test('native project ZIP export verifies exact bytes before resolving success', async () => {
  const source = await readFile(nativePath, 'utf8');
  assert.ok(source.includes('private long writeArchiveDocument(Uri uri, String base64)'));
  assert.ok(source.includes('Saved ZIP verification failed'));
  assert.ok(source.includes('response.put("writtenBytes", writtenBytes)'));
});

test('native save and ZIP success messages expose verified byte counts', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.ok(source.includes("const verifiedBytes = Number(saved.writtenBytes) || 0;"));
  assert.ok(source.includes("verifiedBytes.toLocaleString() + ' bytes'"));
  assert.ok(source.includes('size not reported'));
});
