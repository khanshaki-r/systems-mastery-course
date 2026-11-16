// Convert ANSI SGR colour codes (as emitted by GCC, Clang and the sanitizers) into HTML spans.
import { esc } from './util.js';

const COLORS = ['#6e7681', '#ff7b72', '#7ee787', '#e3b341', '#79c0ff', '#d2a8ff', '#76e3ea', '#e6edf3'];
const BRIGHT = ['#8b949e', '#ffa198', '#a5f0b0', '#f2cc60', '#a5d6ff', '#e2c5ff', '#b3f0ff', '#ffffff'];

const ANSI_RE = /\x1b\[([0-9;]*)m|\x1b\[K/g;

export function stripAnsi(s) { return String(s ?? '').replace(ANSI_RE, ''); }

export function ansiToHtml(s) {
  s = String(s ?? '');
  let out = '';
  let last = 0;
  let open = false;
  let state = { bold: false, fg: null };
  const flush = (text) => { out += esc(text); };
  const style = () => {
    const parts = [];
    if (state.fg) parts.push(`color:${state.fg}`);
    if (state.bold) parts.push('font-weight:600');
    return parts.join(';');
  };
  s.replace(ANSI_RE, (m, codes, idx) => {
    flush(s.slice(last, idx));
    last = idx + m.length;
    if (codes === undefined) return m; // \x1b[K erase-line: ignore
    const list = codes === '' ? [0] : codes.split(';').map(Number);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === 0) state = { bold: false, fg: null };
      else if (c === 1) state.bold = true;
      else if (c === 22) state.bold = false;
      else if (c >= 30 && c <= 37) state.fg = (state.bold ? BRIGHT : COLORS)[c - 30];
      else if (c === 39) state.fg = null;
      else if (c >= 90 && c <= 97) state.fg = BRIGHT[c - 90];
      else if (c === 38 && list[i + 1] === 5) { i += 2; }
    }
    if (open) { out += '</span>'; open = false; }
    const st = style();
    if (st) { out += `<span style="${st}">`; open = true; }
    return m;
  });
  flush(s.slice(last));
  if (open) out += '</span>';
  return out;
}
