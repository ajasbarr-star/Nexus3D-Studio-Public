import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nativePath = new URL('../../native/android/NexusProjectFilesPlugin.java', import.meta.url);
const appPath = new URL('../../src/App.tsx', import.meta.url);

test('native project save verifies the written document before resolving success', async () => {
  const source = await readFile(nativePath, 'utf8');
  assert.ok(source.includes('private long writeDocument(Uri uri, java.io.File stagedFile)'));
  assert.ok(source.includes('DigestInputStream'));
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
  assert.ok(source.includes('if (persistPermission) destinationEditor.putString("uri:" + requestedName, uri.toString())'));
  assert.ok(source.includes('else destinationEditor.remove("uri:" + requestedName)'));
  assert.ok(source.includes('if (permissionPersisted) destinationEditor.putString("zip:" + requestedName, uri.toString())'));
  assert.ok(source.includes('else destinationEditor.remove("zip:" + requestedName)'));
  assert.ok(source.includes('Do not store a URI that may stop working after this app session.'));
});


test('project name and keyframe history are committed only after scene restoration succeeds', async () => {
  const source = await readFile(appPath, 'utf8');
  const loadStart = source.indexOf('const handleProjectFile =');
  const loadEnd = source.indexOf('const createNewProject =', loadStart);
  const load = source.slice(loadStart, loadEnd);
  const rigRestore = load.indexOf('r.restoreRigGroup?.');
  const handleRestore = load.indexOf('r.attachRigHandle?.');
  const faceRestore = load.indexOf('r.restoreExtrudedFaceSelection?.');
  const projectCommit = load.indexOf('if (data.projectName) setProjectName(String(data.projectName))');
  const keyframeCommit = load.indexOf('keysRef.current = restoredKeys');
  const staleCleanup = load.indexOf('const staleNodes = collectObjectOnlyProjectNodes');
  assert.ok(projectCommit > rigRestore && projectCommit > handleRestore && projectCommit > faceRestore, 'project name must not change before scene restoration finishes');
  assert.ok(keyframeCommit > rigRestore && keyframeCommit > handleRestore && keyframeCommit > faceRestore, 'keyframes and undo history must not change before scene restoration finishes');
  assert.ok(staleCleanup > projectCommit && staleCleanup > keyframeCommit, 'project UI state must be committed before stale scene cleanup');
});


test('restored face selection and sub-object locks never bind to stale pre-load objects', async () => {
  const source = await readFile(appPath, 'utf8');
  const loadStart = source.indexOf('const handleProjectFile =');
  const loadEnd = source.indexOf('const createNewProject =', loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.ok(load.includes('const mesh = saved.shapeId ? [...restoredNodeSet].find((candidate: THREE.Object3D) => candidate.userData.shapeId === saved.shapeId) : undefined;'), 'face selection must resolve only within the restored object set');
  assert.ok(load.includes('const mesh = [...restoredNodeSet].find((candidate: THREE.Object3D) => candidate.userData.shapeId === savedLock.shapeId);'), 'sub-object locks must resolve only within the restored object set');
});


test('normal Save validates the complete project payload before writing', async () => {
  const source = await readFile(appPath, 'utf8');
  const saveStart = source.indexOf('const saveProject = async');
  const saveEnd = source.indexOf('const loadProject = async', saveStart);
  const save = source.slice(saveStart, saveEnd);
  const validate = save.indexOf('validateProjectIdentityData(sceneObjects, Number(data.version) || 0)');
  const serialize = save.indexOf('const serialized = JSON.stringify');
  assert.ok(validate >= 0 && serialize > validate, 'project data must pass validation before it is serialized or written');
});


test('native project Save stages the payload before opening the Android document picker', async () => {
  const source = await readFile(nativePath, 'utf8');
  const app = await readFile(appPath, 'utf8');
  assert.ok(source.includes('public void stageProject(PluginCall call)'));
  assert.ok(source.includes('private final ExecutorService projectIo'));
  assert.ok(source.includes('startActivityForResult(call, intent, "handleSaveResult")'));
  const save = app.slice(app.indexOf('const saveProject = async'), app.indexOf('const loadProject = async'));
  assert.ok(save.indexOf('stageProject({ content: serialized })') >= 0);
  assert.ok(save.indexOf('stageProject({ content: serialized })') < save.indexOf('saveProject({ fileName, stagedId: staged.stagedId })'));
  assert.ok(!save.includes('saveProject({ fileName, content: serialized })'));
});

test('native staged Save streams write and SHA-256 verification', async () => {
  const source = await readFile(nativePath, 'utf8');
  const start = source.indexOf('private long writeDocument(Uri uri, java.io.File stagedFile)');
  const end = source.indexOf('public void saveProjectArchive', start);
  const saveWriter = source.slice(start, end);
  assert.ok(start >= 0);
  assert.ok(saveWriter.includes('DigestOutputStream'));
  assert.ok(saveWriter.includes('DigestInputStream'));
  assert.ok(saveWriter.includes('MessageDigest.isEqual'));
  assert.ok(!saveWriter.includes('getBytes(StandardCharsets.UTF_8)'));
});

test('Save button prevents overlapping project saves and reports its in-flight state', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.ok(source.includes('const saveInFlightRef = useRef(false)'));
  assert.ok(source.includes('if (saveInFlightRef.current) return;'));
  assert.ok(source.includes('disabled={isSavingProject}'));
  assert.ok(source.includes('[ SAVING... ]'));
});


