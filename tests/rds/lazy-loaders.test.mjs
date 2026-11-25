import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');

test('heavy model importers and exporters are not eagerly imported by the editor entry', () => {
  const eagerImports = app.split('\n').filter(line =>
    /^import .*?(GLTFLoader|OBJLoader|MTLLoader|FBXLoader|ColladaLoader|STLLoader|PLYLoader|BVHLoader|VRMLoaderPlugin|GLTFExporter)/.test(line)
  );
  assert.deepEqual(eagerImports, []);
});

test('each supported model format loads its importer only when requested', () => {
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/OBJLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/MTLLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/GLTFLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/FBXLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/ColladaLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/STLLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/PLYLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/BVHLoader\.js'\)/);
  assert.match(app, /await import\('@pixiv\/three-vrm'\)/);
});

test('GLTF project import and ZIP export also load their utilities on demand', () => {
  assert.match(app, /await import\('three\/examples\/jsm\/loaders\/GLTFLoader\.js'\)/);
  assert.match(app, /await import\('three\/examples\/jsm\/exporters\/GLTFExporter\.js'\)/);
});
