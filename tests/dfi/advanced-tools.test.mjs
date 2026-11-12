import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../../src/dfi/mesh-forensics.ts', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');

test('Advanced DFI dashboard exposes all requested clickable diagnostic tools', () => {
  for (const label of ['Shape Core','Gizmo Control','Face Tools','Edge Tools','Vertex Tools','Extrude & Scale','Subdivide + Rotate','Post-Smooth','Overlap Scan']) {
    assert.ok(app.includes("['" + label + "'") || app.includes("['" + label + "',"), 'missing tool: ' + label);
  }
  assert.match(app, /runDfiToolScan\(tool\)/);
});

test('Advanced DFI provides a unified COPY ALL REPORT action', () => {
  assert.match(app, /const copyAllDfiReport = async \(\) =>/);
  assert.match(app, /COPY ALL REPORT/);
  assert.match(app, /INDIVIDUAL TOOL REPORTS/);
  assert.match(app, /ALL CAPTURED RUNTIME DIAGNOSTICS/);
  assert.match(app, /RDS FULL CORE REPORT/);
});

test('Gizmo forensic recording captures axis, mode, coordinate space and transforms', () => {
  assert.match(app, /Gizmo transform sample/);
  assert.match(app, /axis: transform\.axis \?\? null/);
  assert.match(app, /mode: transform\.getMode\(\)/);
  assert.match(app, /space: spaceRef\.current/);
  assert.match(app, /position: object\.position\.toArray\(\)/);
  assert.match(app, /rotation: \[object\.rotation\.x, object\.rotation\.y, object\.rotation\.z\]/);
  assert.match(app, /scale: object\.scale\.toArray\(\)/);
});

test('Geometry operation trace captures selection, transform axis and pre-operation mesh state', () => {
  assert.match(app, /Geometry operation requested/);
  assert.match(app, /selectionVertexCount: part\.indices\.length/);
  assert.match(app, /selectedFaceCount: part\.faceParts\?\.length \|\| 0/);
  assert.match(app, /indexedBefore: Boolean\(target\.geometry\.index\)/);
  assert.match(app, /transformAxis: runtime\.current\?\.transform\?\.axis/);
});

test('Mesh Core scanner checks duplicate triangles, invalid indices, degenerates and edge incidence', () => {
  for (const token of ['DUPLICATE_TRIANGLES','INVALID_INDEX','DEGENERATE_TRIANGLES','NON_MANIFOLD_EDGE','BOUNDARY_EDGES','COINCIDENT_VERTICES']) {
    assert.ok(scanner.includes(token), 'missing topology check: ' + token);
  }
  assert.match(scanner, /export function scanMeshCore/);
  assert.match(scanner, /export function formatMeshForensicReport/);
  assert.match(scanner, /Read-only scan/);
});

test('Advanced DFI report highlights CRASH, CONFLICT, ERROR, BUG and WARNING findings', () => {
  assert.match(app, /CRASH\|FATAL/);
  assert.match(app, /CONFLICT/);
  assert.match(app, /ERROR\|BUG\|DUPLICATE\|NON_MANIFOLD/);
  assert.match(app, /WARN\|WARNING\|SUSPECTED/);
  assert.match(styles, /dfi-crash/);
  assert.match(styles, /dfi-conflict/);
  assert.match(styles, /dfi-error/);
  assert.match(styles, /dfi-warning/);
});

test('DFI diagnostic actions do not automatically repair or mutate scene geometry', () => {
  assert.match(app, /No geometry repair or mutation was attempted/);
  assert.match(scanner, /no mesh, transform, material, selection, or project data was modified/i);
});

test('Geometry commits record before/after counts, bounds, axis and quad verification', () => {
  assert.match(app, /Geometry operation committed/);
  assert.match(app, /vertexCountBefore: before\.getAttribute\('position'\)\?\.count/);
  assert.match(app, /vertexCountAfter: committedPosition\?\.count/);
  assert.match(app, /boundsMin: target\.geometry\.boundingBox\?\.min\.toArray\(\)/);
  assert.match(app, /quadGridVerified: Boolean\(afterQuadGridState\.enabled\)/);
});

test('Scene Tree and Menu use independent Mother Panels with fixed top-left anchors and nested VerticalBox containers', () => {
  assert.match(app, /className="hierarchy-panel scene-tree-mother-panel"/);
  assert.match(app, /className="panel-vertical-box scene-tree-vertical-box"/);
  assert.match(app, /className="menu-panel menu-mother-panel"/);
  assert.match(app, /className="panel-vertical-box menu-panel-vertical-box"/);
  assert.match(app, /const \[treePanelHeight, setTreePanelHeight\] = useState\(initialPanelHeight\)/);
  assert.match(app, /const \[menuPanelHeight, setMenuPanelHeight\] = useState\(initialPanelHeight\)/);
  assert.match(app, /beginPanelResize\(event, 'tree', 'height'\)/);
  assert.match(app, /beginPanelResize\(event, 'tree', 'width'\)/);
  assert.match(app, /beginPanelResize\(event, 'menu', 'height'\)/);
  assert.match(app, /beginPanelResize\(event, 'menu', 'width'\)/);
  assert.match(app, /start\.height \+ moveEvent\.clientY - start\.y/);
  assert.match(app, /--nexus-panel-height": treePanelHeight \+ "px"/);
  assert.match(app, /--nexus-panel-height": menuPanelHeight \+ "px"/);
  assert.doesNotMatch(app, /sceneTreeTop|menuPanelTop|beginTreeHeightResize/);
  assert.match(styles, /\.panel-resize-handle-horizontal/);
  assert.match(styles, /\.panel-resize-handle-vertical/);
  assert.match(styles, /top: 52px !important/);
  assert.match(styles, /left: 8px !important/);
});


test('Advanced DFI exposes per-ID summary copy icons and separate full/summary report actions', () => {
  for (const id of ['010','020','030','040','050','060','070','080','090']) {
    assert.ok(app.includes("id: '" + id + "'"), 'missing DFI category ID ' + id);
  }
  assert.match(app, /copyDfiToolSummary\(section\.id, tool\)/);
  assert.match(app, /aria-label=\{'Copy ID No\.' \+ section\.id \+ ' summary'\}/);
  assert.match(app, /COPY SUMMARY REPORT/);
  assert.match(app, /COPY ALL REPORT/);
  assert.match(app, /buildDfiToolSummary/);
  assert.match(styles, /\.dfi-summary-copy-icon/);
  assert.match(styles, /\.dfi-report-copy-actions/);
});


test('COPY SUMMARY REPORT consolidates captured 3D scene and shape workflows into one paste-ready report', () => {
  assert.match(app, /const buildSceneWorkflowSummary = \(\) =>/);
  assert.match(app, /3D SCENE \+ SHAPE WORKFLOW SUMMARY/);
  assert.match(app, /CURRENT 3D SCENE \/ SHAPE STATE/);
  assert.match(app, /WORKFLOW COUNTS BY CAPTURED EVENT/);
  assert.match(app, /OBJECT \/ SHAPE ACTIVITY/);
  assert.match(app, /OPERATION WORKFLOW TIMELINE/);
  assert.match(app, /CURRENT MESH TOPOLOGY \/ INTEGRITY SCAN/);
  assert.match(app, /geometryVertexCountBefore/);
  assert.match(app, /triangleCountAfter/);
  assert.match(app, /before an operation unless that operation recorded a before\/after snapshot/);
  assert.match(app, /const copyAllDfiSummary = \(\) => \{/);
  assert.match(app, /const report = buildSceneWorkflowSummary\(\)/);
});
