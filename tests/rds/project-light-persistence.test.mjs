import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const scope = fs.readFileSync(new URL('../../src/project/object-project-scope.mjs', import.meta.url), 'utf8');

test('object-only project scope retains editable scene lights but excludes viewport cameras', () => {
  assert.match(scope, /node\?\.isLight\s*\|\|\s*node\?\.userData\?\.kind\s*===\s*'Light'/);
  assert.match(scope, /node\?\.isCamera\s*\|\|\s*node\?\.userData\?\.kind\s*===\s*'Camera'/);
});

test('project payload stores light settings, shadow state, and SpotLight target direction', () => {
  assert.match(app, /light:\s*obj instanceof THREE\.Light\s*\?/);
  assert.match(app, /targetPosition:\s*obj instanceof THREE\.SpotLight\s*\?\s*obj\.target\.position\.toArray\(\)/);
  assert.match(app, /castShadow:\s*Boolean\(\(obj as any\)\.castShadow\)/);
  assert.match(app, /shadowBias:\s*\(obj as any\)\.shadow\?\.bias/);
  assert.match(app, /shadowRadius:\s*\(obj as any\)\.shadow\?\.radius/);
});

test('project restore reapplies light shadow state and SpotLight target direction', () => {
  assert.match(app, /obj instanceof THREE\.Light && typeof saved\.castShadow === 'boolean'[\s\S]{0,140}obj\.castShadow = saved\.castShadow/);
  assert.match(app, /obj instanceof THREE\.SpotLight && Array\.isArray\(saved\.light\.targetPosition\)/);
  assert.match(app, /obj\.target\.position\.fromArray\(saved\.light\.targetPosition\)/);
  assert.match(app, /obj\.target\.updateMatrixWorld\(true\)/);
});

test('ZIP import reapplies editor light settings omitted by GLB metadata', () => {
  const zipImport = app.slice(app.indexOf('const importProjectZip'));
  assert.match(zipImport, /if \(node\.isLight && saved\.light\)/);
  assert.match(zipImport, /node\.color\.set\('#' \+ saved\.light\.color\)/);
  assert.match(zipImport, /node\.shadow\.bias = saved\.light\.shadowBias/);
  assert.match(zipImport, /node\.shadow\.radius = saved\.light\.shadowRadius/);
  assert.match(zipImport, /node\.target\.position\.fromArray\(saved\.light\.targetPosition\)/);
  assert.match(zipImport, /node\.castShadow = saved\.castShadow/);
});

test('ZIP import restores full material properties and embedded texture slots from project metadata', () => {
  const zipImport = app.slice(app.indexOf('const importProjectZip'));
  assert.match(zipImport, /!Array\.isArray\(saved\.material\) \|\| !saved\.material\.length/);
  assert.match(zipImport, /createProjectMaterial\(materialData\)/);
  assert.match(zipImport, /materialData\?\.textures/);
  assert.match(zipImport, /new THREE\.TextureLoader\(\)\.loadAsync\(textureData\.dataUrl\)/);
  assert.match(zipImport, /texture\.repeat\.fromArray\(textureData\.repeat\)/);
  assert.match(zipImport, /mesh\.material = materials\.length === 1 \? materials\[0\] : materials/);
});


test('ZIP import recreates metadata lights omitted from the GLB scene', () => {
  const zipImport = app.slice(app.indexOf('const importProjectZip'));
  assert.match(zipImport, /!saved\?\.light \|\| !saved\?\.editorId \|\| restoredById\.has\(saved\.editorId\)/);
  assert.match(zipImport, /new THREE\.AmbientLight\(color, intensity\)/);
  assert.match(zipImport, /new THREE\.HemisphereLight\(color, saved\.light\.groundColor/);
  assert.match(zipImport, /light\.userData\.editorId = saved\.editorId/);
  assert.match(zipImport, /importedNodes\.push\(light\)/);
  assert.match(zipImport, /restoredById\.set\(saved\.editorId, light\)/);
});
