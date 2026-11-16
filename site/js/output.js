// Rendering of run results shared by the module reader, the IDE and exercises.
import { h, esc, normOut } from './util.js';
import { ansiToHtml } from './ansi.js';
import { describeExit } from './runners/godbolt.js';

// ---------- expected-output comparison ----------
// Values that legitimately differ between machines: addresses, PIDs, timings.
const ADDR = /0x[0-9a-fA-F]{5,}/g;
function prepExpected(text) {
  return normOut(text).split('\n').filter(l => !/^\$ /.test(l)).join('\n');
}
function soft(s) { return s.replace(ADDR, '0x…'); }

export function compareOutput(actual, expected) {
  const a = normOut(actual).split('\n');
  const e = prepExpected(expected).split('\n');
  const n = Math.max(a.length, e.length);
  const rows = [];
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const ok = soft(a[i] ?? '') === soft(e[i] ?? '');
    if (!ok) bad++;
    rows.push({ a: a[i] ?? '', e: e[i] ?? '', ok });
  }
  const exact = normOut(actual) === prepExpected(expected);
  return { match: bad === 0, exact, bad, total: n, rows };
}

export function diffView(rows, labels = ['Expected', 'Your output']) {
  const el = h('div', { class: 'diff' }, h('div', { class: 'h' }, labels[0]), h('div', { class: 'h' }, labels[1]));
  rows.slice(0, 400).forEach(r => {
    el.append(h('div', { class: 'l' + (r.ok ? '' : ' bad') }, r.e || ' '), h('div', { class: 'l' + (r.ok ? '' : ' bad') }, r.a || ' '));
  });
  return el;
}

export function verdictEl(cmp) {
  if (cmp.match) {
    return h('div', { class: 'verdict ok' }, h('span', {}, '✓'), h('div', { class: 'v-body' },
      cmp.exact ? 'Output matches the expected output in this module.' : 'Output matches the expected output (memory addresses differ, as the module says they will).'));
  }
  return h('div', { class: 'verdict warn' }, h('span', {}, '≠'), h('div', { class: 'v-body' },
    `Output differs from the module's expected output on ${cmp.bad} of ${cmp.total} lines. Values the module marks as machine-specific (addresses, PIDs, timings, sizes on other platforms) can legitimately differ.`,
    h('details', {}, h('summary', {}, 'Show line-by-line comparison'), diffView(cmp.rows))));
}

// ---------- console output for C/C++ ----------
const LOC_RE = /((?:[\w.\-]+\/)*[\w.\-]+\.(?:c|cc|cpp|cxx|h|hpp)):(\d+)(?::(\d+))?/g;

function linkify(html, files, onJump) {
  if (!onJump) return html;
  return html.replace(LOC_RE, (m, file, line, col) => {
    const base = file.split('/').pop();
    if (!files.includes(base)) return m;
    return `<a class="src-link" data-file="${esc(base)}" data-line="${line}" data-col="${col || 1}">${m}</a>`;
  });
}

/** Render a godbolt run result into a <pre class="console">. */
export function consoleFor(res, { files = [], onJump, compilerName = '' } = {}) {
  const pre = h('pre', { class: 'console' });
  let html = '';
  const meta = (t) => { html += `<span class="meta">${esc(t)}</span>\n`; };
  meta(`$ ${compilerName ? compilerName + ' ' : ''}${res.flags}${res.mode === 'cmake' ? '   (multi-file build via CMake)' : ''}`);
  if (res.note) meta(`note: ${res.note}`);
  if (res.buildRaw && res.buildRaw.trim()) {
    const buildShown = res.mode === 'cmake' ? res.buildRaw.split('\n').filter(l => !/^-- |^\[\s*\d+%\]|gmake|^Consolidate compiler/.test(l)).join('\n') : res.buildRaw;
    if (buildShown.trim()) html += linkify(ansiToHtml(buildShown), files, onJump) + '\n';
  }
  if (!res.built) {
    html += `<span class="err">✗ Build failed${res.timedOut ? ' (compiler timed out)' : ''}. Fix the errors above (see the Problems tab).</span>\n`;
  } else if (!res.didExecute) {
    html += `<span class="err">Built, but the program did not run. ${res.timedOut ? 'It hit the time limit.' : 'The executor may be busy; try again.'}</span>\n`;
  } else {
    if (res.stdout) html += esc(res.stdout) + (res.stdout.endsWith('\n') ? '' : '\n');
    if (res.stderrRaw && res.stderrRaw.trim()) html += `<span class="err">${linkify(ansiToHtml(res.stderrRaw), files, onJump)}</span>\n`;
    const code = res.exitCode;
    const cls = code === 0 ? 'okc' : 'err';
    html += `<span class="meta">─────</span>\n<span class="${cls}">Program exited with code ${esc(describeExit(code))}</span><span class="meta">   ·   ${(res.ms / 1000).toFixed(1)} s round trip${res.timedOut ? '   ·   TIME LIMIT HIT' : ''}${res.truncated ? '   ·   output truncated' : ''}</span>\n`;
  }
  pre.innerHTML = html;
  if (onJump) pre.addEventListener('click', (e) => {
    const a = e.target.closest('.src-link');
    if (a) onJump(a.dataset.file, +a.dataset.line, +a.dataset.col);
  });
  return pre;
}

