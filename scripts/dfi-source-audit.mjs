import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const outputPath = path.join(root, 'public', 'nexus-dfi-audit.json');

export function analyzeDfiSource(source, fileName = 'src/App.tsx') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];
  const jsxIds = new Map();
  const globalListeners = new Map();
  const add = (node, severity, rule, message) => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({ severity, rule, file: fileName, line: position.line + 1, message });
  };

  const visit = node => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'id' && node.initializer) {
      let idValue = '';
      if (ts.isStringLiteral(node.initializer)) idValue = node.initializer.text;
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isStringLiteral(node.initializer.expression)) {
        idValue = node.initializer.expression.text;
      }
      if (idValue) {
        const entries = jsxIds.get(idValue) || [];
        entries.push(node);
        jsxIds.set(idValue, entries);
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'addEventListener' && node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])) {
      const receiver = node.expression.expression.getText(sourceFile);
      if (receiver === 'window' || receiver === 'document' || receiver === 'document.body') {
        const key = receiver + ':' + node.arguments[0].text;
        const entries = globalListeners.get(key) || [];
        entries.push(node);
        globalListeners.set(key, entries);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const [id, nodes] of jsxIds) {
    if (nodes.length > 1) add(nodes[1], 'WARN', 'DUPLICATE_STATIC_JSX_ID',
      `Static JSX id "${id}" appears ${nodes.length} times in this source file. Duplicate IDs can misdirect labels, selectors, or automation; verify whether the duplicates are intentional.`);
  }
  for (const [key, nodes] of globalListeners) {
    if (nodes.length > 1) add(nodes[1], 'INFO', 'REPEATED_GLOBAL_EVENT_REGISTRATION',
      `Found ${nodes.length} static addEventListener registrations for ${key}. Multiple listeners may be intentional; inspect ownership and cleanup paths if events fire more than once.`);
  }
  for (const diagnostic of sourceFile.parseDiagnostics) {
    const position = diagnostic.start ?? 0;
    const location = sourceFile.getLineAndCharacterOfPosition(position);
    findings.push({
      severity: 'ERROR',
      rule: 'TYPESCRIPT_PARSE_ERROR',
      file: fileName,
      line: location.line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
    });
  }
  return findings;
}

function collectSourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return ts.sys.readDirectory(directory, ['.ts', '.tsx'], ['**/*.d.ts'], undefined);
}

const files = collectSourceFiles(sourceRoot);
const findings = [];
for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  findings.push(...analyzeDfiSource(source, path.relative(root, filePath).split(path.sep).join('/')));
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scanner: 'Nexus3D DFI Core Source Forensics',
  mode: 'static-build-time',
  scannedFiles: files.length,
  errors: findings.filter(item => item.severity === 'ERROR').length,
  warnings: findings.filter(item => item.severity === 'WARN').length,
  info: findings.filter(item => item.severity === 'INFO').length,
  findings,
  coverage: [
    'TypeScript / TSX AST parsing and syntax diagnostics',
    'Duplicate static JSX id detection per source file',
    'Repeated static window / document event-listener registration signals'
  ],
  limitations: [
    'Static heuristics identify review targets; repeated listeners may be intentional and are not automatically classified as defects.',
    'This is not a complete TypeScript semantic, interprocedural data-flow, dependency, race-condition, or security analyzer.',
    'Runtime-only failures, native Android crashes, and Git-history regression origins require separate evidence and tooling.'
  ]
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Nexus DFI source audit: ${files.length} file(s), ${report.errors} error(s), ${report.warnings} warning(s), ${report.info} advisory signal(s).`);
if (report.errors > 0) {
  for (const finding of findings.filter(item => item.severity === 'ERROR')) {
    console.error(`[${finding.severity}] ${finding.file}:${finding.line} ${finding.rule} — ${finding.message}`);
  }
  process.exitCode = 1;
}
