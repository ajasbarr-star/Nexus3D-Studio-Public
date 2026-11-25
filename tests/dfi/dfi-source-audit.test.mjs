import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDfiSource } from '../../scripts/dfi-source-audit.mjs';

test('DFI flags duplicate static JSX ids with source evidence', () => {
  const findings = analyzeDfiSource(
    'const View = () => <><div id="same" /><span id="same" /></>;',
    'src/fixture.tsx'
  );
  assert.ok(findings.some(item => item.rule === 'DUPLICATE_STATIC_JSX_ID' && item.severity === 'WARN' && item.line === 1));
});

test('DFI records repeated global event registrations as advisory signals', () => {
  const findings = analyzeDfiSource(
    'window.addEventListener("resize", onResize); window.addEventListener("resize", onOtherResize);',
    'src/fixture.ts'
  );
  assert.ok(findings.some(item => item.rule === 'REPEATED_GLOBAL_EVENT_REGISTRATION' && item.severity === 'INFO'));
});

test('DFI reports TypeScript parse errors', () => {
  const findings = analyzeDfiSource('const broken: = ;', 'src/fixture.ts');
  assert.ok(findings.some(item => item.rule === 'TYPESCRIPT_PARSE_ERROR' && item.severity === 'ERROR'));
});
