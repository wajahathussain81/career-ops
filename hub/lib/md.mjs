function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

export function safeUrl(href) {
  const value = String(href ?? '').replace(/^[\s\u0000-\u001f\u007f-\u009f]+|[\s\u0000-\u001f\u007f-\u009f]+$/g, '');
  const decoded = value.replaceAll('&amp;', '&').replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  const normalized = decoded.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, '');
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
  return scheme && !SAFE_SCHEMES.has(scheme) ? null : value;
}

function inline(src) {
  const code = [];
  const links = [];
  let value = src.replace(/`([^`\n]+)`/g, (_match, body) => {
    code.push(`<code>${body}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
    const safeHref = safeUrl(href);
    links.push(safeHref === null ? text : `<a href="${safeHref}">${text}</a>`);
    return `\u0000LINK${links.length - 1}\u0000`;
  });
  value = value.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\u0000LINK(\d+)\u0000/g, (_match, index) => links[Number(index)]);
  return value.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => code[Number(index)]);
}

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isSeparator(line) {
  const row = cells(line);
  return row.length > 0 && row.every(cell => /^:?-{3,}:?$/.test(cell));
}

function isTable(lines, index) {
  return lines[index]?.includes('|') && isSeparator(lines[index + 1] ?? '');
}

function isBlock(lines, index) {
  const line = lines[index] ?? '';
  return /^#{1,4}\s+/.test(line) || /^```/.test(line) || /^\s*-\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line) || isTable(lines, index);
}

export function mdToHtml(src) {
  const lines = escapeHtml(src).replaceAll('\r\n', '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      if (i < lines.length) i++;
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (isTable(lines, i)) {
      const headers = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="table-scroll"><table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const list = line.match(/^\s*(-|\d+\.)\s+(.+)$/);
    if (list) {
      const ordered = list[1] !== '-';
      const tag = ordered ? 'ol' : 'ul';
      const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*-\s+(.+)$/;
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(pattern);
        if (!item) break;
        items.push(`<li>${inline(item[1])}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlock(lines, i)) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