test('RDS ZIP export writes to public Documents/Nexus3D and verifies bytes before success', async () => {
  const source = await readFile(nativePath, 'utf8');
  assert.ok(source.includes('public void saveRdsArchive(PluginCall call)'));
  assert.ok(source.includes('Environment.DIRECTORY_DOCUMENTS + "/Nexus3D/"'));
  assert.ok(source.includes('MediaStore.MediaColumns.RELATIVE_PATH'));
  assert.ok(source.includes('Saved RDS ZIP could not be reopened for verification'));
  assert.ok(source.includes('RDS ZIP verification failed'));
  assert.ok(source.includes('response.put("writtenBytes", verifiedBytes)'));
  assert.ok(source.includes('response.put("name", verifiedName)'));
  assert.ok(source.includes('response.put("path", reportedDirectory + "/" + verifiedName)'));
  assert.ok(source.includes('verifiedRelativePath = actualPath'));
  assert.ok(source.includes('MediaStore.MediaColumns.RELATIVE_PATH'));
  assert.ok(source.includes('String expectedPath = Environment.DIRECTORY_DOCUMENTS + "/Nexus3D/";'));
  assert.ok(source.includes("actualPath.replace('\\\\', '/')"));
  assert.ok(source.includes('normalizedActualPath.endsWith("/")'));
  assert.ok(source.includes('destination verification failed'));
  assert.ok(source.includes('RDS ZIP failed at stage ['));
  assert.ok(source.includes('String diagnosticUri = uri == null ? "no MediaStore URI created" : uri.toString();'));
  assert.ok(source.includes('partial file preserved for diagnosis'));
  assert.ok(!source.includes('getContentResolver().delete(uri, null, null)'));
});

test('RDS ZIP progress reaches 100 only after native save verification resolves', async () => {
  const source = await readFile(appPath, 'utf8');
  const start = source.indexOf('const exportRdsToolZip = async');
  const end = source.indexOf('const [maintenanceBusy', start);
  const exportCode = source.slice(start, end);
  const save = exportCode.indexOf('await NexusProjectFiles.saveRdsArchive({ fileName: filename, base64 })');
  const verified = exportCode.indexOf('const verifiedBytes = Number(saved.writtenBytes) || 0;', save);
  const success = exportCode.indexOf('setRdsExportProgress(100);', verified);
  assert.ok(save >= 0 && verified > save && success > verified);
  assert.ok(exportCode.includes("setRdsExportPhase('failed')"));
  assert.ok(exportCode.includes("setRdsExportPhase('verifying')"));
  assert.ok(exportCode.includes("setRdsExportPhase('passed')"));
  assert.ok(exportCode.includes('checkCRC32: true'));
  assert.ok(exportCode.includes('createRdsZipArchive(exportFiles)'));
  assert.ok(exportCode.includes('buildRdsZipFilename(tool, generatedAt)'));
  assert.ok(exportCode.includes('getRequiredRdsZipFiles()'));
  assert.ok(exportCode.includes('hasNestedEntries'));
  assert.ok(exportCode.includes('extractedText !== exportFiles[name]'));
  const zipHelper = await readFile(new URL('../../src/diagnostics/rds-zip.mjs', import.meta.url), 'utf8');
  for (const name of ['Full_Report.txt', 'Errors.txt', 'Warnings.txt', 'Summary.txt', 'Metadata.txt']) {
    assert.ok(zipHelper.includes(name), 'ZIP helper must include ' + name);
  }
  assert.ok(zipHelper.includes('formatToParts(localGeneratedAt)'));
  assert.ok(zipHelper.includes("part('hour') + '-' + part('minute') + part('dayPeriod').toLowerCase()"));
  assert.ok(zipHelper.includes("zip.file(name, content, { createFolders: false })"));
  assert.ok(exportCode.includes("replace(/\\\\/g, '/')"));
  assert.ok(exportCode.includes("replace(/\\/+/g, '/')"));
  assert.ok(source.includes('rds-verification-panel'));
  assert.ok(source.includes('rdsExportProgress'));
});