// ---------- SQL results ----------
export function sqlResultEl(out) {
  const wrap = h('div', { class: 'sql-out' });
  if (out.meta && out.meta.length) {
    wrap.append(h('div', { class: 'sql-msg notice' }, `Skipped psql meta-commands (they only work in the psql client): ${out.meta.join('  ')}`));
  }
  if (!out.results.length && !out.error) wrap.append(h('div', { class: 'sql-msg' }, 'No statements to run.'));
  for (const r of out.results) {
    const box = h('div');
    const first = r.sql.split('\n')[0];
    box.append(h('div', { class: 'sql-stmt', html: `<b>${esc(r.command || 'SQL')}</b>  ${esc(first.length > 110 ? first.slice(0, 110) + '…' : first)}${r.sql.includes('\n') ? ' …' : ''}` }));
    r.notices.forEach(nt => box.append(h('div', { class: 'sql-msg notice' }, nt)));
    if (r.fields.length) {
      const t = h('table', { class: 'rtable' });
      t.append(h('tr', {}, r.fields.map(f => h('th', {}, f))));
      r.rows.slice(0, 500).forEach(row => t.append(h('tr', {}, row.map(v => v === null ? h('td', { class: 'null' }, 'NULL') : h('td', {}, v)))));
      box.append(h('div', { style: { overflowX: 'auto' } }, t));
      box.append(h('div', { class: 'sql-msg' }, `(${r.rows.length} row${r.rows.length === 1 ? '' : 's'}${r.rows.length > 500 ? ', first 500 shown' : ''})  ${r.ms.toFixed(1)} ms`));
    } else {
      box.append(h('div', { class: 'sql-msg' }, `${r.command || 'OK'}${r.affected !== null && /INSERT|UPDATE|DELETE|MERGE/.test(r.command) ? ` ${r.affected}` : ''}  ·  ${r.ms.toFixed(1)} ms`));
    }
    wrap.append(box);
  }
  if (out.error) {
    const e = out.error;
    e.notices && e.notices.forEach(nt => wrap.append(h('div', { class: 'sql-msg notice' }, nt)));
    wrap.append(h('div', { class: 'sql-msg err' }, `ERROR: ${e.message}`));
    if (e.detail) wrap.append(h('div', { class: 'sql-msg err' }, `DETAIL: ${e.detail}`));
    if (e.hint) wrap.append(h('div', { class: 'sql-msg' }, `HINT: ${e.hint}`));
    wrap.append(h('div', { class: 'sql-msg' }, `at line ${e.line}, column ${e.col}. Statements before this one ran; this one and the rest did not.`));
  }
  return wrap;
}

// ---------- Python Tutor (step-by-step execution with stack and heap drawings) ----------
const TUTOR_LANG = { c: 'c_gcc9.3.0', cpp: 'cpp_g++9.3.0', python: '3' };
export const TUTOR_LIMIT = 5600;   // Python Tutor rejects code longer than this many URL-encoded bytes

// Shrink code for the visualiser without moving any line: comments become blank,
// trailing spaces go, and 4-space indentation becomes 2. Line N stays line N.
export function compactForTutor(lang, code) {
  if (lang === 'python') return code.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i], d = code[i + 1];
    if (c === '"' || c === "'") {                        // copy string/char literals verbatim
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      out += code.slice(i, j + 1); i = j; continue;
    }
    if (c === '/' && d === '/') { while (i < code.length && code[i] !== '\n') i++; i--; continue; }
    if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      const body = code.slice(i, end === -1 ? code.length : end + 2);
      out += '\n'.repeat((body.match(/\n/g) || []).length);
      i = (end === -1 ? code.length : end + 2) - 1; continue;
    }
    out += c;
  }
  return out.split('\n').map(l => l.replace(/\s+$/, '').replace(/^((?: {4})+)/, s => ' '.repeat(s.length / 2))).join('\n');
}
export function tutorTooLong(lang, code) {
  const n = encodeURIComponent(compactForTutor(lang, code)).length;
  return n > TUTOR_LIMIT ? n : 0;
}

export function tutorUrl(lang, code, { stdin = '', embed = true } = {}) {
  code = compactForTutor(lang, code);
  const inputs = lang === 'python' ? String(stdin).split('\n').filter((l, i, a) => i < a.length - 1 || l !== '') : [];
  const parts = {
    code,
    codeDivHeight: '400',
    codeDivWidth: '350',
    cumulative: 'false',
    curInstr: '0',
    heapPrimitives: 'nevernest',
    origin: 'opt-frontend.js',
    py: TUTOR_LANG[lang],
    rawInputLstJSON: JSON.stringify(inputs),
    textReferences: 'false',
  };
  if (!embed) parts.mode = 'display';
  const hash = Object.entries(parts).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://pythontutor.com/${embed ? 'iframe-embed' : 'visualize'}.html#${hash}`;
}

