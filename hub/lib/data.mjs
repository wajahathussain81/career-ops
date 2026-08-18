import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join, relative, resolve } from 'path';
import * as yaml from 'js-yaml';
import {
  isHeaderRow,
  isSeparatorRow,
  parseTrackerRow,
  resolveColumns,
} from '../../tracker-parse.mjs';

const cache = new Map();
const RESUME_PDF_RE = /Resume.*\.pdf$/i;
const COVER_LETTER_RE = /Cover[- ]Letter/i;

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

export function loadUnifiedContacts(root) {
  const contacts = [];
  const seen = new Set();

  for (const contact of loadContacts(root)) {
    const key = `${String(contact.name).toLowerCase()}|${String(contact.company).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({ ...contact, source: 'contact' });
  }

  for (const followUp of loadFollowUps(root)) {
    const rawContact = String(followUp.contact ?? '').trim();
    if (!rawContact) continue;

    const openParen = rawContact.indexOf('(');
    const name = (openParen === -1 ? rawContact : rawContact.slice(0, openParen)).trim();
    const title = rawContact.match(/\(([^)]*)\)/)?.[1].trim() ?? '';
    const key = `${name.toLowerCase()}|${String(followUp.company).toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    contacts.push({
      name,
      company: followUp.company,
      type: followUp.channel || 'outreach',
      title,
      tracker: followUp.appNum,
      source: 'follow-up',
      date: followUp.date,
      notes: followUp.notes,
    });
  }

  return contacts;
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

  const filenames = cached(dir, absPath => readdirSync(absPath, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name));
  const filename = filenames.find(name => name.includes(`-${paddedNum}-`)) ?? null;
  return filename ? join(dir, filename) : null;
}

function packagePdfs(dirPath) {
  const files = readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    resume: files.find(entry => RESUME_PDF_RE.test(entry.name)
      && !COVER_LETTER_RE.test(entry.name)) ?? null,
    cover: files.find(entry => /\.pdf$/i.test(entry.name)
      && COVER_LETTER_RE.test(entry.name)) ?? null,
  };
}

export function listPackages(root) {
  const uploadRoot = resolve(root, 'output', 'upload');
  if (!existsSync(uploadRoot)) return [];

  const applications = new Map(loadApplications(root).map(app => [app.num, app]));
  return readdirSync(uploadRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const match = entry.name.match(/-(\d+)$/);
      if (!match) return null;
      const num = Number(match[1]);
      const app = applications.get(num);
      const { resume, cover } = packagePdfs(join(uploadRoot, entry.name));
      const reportNum = app?.reportPath
        ? basename(app.reportPath).match(/^(\d+)/)?.[1] ?? null
        : null;
      return {
        num,
        company: app?.company ?? entry.name.slice(0, match.index),
        role: app?.role ?? null,
        status: app?.status ?? null,
        score: app?.score ?? null,
        date: app?.date ?? null,
        hasResume: Boolean(resume),
        hasCover: Boolean(cover),
        reportNum,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.num - a.num);
}

export function listPendingPackages(root) {
  const applications = new Map(loadApplications(root).map(app => [app.num, app]));
  return listPackages(root)
    .filter(row => row.status === 'Evaluated')
    .map(row => {
      const app = applications.get(row.num);
      let applyUrl = null;
      if (app?.reportPath) {
        const reportFile = resolve(root, 'reports', basename(app.reportPath));
        if (existsSync(reportFile)) {
          try {
            const match = readFileSync(reportFile, 'utf8').match(/^\*\*URL:\*\*\s*(.*)$/m);
            const candidate = match?.[1]?.trim() ?? '';
            const parsed = new URL(candidate);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') applyUrl = candidate;
          } catch {
            applyUrl = null;
          }
        }
      }
      return { ...row, applyUrl };
    });
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
      const { resume } = packagePdfs(dirPath);
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

export function resolveCover(root, num) {
  const appNum = Number(num);
  if (!Number.isFinite(appNum)) return null;

  const uploadRoot = resolve(root, 'output', 'upload');
  if (!existsSync(uploadRoot)) return null;

  const suffix = `-${appNum}`;
  const uploadDirs = readdirSync(uploadRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith(suffix))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const uploadDir of uploadDirs) {
    const dirPath = join(uploadRoot, uploadDir.name);
    const { cover } = packagePdfs(dirPath);
    if (cover) {
      return {
        path: relative(root, join(dirPath, cover.name)),
        exists: true,
      };
    }
  }

  return null;
}

export function getApplication(root, num) {
  const appNum = Number(num);
  const app = loadApplications(root).find(item => item.num === appNum);
  if (!app) return null;

  const paddedNum = String(appNum).padStart(3, '0');
  const reportNum = app.reportPath
    ? basename(app.reportPath).match(/^(\d+)/)?.[1] ?? null
    : null;
  const prepDir = listPrepDirs(root).find(item =>
    item.slug.endsWith(`-${appNum}`) || item.slug.endsWith(`-${paddedNum}`));
  const pdfIndex = loadPdfIndex(root);
  const pdf = (reportNum ? pdfIndex.get(reportNum) : null) ?? pdfIndex.get(paddedNum);

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
    jdFile: prepDir?.jdPath
      ?? (reportNum ? findJdFile(root, reportNum) : null)
      ?? findJdFile(root, paddedNum),
    prep: prepDir ? { slug: prepDir.slug, dir: prepDir.dir } : null,
  };
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const HEADING_RE = /^##\s+(.+?)\s*$/;
const Q_HEADING_RE = /^Q\d+$/i;
const CANDIDATE_QUESTIONS_HEADING_RE = /^Candidate Questions$/i;
const INTERVIEWER_LINE_RE = /^\*\*Interviewer:\*\*\s*(.*)$/;
const CANDIDATE_LINE_RE = /^\*\*Candidate:\*\*\s*(.*)$/;
const COMPETENCY_LINE_RE = /^<!--\s*competency:\s*(.*?)\s*-->\s*$/i;

function normalizeSessionDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value ?? '').trim();
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : str;
}

