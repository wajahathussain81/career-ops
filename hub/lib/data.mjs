import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join, relative, resolve } from 'path';
import yaml from 'js-yaml';
import {
  isHeaderRow,
  isSeparatorRow,
  parseTrackerRow,
  resolveColumns,
} from '../../tracker-parse.mjs';

const cache = new Map();

function cached(absPath, parseFn) {
  const mtimeMs = statSync(absPath).mtimeMs;
  const hit = cache.get(absPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;

  const value = parseFn(absPath);
  cache.set(absPath, { mtimeMs, value });
  return value;
}

function markdownLinkPath(value) {
  const match = String(value ?? '').match(/\[[^\]]*\]\(([^)]+)\)/);
  return match ? match[1].trim() : null;
}

function markdownCells(line) {
  return line.split('|').slice(1, -1).map(cell => cell.trim());
}

export function loadApplications(root) {
  const absPath = resolve(root, 'data', 'applications.md');
  if (!existsSync(absPath)) return [];

  return cached(absPath, file => {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const colmap = resolveColumns(lines);
    const applications = [];

    for (const line of lines) {
      if (!line.startsWith('|') || isHeaderRow(line) || isSeparatorRow(line)) continue;
      const row = parseTrackerRow(line, colmap);
      if (!row) continue;
      applications.push({
        num: row.num,
        date: row.date,
        company: row.company,
        role: row.role,
        score: row.score || null,
        status: row.status,
        via: row.via || null,
        reportPath: markdownLinkPath(row.report),
        notes: row.notes,
      });
    }

    return applications;
  });
}

export function loadStatusLog(root) {
  const absPath = resolve(root, 'data', 'status-log.tsv');
  if (!existsSync(absPath)) return [];

  return cached(absPath, file => readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const [num, date, from, to, source] = line.split('\t');
      return { num: Number(num), date, from, to, source };
    })
    .filter(row => Number.isFinite(row.num)));
}

export function loadPdfIndex(root) {
  const absPath = resolve(root, 'data', 'pdf-index.tsv');
  if (!existsSync(absPath)) return new Map();

  return cached(absPath, file => {
    const entries = new Map();
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [reportNum, pdf, html, format, date] = line.split('\t');
      entries.set(reportNum, { pdf, html, format, date });
    }
    return entries;
  });
}

export function loadContacts(root) {
  const absPath = resolve(root, 'data', 'contacts.tsv');
  if (!existsSync(absPath)) return [];

  return cached(absPath, file => readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const [name, company, type, title, phone, email, linkedin, tracker, notes] = line.split('\t');
      const trackerNum = Number(tracker);
      return {
        name,
        company,
        type,
        title,
        phone,
        email,
        linkedin,
        tracker: tracker && Number.isFinite(trackerNum) ? trackerNum : null,
        notes,
      };
    }));
}

export function loadFollowUps(root) {
  const absPath = resolve(root, 'data', 'follow-ups.md');
  if (!existsSync(absPath)) return [];

  return cached(absPath, file => {
    const rows = [];
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.startsWith('|') || isSeparatorRow(line)) continue;
      const [num, appNum, date, company, role, channel, contact, notes] = markdownCells(line);
      const parsedNum = Number(num);
      const parsedAppNum = Number(appNum);
      if (!Number.isFinite(parsedNum) || !Number.isFinite(parsedAppNum)) continue;
      rows.push({
        num: parsedNum,
        appNum: parsedAppNum,
        date,
        company,
        role,
        channel,
        contact,
        notes,
      });
    }
    return rows;
  });
}

export function loadPipelineCount(root) {
  const absPath = resolve(root, 'data', 'pipeline.md');
  if (!existsSync(absPath)) return 0;

  return cached(absPath, file => readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(line => /^\s*[-*] /.test(line) || line.includes('http'))
    .length);
}

export function listPrepDirs(root) {
  const absPath = resolve(root, 'interview-prep');
  if (!existsSync(absPath)) return [];

  return cached(absPath, dir => readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'sessions')
    .map(entry => {
      const prepDir = join(dir, entry.name);
      const jdPath = join(prepDir, 'jd.md');
      const resumePath = join(prepDir, 'resume.pdf');
      return {
        slug: entry.name,
        dir: prepDir,
        hasPageYml: existsSync(join(prepDir, 'page.yml')),
        jdPath: existsSync(jdPath) ? jdPath : null,
        resumePath: existsSync(resumePath) ? resumePath : null,
      };
    }));
}

export function loadPrepPage(root, slug) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(slug ?? ''))) return null;
  const absPath = resolve(root, 'interview-prep', slug, 'page.yml');
  if (!existsSync(absPath)) return null;

  return cached(absPath, file => {
    try {
      const parsed = yaml.load(readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA });
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || !parsed.meta || typeof parsed.meta !== 'object' || Array.isArray(parsed.meta)
        || !Array.isArray(parsed.sections)) return null;
      return parsed;
    } catch {
      return null;
    }
  });
}

function findJdFile(root, paddedNum) {
  const dir = resolve(root, 'jds');
  if (!existsSync(dir)) return null;

  const filename = cached(dir, absPath => readdirSync(absPath, { withFileTypes: true })
    .find(entry => entry.isFile() && entry.name.includes(`-${paddedNum}-`))?.name ?? null);
  return filename ? join(dir, filename) : null;
}

function resolveResume(root, appNum, pdf) {
  if (pdf) {
    const indexedPath = resolve(root, pdf.pdf);
    if (existsSync(indexedPath)) {
      return { path: pdf.pdf, exists: true, source: 'pdf-index' };
    }
  }

  const uploadRoot = resolve(root, 'output', 'upload');
  if (existsSync(uploadRoot)) {
    const suffix = `-${appNum}`;
    const uploadDirs = readdirSync(uploadRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.endsWith(suffix))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const uploadDir of uploadDirs) {
      const dirPath = join(uploadRoot, uploadDir.name);
      const resume = readdirSync(dirPath, { withFileTypes: true })
        .filter(entry => entry.isFile()
          && /Resume.*\.pdf$/i.test(entry.name)
          && !/Cover[- ]Letter/i.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))[0];
      if (resume) {
        return {
          path: relative(root, join(dirPath, resume.name)),
          exists: true,
          source: 'upload',
        };
      }
    }
  }

  return pdf ? { path: pdf.pdf, exists: false } : null;
}

export function getApplication(root, num) {
  const appNum = Number(num);
  const app = loadApplications(root).find(item => item.num === appNum);
  if (!app) return null;

  const paddedNum = String(appNum).padStart(3, '0');
  const prepDir = listPrepDirs(root).find(item =>
    item.slug.endsWith(`-${appNum}`) || item.slug.endsWith(`-${paddedNum}`));
  const pdf = loadPdfIndex(root).get(paddedNum);

  let reportFile = null;
  if (app.reportPath) {
    const candidate = resolve(root, 'reports', basename(app.reportPath));
    if (existsSync(candidate)) reportFile = candidate;
  }

  return {
    app,
    timeline: loadStatusLog(root)
      .filter(row => row.num === appNum)
      .sort((a, b) => a.date.localeCompare(b.date)),
    resume: resolveResume(root, appNum, pdf),
    contacts: loadContacts(root).filter(contact => contact.tracker === appNum),
    followUps: loadFollowUps(root).filter(followUp => followUp.appNum === appNum),
    reportFile,
    jdFile: prepDir?.jdPath ?? findJdFile(root, paddedNum),
    prep: prepDir ? { slug: prepDir.slug, dir: prepDir.dir } : null,
  };
}

export function invalidate() {
  cache.clear();
}
