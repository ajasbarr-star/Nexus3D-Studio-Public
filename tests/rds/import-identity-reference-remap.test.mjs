import test from 'node:test';
import assert from 'node:assert/strict';
import { remapImportedIdentityReferences } from '../../src/identity/import-identity-reference-remap.mjs';

test('remaps editor and Shape identity references recursively', () => {
  const editorIds = new Map([['editor-old', 'editor-new'], ['bone-old', 'bone-new']]);
  const shapeIds = new Map([['No.01', 'No.08']]);
  const metadata = {
    topology: { ownerEditorId: 'editor-old', ownerShapeId: 'No.01' },
    skeleton: { boneEditorIds: ['bone-old', 'editor-old'] },
    custom: [{ target: 'No.01' }, { linkedObject: 'editor-old' }]
  };
  const result = remapImportedIdentityReferences(metadata, editorIds, shapeIds);
  assert.deepEqual(result, {
    topology: { ownerEditorId: 'editor-new', ownerShapeId: 'No.08' },
    skeleton: { boneEditorIds: ['bone-new', 'editor-new'] },
    custom: [{ target: 'No.08' }, { linkedObject: 'editor-new' }]
  });
});

test('leaves unrelated values and primitive roots unchanged', () => {
  const editorIds = new Map([['old', 'new']]);
  const shapeIds = new Map();
  assert.equal(remapImportedIdentityReferences('unrelated', editorIds, shapeIds), 'unrelated');
  assert.equal(remapImportedIdentityReferences(7, editorIds, shapeIds), 7);
  assert.deepEqual(remapImportedIdentityReferences({ label: 'keep', value: 'old' }, editorIds, shapeIds), { label: 'keep', value: 'new' });
});
