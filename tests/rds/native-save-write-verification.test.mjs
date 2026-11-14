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


test('project load preflights embedded textures before mutating the active scene', async () => {
  const source = await readFile(appPath, 'utf8');
  const validation = source.indexOf('const preloadedTextures = new Map<string, THREE.Texture>();');
  const sceneMutation = source.indexOf('r.clearSubObjectLocks?.();', validation);
  assert.ok(validation >= 0, 'texture preflight map must exist');
  assert.ok(sceneMutation > validation, 'texture preflight must run before scene mutation');
  assert.ok(source.includes("textureData.dataUrl.startsWith('data:image/')"));
  assert.ok(source.includes("new THREE.TextureLoader().loadAsync(dataUrl)"));
  assert.ok(source.includes('preloadedTextures.get(textureData.dataUrl)'));
  assert.ok(source.includes("embedded texture could not be decoded"));
});


test('failed overwrite keeps the existing project and ZIP destination mapping', async () => {
  const source = await readFile(nativePath, 'utf8');
  assert.ok(source.includes('Unable to verify overwrite of the existing project'));
  assert.ok(source.includes('Unable to verify overwrite of the existing ZIP archive'));
  assert.ok(!source.includes('remove("uri:" + fileName)'));
  assert.ok(!source.includes('remove("zip:" + fileName)'));
});


test('project load delays destructive stale-scene cleanup until all restoration passes finish', async () => {
  const source = await readFile(appPath, 'utf8');
  const loadStart = source.indexOf('const handleProjectFile =');
  const loadEnd = source.indexOf('const createNewProject =', loadStart);
  const load = source.slice(loadStart, loadEnd);
  const rigRestore = load.indexOf('r.restoreSkinnedMesh?.');
  const handleRestore = load.indexOf('r.attachRigHandle?.');
  const faceSelectionRestore = load.indexOf('r.restoreExtrudedFaceSelection?.');
  const staleCleanup = load.indexOf('const staleNodes = collectObjectOnlyProjectNodes');
  const removeStale = load.indexOf('getObjectOnlyProjectRoots(staleNodes).forEach');
  assert.ok(rigRestore >= 0 && handleRestore > rigRestore, 'rig and IK handle restoration must occur');
  assert.ok(faceSelectionRestore > handleRestore, 'saved face selection must be restored before cleanup');
  assert.ok(staleCleanup > faceSelectionRestore, 'stale scene objects must not be deleted before restoration passes complete');
  assert.ok(removeStale > staleCleanup, 'stale object removal must follow final cleanup planning');
});


test('project load preserves current sub-object locks until all other restoration passes finish', async () => {
  const source = await readFile(appPath, 'utf8');
  const loadStart = source.indexOf('const handleProjectFile =');
  const loadEnd = source.indexOf('const createNewProject =', loadStart);
  const load = source.slice(loadStart, loadEnd);
  const clearLocks = load.indexOf('r.clearSubObjectLocks?.();');
  const rigRestore = load.indexOf('r.restoreRigGroup?.');
  const skinRestore = load.indexOf('r.restoreSkinnedMesh?.');
  const handleRestore = load.indexOf('r.attachRigHandle?.');
  const faceSelectionRestore = load.indexOf('r.restoreExtrudedFaceSelection?.');
  const restoreLocks = load.indexOf('Restore Vertex and Edge locks by permanent Shape ID');
  const staleCleanup = load.indexOf('const staleNodes = collectObjectOnlyProjectNodes');
  assert.ok(clearLocks > faceSelectionRestore, 'existing locks must not be cleared before face-selection restoration');
  assert.ok(clearLocks > rigRestore && clearLocks > skinRestore && clearLocks > handleRestore, 'existing locks must survive rig and handle restoration failures');
  assert.ok(restoreLocks > clearLocks, 'saved locks must be applied only after clearing the old locks');
  assert.ok(staleCleanup > restoreLocks, 'lock restoration must finish before stale-scene cleanup');
});


test('SAF save destinations are remembered only when URI permission is persistable', async () => {
  const source = await readFile(nativePath, 'utf8');
  assert.equal((source.match(/FLAG_GRANT_PERSISTABLE_URI_PERMISSION/g) || []).length, 2);
  assert.ok(source.includes('if (permissionPersisted) destinationEditor.putString("uri:" + requestedName, uri.toString())'));
  assert.ok(source.includes('else destinationEditor.remove("uri:" + requestedName)'));
  assert.ok(source.includes('if (permissionPersisted) destinationEditor.putString("zip:" + requestedName, uri.toString())'));
  assert.ok(source.includes('else destinationEditor.remove("zip:" + requestedName)'));
  assert.ok(source.includes('Do not store a URI that may stop working after this app session.'));
});
