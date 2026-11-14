import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nativePath = new URL('../../native/android/NexusProjectFilesPlugin.java', import.meta.url);
const appPath = new URL('../../src/App.tsx', import.meta.url);

test('native project save verifies the written document before resolving success', async () => {
  const source = await readFile(nativePath, 'utf8');
  assert.match(source, /private long writeDocument\\(Uri uri, String content\\)/);
  assert.match(source, /openInputStream\\(uri\\)/);
  assert.match(source, /Saved project verification failed/);
  assert.match(source, /response\\.put\\("writtenBytes", writtenBytes\\)/);
});

test('native project load rejects an empty document before JSON parsing', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /selectedFile\\.content\\.trim\\(\\)\\.length === 0/);
  assert.match(source, /0 bytes/);
});
