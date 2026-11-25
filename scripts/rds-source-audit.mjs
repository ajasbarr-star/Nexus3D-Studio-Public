import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const outputPath = path.join(root, 'public', 'rds-source-audit.json');

export function analyzeSource(source, fileName = 'src/App.tsx') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];
  const skeletonHelperVariables = new Set();
  const add = (node, rule, message) => {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({ rule, severity: 'ERROR', file: fileName, line: position.line + 1, message });
  };

  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        ts.isNewExpression(node.initializer)) {
      const expression = node.initializer.expression;
      const constructorName = ts.isPropertyAccessExpression(expression) ? expression.name.text :
        ts.isIdentifier(expression) ? expression.text : '';
      if (constructorName === 'SkeletonHelper') skeletonHelperVariables.add(node.name.text);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'update') {
      const receiver = node.expression.expression;
      const isHelperProperty = ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'helper';
      const isKnownSkeletonHelper = ts.isIdentifier(receiver) && skeletonHelperVariables.has(receiver.text);
      if (isHelperProperty || isKnownSkeletonHelper) {
        add(node, 'THREE_SKELETON_HELPER_UPDATE_API',
          'Potential invalid SkeletonHelper.update() call. Use updateMatrixWorld(true), or rebuild the helper after hierarchy changes.');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const diagnostic of sourceFile.parseDiagnostics) {
    const position = diagnostic.start ?? 0;
    const location = sourceFile.getLineAndCharacterOfPosition(position);
    findings.push({
      rule: 'TYPESCRIPT_PARSE_ERROR',
      severity: 'ERROR',
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
let scannedFiles = 0;
for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  scannedFiles += 1;
  findings.push(...analyzeSource(source, path.relative(root, filePath).split(path.sep).join('/')));
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scanner: 'Nexus3D RDS Source Audit',
  mode: 'static-build-time',
  scannedFiles,
  errors: findings.filter(item => item.severity === 'ERROR').length,
  warnings: findings.filter(item => item.severity === 'WARN').length,
  findings,
  coverage: [
    'TypeScript and TSX syntax parsing',
    'Known Three.js SkeletonHelper.update() API conflict pattern'
  ],
  limitations: [
    'This is a targeted static source audit, not a complete semantic or security analyzer.',
    'Dynamic calls, minified third-party internals, native Android code, and runtime-only failures require separate diagnostics.'
  ]
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(`RDS source audit: ${scannedFiles} file(s), ${report.errors} error(s), ${report.warnings} warning(s).`);
if (report.errors > 0) {
  for (const finding of findings) console.error(`[${finding.severity}] ${finding.file}:${finding.line} ${finding.rule} — ${finding.message}`);
  process.exitCode = 1;
}
