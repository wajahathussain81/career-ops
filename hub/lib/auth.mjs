import { createHash, timingSafeEqual } from 'node:crypto';

export function cookieValue(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function parseCookies(header = '') {
  const cookies = new Map();
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

export function isAuthed(req, token) {
  const supplied = parseCookies(req.headers.cookie).get('hub');
  if (!supplied || !token) return false;

  const actual = Buffer.from(supplied, 'utf8');
  const expected = Buffer.from(cookieValue(token), 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function setAuthCookie(res, token, { secure = false } = {}) {
  const secureAttribute = secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `hub=${cookieValue(token)}; HttpOnly; SameSite=Strict; Path=/${secureAttribute}`);
}
