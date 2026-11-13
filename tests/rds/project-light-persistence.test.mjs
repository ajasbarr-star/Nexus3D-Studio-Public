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
