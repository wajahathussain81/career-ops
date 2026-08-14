#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  getMessageBody,
  isAuthenticEmail,
} from '../../plugins/gmail/_helpers.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_MESSAGES = 50;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CANDIDATES_PATH = path.join(__dirname, '..', '..', 'data', 'reply-candidates.json');

export function buildQuery() {
  return 'newer_than:2d ("application" OR "interview" OR "recruiter" OR "assessment" OR "your candidacy" OR "thank you for applying" OR from:greenhouse.io OR from:lever.co OR from:ashbyhq.com OR from:myworkdayjobs.com OR from:icims.com OR from:smartrecruiters.com OR from:successfactors.com)';
}

function headerValue(headers, name) {
  return headers.find(header => header.name?.toLowerCase() === name)?.value || '';
}

export function messageToCandidate(msg) {
  const headers = Array.isArray(msg?.payload?.headers) ? msg.payload.headers : [];
  const gmailId = msg?.id || '';
  const date = headerValue(headers, 'date');

  return {
    message_id: gmailId || date,
    from: headerValue(headers, 'from'),
    subject: headerValue(headers, 'subject'),
    body_snippet: getMessageBody(msg?.payload),
    signal: null,
    gmailId,
  };
}

export function mergeCandidates(existing, incoming) {
  const merged = [...existing];
  const gmailIds = new Set(
    existing.map(candidate => candidate.gmailId).filter(Boolean),
  );
  const subjectFromPairs = new Set(
    existing.map(candidate => `${candidate.subject || ''}\0${candidate.from || ''}`),
  );
  let appendedCount = 0;

  for (const candidate of incoming) {
    const pair = `${candidate.subject || ''}\0${candidate.from || ''}`;
    if ((candidate.gmailId && gmailIds.has(candidate.gmailId)) || subjectFromPairs.has(pair)) {
      continue;
    }

    merged.push(candidate);
    appendedCount++;
    if (candidate.gmailId) gmailIds.add(candidate.gmailId);
    subjectFromPairs.add(pair);
  }

  return { merged, appendedCount };
}

async function responseJson(response, context) {
  if (!response.ok) {
    throw new Error(`${context}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await responseJson(response, 'Gmail token refresh failed');
  if (!data.access_token) throw new Error('Gmail token refresh returned no access_token');
  return data.access_token;
}

async function listMessageIds(accessToken) {
  const messages = [];
  let pageToken = '';

  do {
    const url = new URL(`${GMAIL_API}/messages`);
    url.searchParams.set('q', buildQuery());
    url.searchParams.set('maxResults', String(MAX_MESSAGES - messages.length));
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await responseJson(response, 'Gmail message list failed');
    if (Array.isArray(data.messages)) {
      messages.push(...data.messages.slice(0, MAX_MESSAGES - messages.length));
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken && messages.length < MAX_MESSAGES);

  return messages;
}

async function fetchMessage(accessToken, id) {
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`);
  url.searchParams.set('format', 'full');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return responseJson(response, `Gmail message fetch failed for ${id}`);
}

function loadCandidates() {
  if (!fs.existsSync(CANDIDATES_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${CANDIDATES_PATH} is not a JSON array`);
  }
  return parsed;
}

function saveCandidates(candidates) {
  fs.mkdirSync(path.dirname(CANDIDATES_PATH), { recursive: true });
  const tmpPath = `${CANDIDATES_PATH}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, CANDIDATES_PATH);
}

async function main() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.log(JSON.stringify({ status: 'no-credentials', fetched: 0, appended: 0 }));
    return;
  }

  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
  const messageIds = await listMessageIds(accessToken);
  const incoming = [];

  for (const { id } of messageIds) {
    const message = await fetchMessage(accessToken, id);
    const headers = message.payload?.headers || [];
    if (!isAuthenticEmail(headers)) continue;
    incoming.push(messageToCandidate(message));
  }

  const existing = loadCandidates();
  const { merged, appendedCount } = mergeCandidates(existing, incoming);
  if (appendedCount > 0) saveCandidates(merged);

  console.log(JSON.stringify({
    status: 'ok',
    fetched: messageIds.length,
    appended: appendedCount,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: 'error', error: error.message }));
    process.exitCode = 1;
  });
}
