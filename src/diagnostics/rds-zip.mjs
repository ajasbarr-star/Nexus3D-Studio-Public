import JSZip from 'jszip';

const REQUIRED_RDS_FILES = [
  'Full_Report.txt',
  'Errors.txt',
  'Warnings.txt',
  'Summary.txt',
  'Metadata.txt'
];

/**
 * Creates the canonical RDS ZIP filename using the Philippine local time
 * at the captured export invocation timestamp. The timestamp is shared
 * with Metadata.txt; it is never regenerated during ZIP creation or saving.
 */
export function buildRdsZipFilename(tool, generatedAt) {
  const executionTime = new Date(generatedAt);
  if (Number.isNaN(executionTime.getTime())) {
    throw new Error('Invalid RDS export timestamp');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
  const parts = formatter.formatToParts(executionTime);
  const part = type => parts.find(item => item.type === type)?.value || '';
  const hour = part('hour');
  const minute = part('minute');
  const dayPeriod = part('dayPeriod').toLowerCase();
  const timePart = hour + '-' + minute + dayPeriod;
  const datePart = [part('month'), part('day'), part('year')].join('-');
  const toolName = String(tool || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  if (!toolName) throw new Error('Invalid RDS ZIP tool name');
  return 'Nexus3D_' + toolName + '_' + timePart + '_' + datePart + '.zip';
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