test('RDS bottom slider follows its bottom edge while top stays anchored and drag direction matches the Leftside control', async () => {
  const css = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
  const start = css.indexOf('.rds-bottom-slider {');
  const end = css.indexOf('}', start);
  const rule = css.slice(start, end);
  assert.ok(rule.includes('position:absolute'));
  assert.ok(rule.includes('left:50%'));
  assert.ok(rule.includes('bottom:-15px'));
  assert.ok(rule.includes('width:88px'));
  assert.ok(rule.includes('height:30px'));
  assert.ok(rule.includes('touch-action:none'));
  const app = await readFile(appPath, 'utf8');
  const panelStart = app.indexOf('<aside ref={rdsPanelElementRef}');
  const panelEnd = app.indexOf('</aside>}', panelStart);
  const slider = app.indexOf('className="rds-bottom-slider"', panelStart);
  assert.ok(panelStart >= 0 && panelEnd > panelStart);
  assert.ok(slider > panelStart && slider < panelEnd, 'Bottom Slider must be a child of the RDS panel');
  assert.ok(app.includes('beginRdsBottomResize(event)'));
  assert.ok(app.includes('start.height + moveEvent.clientY - start.y'));
  assert.ok(app.includes('beginRdsPanelWidthResize(event)'));
  assert.ok(!app.includes('beginRdsPanelResize'));
  assert.ok(!app.includes('rdsResizeRef'));
  assert.ok(!app.includes('rdsBottomSliderPosition'));
  assert.ok(!app.includes('new ResizeObserver(updatePosition)'));
  assert.ok(!css.includes('.rds-bottom-slider { position:absolute !important;'));
  assert.ok(css.includes('.rds-command-center { position:fixed; z-index:30; top:55px; bottom:auto;'));
  assert.ok(css.includes('max-height:calc(100dvh - 76px)'));
  assert.ok(app.includes('window.innerHeight - 76'));
  assert.ok(!app.includes('className="rds-resize-handle rds-resize-vertical"'));
});
test('every RDS tool has its own persistent ZIP verification panel and read-back checks', async () => {
  const app = await readFile(appPath, 'utf8');
  const css = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
  assert.ok(app.includes('rdsVerificationByTool[rdsActiveTool]'));
  assert.ok(app.includes('rds-verification-panel'));
  for (const label of ['Filename', 'Destination', 'File Bytes', 'ZIP CRC32', '5 TXT Files', 'TXT Read-back']) assert.ok(app.includes("label:'" + label + "'"), 'missing verification row ' + label);
  assert.ok(app.includes("updateRdsVerification(tool, { phase: 'SUCCESS' })"));
  assert.ok(app.includes("file.async('string')"));
  assert.ok(css.includes('.rds-verification-panel'));
});

test('RDS width resize handle is on the left edge and dragging right reduces panel width', async () => {
  const source = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
  const start = source.indexOf('.rds-resize-horizontal {');
  const end = source.indexOf('}', start);
  const rule = source.slice(start, end);
  assert.ok(rule.includes('left:0'));
  assert.ok(rule.includes('right:auto'));
  const app = await readFile(appPath, 'utf8');
  assert.ok(app.includes('start.width + start.x - moveEvent.clientX'));
});

test('RDS ZIP percentage indicator has visible active, complete, and failure states', async () => {
  const source = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
  assert.ok(source.includes('.rds-export-progress.active'));
  assert.ok(source.includes('.rds-export-progress.complete'));
  assert.ok(source.includes('.rds-export-progress.failed'));
});


test('RDS native filename validator matches the canonical Philippine-time ZIP contract', async () => {
  const java = await readFile(nativePath, 'utf8');
  const app = await readFile(appPath, 'utf8');
  const helper = await readFile(new URL('../../src/diagnostics/rds-zip.mjs', import.meta.url), 'utf8');
  assert.ok(java.includes('static boolean isValidRdsZipFilename(String fileName)'));
  assert.ok(java.includes('(?:[1-9]|1[0-2])-[0-5][0-9](?:am|pm)'));
  assert.ok(java.includes('dateFormat.setLenient(false)'));
  assert.ok(java.includes('if (!isValidRdsZipFilename(fileName))'));
  assert.ok(!java.includes('[0-9]{1,2}:[0-9]{2}(am|pm)'));
  assert.ok(!java.includes("fileName.replace(':', '_')"));
  assert.ok(helper.includes("timeZone: 'Asia/Manila'"));
  assert.ok(helper.includes("hour12: true"));
  assert.ok(helper.includes("part('month'), part('day'), part('year')"));
  assert.ok(app.includes("String(saved.name || '') !== filename"));
  assert.ok(!app.includes('normalizeAndroidName'));
  assert.ok(!app.includes("replace(/:/g, '_')"));
});

test('RDS ZIP timestamp is captured once at export invocation before report generation', async () => {
  const app = await readFile(appPath, 'utf8');
  const start = app.indexOf('const exportRdsToolZip = async');
  const end = app.indexOf('const [maintenanceBusy', start);
  const handler = app.slice(start, end);
  const capture = handler.indexOf('const generatedAt = new Date().toISOString();');
  const reportBuild = handler.indexOf('const exportFiles = buildRdsExportFiles({');
  const filename = handler.indexOf('buildRdsZipFilename(tool, generatedAt)');
  assert.ok(capture >= 0 && reportBuild > capture && filename > capture);
  assert.equal((handler.match(/const generatedAt = new Date\(\)\.toISOString\(\);/g) || []).length, 1);
});
