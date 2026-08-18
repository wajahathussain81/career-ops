(function ansiRenderer(globalScope) {
  'use strict';

  const BASIC_NAMES = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'bright-black', 'bright-red', 'bright-green', 'bright-yellow',
    'bright-blue', 'bright-magenta', 'bright-cyan', 'bright-white',
  ];

  const BASIC_RGB = [
    [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16],
    [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
    [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67],
    [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
  ];

  function escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function indexedRgb(index) {
    if (index < 16) return BASIC_RGB[index];
    if (index < 232) {
      const offset = index - 16;
      const levels = [0, 95, 135, 175, 215, 255];
      return [
        levels[Math.floor(offset / 36)],
        levels[Math.floor((offset % 36) / 6)],
        levels[offset % 6],
      ];
    }
    const gray = 8 + ((index - 232) * 10);
    return [gray, gray, gray];
  }

  function nearestBasicName(index) {
    const rgb = indexedRgb(Math.max(0, Math.min(255, index)));
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < BASIC_RGB.length; candidate += 1) {
      const palette = BASIC_RGB[candidate];
      const nextDistance = ((rgb[0] - palette[0]) ** 2)
        + ((rgb[1] - palette[1]) ** 2)
        + ((rgb[2] - palette[2]) ** 2);
      if (nextDistance < distance) {
        distance = nextDistance;
        nearest = candidate;
      }
    }
    return BASIC_NAMES[nearest];
  }

  function collapseCarriageReturns(value) {
    return value.split('\n').map((line) => {
      const finalRewrite = line.lastIndexOf('\r');
      return finalRewrite === -1 ? line : line.slice(finalRewrite + 1);
    }).join('\n');
  }

  function createAnsiRenderer() {
    const state = { bold: false, color: null };
    let pending = '';

    const applySgr = (parameters) => {
      const rawCodes = parameters.split(';');
      const codes = rawCodes.map(code => Number.parseInt(code || '0', 10));
      for (let index = 0; index < codes.length; index += 1) {
        const code = codes[index];
        if (code === 0) {
          state.bold = false;
          state.color = null;
        } else if (code === 1) state.bold = true;
        else if (code === 22) state.bold = false;
        else if (code === 39) state.color = null;
        else if (code >= 30 && code <= 37) state.color = BASIC_NAMES[code - 30];
        else if (code >= 90 && code <= 97) state.color = BASIC_NAMES[(code - 90) + 8];
        else if (code === 38 && codes[index + 1] === 5 && Number.isFinite(codes[index + 2])) {
          state.color = nearestBasicName(codes[index + 2]);
          index += 2;
        } else if (code === 38 && codes[index + 1] === 2) {
          index += Math.min(4, codes.length - index - 1);
        }
      }
    };

    return {
      push(chunk) {
        const value = collapseCarriageReturns(pending + String(chunk ?? ''));
        pending = '';
        let output = '';
        let cursor = 0;

        const appendText = (text) => {
          if (!text) return;
          const escaped = escapeHtml(text);
          const classes = [state.bold ? 'a-bold' : '', state.color ? `a-${state.color}` : '']
            .filter(Boolean);
          output += classes.length
            ? `<span class="${classes.join(' ')}">${escaped}</span>`
            : escaped;
        };

        while (cursor < value.length) {
          const escapeIndex = value.indexOf('\x1B', cursor);
          if (escapeIndex === -1) {
            appendText(value.slice(cursor));
            break;
          }
          appendText(value.slice(cursor, escapeIndex));
          if (escapeIndex + 1 >= value.length) {
            pending = value.slice(escapeIndex);
            break;
          }

          const control = value[escapeIndex + 1];
          if (control === ']') {
            const bel = value.indexOf('\x07', escapeIndex + 2);
            const stringTerminator = value.indexOf('\x1B\\', escapeIndex + 2);
            const terminator = bel === -1
              ? stringTerminator
              : stringTerminator === -1 ? bel : Math.min(bel, stringTerminator);
            if (terminator === -1) {
              pending = value.slice(escapeIndex);
              break;
            }
            cursor = terminator + (terminator === bel ? 1 : 2);
            continue;
          }

          if (control === 'P' || control === '^' || control === '_') {
            const terminator = value.indexOf('\x1B\\', escapeIndex + 2);
            if (terminator === -1) {
              pending = value.slice(escapeIndex);
              break;
            }
            cursor = terminator + 2;
            continue;
          }

          if (control === '[') {
            let finalIndex = escapeIndex + 2;
            while (finalIndex < value.length) {
              const code = value.charCodeAt(finalIndex);
              if (code >= 0x40 && code <= 0x7e) break;
              finalIndex += 1;
            }
            if (finalIndex >= value.length) {
              pending = value.slice(escapeIndex);
              break;
            }
            if (value[finalIndex] === 'm') {
              applySgr(value.slice(escapeIndex + 2, finalIndex));
            }
            cursor = finalIndex + 1;
            continue;
          }

          cursor = escapeIndex + 2;
        }
        return output;
      },
    };
  }

  function ansiToHtml(input) {
    return createAnsiRenderer().push(input);
  }

  if (globalScope) {
    globalScope.ansiToHtml = ansiToHtml;
    globalScope.createAnsiRenderer = createAnsiRenderer;
  }
  if (typeof module !== 'undefined') module.exports = { ansiToHtml, createAnsiRenderer };
}(typeof window !== 'undefined' ? window : null));