function collapseLines(lines) {
  return lines.map(line => line.trim()).filter(Boolean).join(' ').trim();
}

// Turns a run of raw lines into paragraphs: blank lines are paragraph
// breaks, wrapped lines within a paragraph collapse to a single line.
function joinParagraphs(lines) {
  const paragraphs = [];
  let current = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) { paragraphs.push(collapseLines(current)); current = []; }
      continue;
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(collapseLines(current));
  return paragraphs.filter(Boolean).join('\n\n');
}

function parseSessionBody(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const turns = [];
  const candidateQuestions = [];
  let section = null;
  let hasQHeading = false;
  let i = 0;

  while (i < lines.length) {
    const heading = lines[i].match(HEADING_RE);
    if (heading) {
      const title = heading[1].trim();
      if (Q_HEADING_RE.test(title)) { section = 'q'; hasQHeading = true; }
      else if (CANDIDATE_QUESTIONS_HEADING_RE.test(title)) section = 'candidate-questions';
      else section = null;
      i++;
      continue;
    }

    if (section === 'q') {
      const interviewerMatch = lines[i].match(INTERVIEWER_LINE_RE);
      if (interviewerMatch) {
        const qLines = [interviewerMatch[1]];
        i++;
        while (i < lines.length && !COMPETENCY_LINE_RE.test(lines[i])
          && !CANDIDATE_LINE_RE.test(lines[i]) && !HEADING_RE.test(lines[i])) {
          qLines.push(lines[i]);
          i++;
        }
        const q = collapseLines(qLines);

        let competencies = [];
        if (i < lines.length) {
          const competencyMatch = lines[i].match(COMPETENCY_LINE_RE);
          if (competencyMatch) {
            competencies = competencyMatch[1].split(',').map(tag => tag.trim()).filter(Boolean);
            i++;
          }
        }

        let a = '';
        if (i < lines.length) {
          const candidateMatch = lines[i].match(CANDIDATE_LINE_RE);
          if (candidateMatch) {
            const aLines = [candidateMatch[1]];
            i++;
            while (i < lines.length && !HEADING_RE.test(lines[i]) && !INTERVIEWER_LINE_RE.test(lines[i])) {
              aLines.push(lines[i]);
              i++;
            }
            a = joinParagraphs(aLines);
          }
        }

        if (q) turns.push({ q, competencies, a });
        continue;
      }
    }

    if (section === 'candidate-questions') {
      const candidateMatch = lines[i].match(CANDIDATE_LINE_RE);
      if (candidateMatch) {
        const qLines = [candidateMatch[1]];
        i++;
        while (i < lines.length && !CANDIDATE_LINE_RE.test(lines[i]) && !HEADING_RE.test(lines[i])) {
          qLines.push(lines[i]);
          i++;
        }
        const text = collapseLines(qLines);
        if (text) candidateQuestions.push(text);
        continue;
      }
    }

    i++;
  }

  return { turns, candidateQuestions, hasQHeading };
}

function parseSessionFile(absPath, slug) {
  let raw;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }

  const match = raw.match(FRONT_MATTER_RE);
  if (!match) return null;

  let meta;
  try {
    meta = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  } catch {
    return null;
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;

  const { turns, candidateQuestions, hasQHeading } = parseSessionBody(match[2] ?? '');
  if (!hasQHeading) return null;

  return {
    slug,
    file: absPath,
    company: meta.company != null ? String(meta.company) : '',
    role: meta.role != null ? String(meta.role) : '',
    round: meta.round != null ? String(meta.round) : '',
    date: normalizeSessionDate(meta.date),
    interviewerRole: meta.interviewer_role != null ? String(meta.interviewer_role) : '',
    source: meta.source != null ? String(meta.source) : '',
    turns,
    candidateQuestions,
  };
}

export function listSessions(root) {
  const absPath = resolve(root, 'interview-prep', 'sessions');
  if (!existsSync(absPath)) return [];

  const filenames = cached(absPath, dir => readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'README.md')
    .map(entry => entry.name)
    .sort());

  const sessions = filenames
    .map(filename => {
      const filePath = join(absPath, filename);
      if (!existsSync(filePath)) return null;
      return cached(filePath, file => parseSessionFile(file, filename.slice(0, -3)));
    })
    .filter(Boolean);

  sessions.sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });

  return sessions;
}

export function normalizeSlugPart(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Fuzzy match used to relate a session's company to a prep-dir slug (e.g.
// "Magnet Forensics" <-> "magnetforensics-sdet-hiring-manager-2026-08-12").
export function sessionMatchesPrepSlug(company, slug) {
  const normCompany = normalizeSlugPart(company);
  const normSlug = normalizeSlugPart(slug);
  if (!normCompany || !normSlug) return false;
  return normSlug.includes(normCompany) || normCompany.includes(normSlug);
}

export function invalidate() {
  cache.clear();
}