export function tutorWarnings(lang, code) {
  const w = [];
  if (lang !== 'python' && /\b(scanf|fgets|getchar|std::cin|cin\s*>>|getline)\b/.test(code)) w.push('This program reads input; the visualiser cannot provide stdin for C/C++, so reads will see end-of-file.');
  if (/<thread>|pthread_create|std::thread|<mutex>|<atomic>/.test(code)) w.push('Threads are not supported by the visualiser; use Run with ThreadSanitizer instead.');
  if (/<sys\/socket\.h>|fork\s*\(|<unistd\.h>/.test(code) && lang !== 'python') w.push('System calls such as fork and sockets are not supported by the visualiser.');
  if (code.split('\n').length > 120) w.push('Long program: the visualiser stops after about 1000 steps. Trim it to the part you want to watch.');
  if (lang !== 'python') w.push('Comments are stripped before visualising (line numbers stay the same).');
  if (lang === 'cpp' && /\b(std::optional|std::variant|std::string_view|if constexpr|auto\s*\[)/.test(code)) w.push('The visualiser uses GCC 9.3; very new C++17/20 features may not compile there.');
  return w;
}

// ---------- struct layout ----------
const FIELD_COLORS = ['#93c5fd', '#86efac', '#fcd34d', '#f9a8d4', '#c4b5fd', '#5eead4', '#fdba74', '#a5b4fc', '#bef264', '#fda4af'];

export function layoutEl(records) {
  const wrap = h('div', { class: 'layout-wrap' });
  if (!records.length) {
    wrap.append(h('div', { class: 'pane-empty' }, h('h4', {}, 'No struct, class or union found'),
      'Define a struct in your code (for example ', h('code', {}, 'struct Loan { char type; double amount; int term; };'), ') and press Layout again to see every byte, field and padding hole.'));
    return wrap;
  }
  for (const r of records) {
    const sec = h('div', { class: 'rec' });
    const wasted = r.padding;
    sec.append(h('h4', {}, `${r.kind} ${r.name}`));
    sec.append(h('div', { class: 'sub' }, `sizeof = ${r.sizeof} bytes · alignment = ${r.align} · padding = ${+wasted.toFixed(2)} byte${wasted === 1 ? '' : 's'}${r.sizeof ? ` (${Math.round(100 * wasted / r.sizeof)}% of the object)` : ''}`));
    const owner = new Array(r.sizeof).fill(-1);
    r.fields.forEach((f, i) => {
      const size = f.size === null ? r.sizeof - f.off : Math.max(f.size, f.sharesWithNext || f.bitLo !== null ? 1 : 0);
      for (let b = f.off; b < Math.min(r.sizeof, f.off + size); b++) if (owner[b] === -1) owner[b] = i;
    });
    if (r.sizeof <= 256) {
      const grid = h('div', { class: 'bytes' });
      for (let row = 0; row < Math.ceil(r.sizeof / 8); row++) {
        grid.append(h('div', { class: 'off' }, `+${row * 8}`));
        for (let c = 0; c < 8; c++) {
          const b = row * 8 + c;
          if (b >= r.sizeof) { grid.append(h('div')); continue; }
          const o = owner[b];
          if (o === -1) grid.append(h('div', { class: 'b pad', title: `byte ${b}: padding (wasted)` }, 'pad'));
          else {
            const f = r.fields[o];
            const firstByte = b === f.off || (c === 0);
            grid.append(h('div', { class: 'b', style: { background: FIELD_COLORS[o % FIELD_COLORS.length] }, title: `byte ${b}: ${f.decl}` }, firstByte ? f.name : ''));
          }
        }
      }
      sec.append(grid);
    } else {
      sec.append(h('div', { class: 'sub' }, 'Large object: byte grid hidden; see the field table.'));
    }
    const t = h('table', { class: 'legend' }, h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Type'), h('th', {}, 'Offset'), h('th', {}, 'Size')));
    r.fields.forEach((f, i) => t.append(h('tr', {},
      h('td', {}, h('span', { class: 'sw', style: { background: FIELD_COLORS[i % FIELD_COLORS.length] } }), f.name),
      h('td', {}, f.type || '—'),
      h('td', {}, f.bitLo !== null ? `${f.off} (bits ${f.bitLo}-${f.bitHi})` : String(f.off)),
      h('td', {}, f.size === null ? '—' : (f.bitLo !== null ? `${f.bitHi - f.bitLo + 1} bits` : `${f.size}`)))));
    sec.append(t);
    if (wasted >= 2 && r.kind !== 'union') sec.append(h('div', { class: 'sub', style: { marginTop: '8px' } }, 'Tip: ordering fields from largest alignment to smallest usually removes most padding (module 1.07).'));
    wrap.append(sec);
  }
  return wrap;
}
