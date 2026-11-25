import JSZip from 'jszip';

const REQUIRED_RDS_FILES = [
  'Full_Report.txt',
  'Errors.txt',
  'Warnings.txt',
  'Summary.txt',
  'Metadata.txt'
];

export function buildRdsZipFilename(tool, generatedAt) {
  const localGeneratedAt = new Date(generatedAt);
  if (Number.isNaN(localGeneratedAt.getTime())) {
    throw new Error('Invalid RDS export timestamp');
  }
  const timePart = localGeneratedAt
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\\s+/g, '')
    .toLowerCase()
    .replace(/:/g, '-');
  const datePart = [
    String(localGeneratedAt.getMonth() + 1).padStart(2, '0'),
    String(localGeneratedAt.getDate()).padStart(2, '0'),
    localGeneratedAt.getFullYear()
  ].join('-');
  const toolPart = 'Nexus3D_' + String(tool).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return toolPart + '_' + timePart + '_' + datePart + '.zip';
}

export function createRdsZipArchive(exportFiles) {
  const names = Object.keys(exportFiles || {}).sort();
  const expected = [...REQUIRED_RDS_FILES].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new Error('RDS ZIP must contain exactly the five required TXT reports');
  }

  const zip = new JSZip();
  for (const name of REQUIRED_RDS_FILES) {
    const content = exportFiles[name];
    if (typeof content !== 'string') {
      throw new Error('RDS ZIP report must be UTF-8 text: ' + name);
    }
    zip.file(name, content, { createFolders: false });
  }
  return zip;
}

export function getRequiredRdsZipFiles() {
  return [...REQUIRED_RDS_FILES];
}
