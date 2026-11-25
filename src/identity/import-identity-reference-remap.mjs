/**
 * Remap identity references anywhere in imported project metadata.
 * Call on nested metadata values, not the top-level identity declarations;
 * those declarations are assigned explicitly by the importer.
 */
export function remapImportedIdentityReferences(value, editorIdRemap, shapeIdRemap) {
  if (typeof value === 'string') {
    return editorIdRemap.get(value) || shapeIdRemap.get(value) || value;
  }
  if (Array.isArray(value)) {
    return value.map(item => remapImportedIdentityReferences(item, editorIdRemap, shapeIdRemap));
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(key => {
      value[key] = remapImportedIdentityReferences(value[key], editorIdRemap, shapeIdRemap);
    });
  }
  return value;
}
