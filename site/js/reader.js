// Course reader: renders a module's Markdown and turns its code blocks into runnable cells.
import { Marked } from 'https://cdn.jsdelivr.net/npm/marked@18.1.1/lib/marked.esm.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.4.17/dist/purify.es.mjs';
import { h, esc, fetchText, CONTENT_ROOT, REPO_URL, copyText, isDark } from './util.js';
import { runProgram, defaultFlags, sanitizeFlags, COMPILERS } from './runners/godbolt.js';
import { runSql } from './runners/sql.js';
import { runPython } from './runners/python.js';
import { getDb } from './sqlsession.js';
import { consoleFor, compareOutput, verdictEl, sqlResultEl, tutorUrl, tutorWarnings, tutorTooLong, TUTOR_LIMIT } from './output.js';

const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.esm.min.mjs';

// ---------- language normalisation ----------
const LANG_KIND = {
  c: 'c', h: 'c',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  sql: 'sql', pgsql: 'sql', plpgsql: 'sql', postgresql: 'sql', psql: 'sql',
  python: 'python', py: 'python', python3: 'python',
  bash: 'bash', sh: 'bash', shell: 'bash', console: 'bash', zsh: 'bash',
  text: 'text', txt: 'text', output: 'text', '': 'text', plaintext: 'text',
};
const HL_ALIAS = { c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp', sql: 'pgsql', pgsql: 'pgsql', plpgsql: 'pgsql', asm: 'x86asm', nasm: 'x86asm', make: 'makefile', bat: 'dos', cmd: 'dos', console: 'bash', sh: 'bash', shell: 'bash', ps1: 'powershell', yml: 'yaml', txt: 'plaintext', text: 'plaintext' };

const FILE_RE = /^\s*(?:\/\/+|\/\*+|#|--)\s*((?:[\w.-]+\/)*[\w.-]+\.(?:c|cc|cpp|cxx|h|hpp|sql|py|txt))\b/i;
const MAIN_RE = /\bint\s+main\s*\(/;
const STDIN_RE = /\b(scanf|getchar|fgetc\s*\(\s*stdin|fgets\s*\([^)]*stdin|getline\s*\(|std::cin|cin\s*>>|read\s*\(\s*(0|STDIN_FILENO))/;
const NEEDS_LAB = [
  [/#include\s*<db\.h>/, 'Berkeley DB (libdb)'],
  [/#include\s*<libpq-fe\.h>|#include\s*<pqxx/, 'the PostgreSQL client library'],
  [/#include\s*<hiredis/, 'the Redis client library'],
  [/#include\s*<windows\.h>|#include\s*<Windows\.h>|\bWINAPI\b/, 'Windows (build it in Visual Studio, module 0.06)'],
  [/#include\s*<gtest\/gtest\.h>|#include\s*<gmock/, 'GoogleTest from your lab'],
  [/#include\s*<liburing\.h>/, 'liburing'],
];
const NET_RE = /#include\s*<(sys\/socket\.h|netinet\/in\.h|arpa\/inet\.h)>/;

function ghSlugger() {
  const seen = {};
  return (text) => {
    let s = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    if (seen[s] !== undefined) { seen[s]++; s = `${s}-${seen[s]}`; } else seen[s] = 0;
    return s;
  };
}
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function resolvePath(base, rel) {
  const u = new URL(rel, 'https://x.invalid/' + base);
  return { path: decodeURIComponent(u.pathname.slice(1)), hash: u.hash ? decodeURIComponent(u.hash.slice(1)) : '' };
}

// ---------- compile command parsing ----------
function joinContinuations(text) { return text.replace(/\\\r?\n\s*/g, ' '); }

export function parseCommands(bash) {
  const cmds = [];
  let stdin = null, args = null;
  let compileFlags = '';   // flags from "gcc -c" steps (make output), reused for the link step
  for (let line of joinContinuations(bash).split('\n')) {
    line = line.replace(/^\s*\$\s*/, '').replace(/\s+#.*$/, '').trim();
    const m = line.match(/^(gcc|g\+\+|clang\+\+|clang|cc|c\+\+)(?:-\d+)?\s+(.*)$/);
    if (m) {
      const driver = m[1];
      let rest = m[2];
      const toks = rest.split(/\s+/);
      if (toks.includes('-E') || toks.includes('-S')) continue;
      if (toks.includes('-c')) { if (!compileFlags) compileFlags = rest; continue; }
      const sources = toks.filter(t => /\.(c|cc|cpp|cxx|o)$/.test(t)).map(t => t.replace(/^.*\//, ''));
      if (!sources.length) continue;
      if (sources.some(s => s.endsWith('.o')) && compileFlags && !/-std=/.test(rest)) rest = `${compileFlags} ${rest}`;
      const cpp = /\+\+/.test(driver) || sources.some(s => /\.(cc|cpp|cxx)$/.test(s));
      const lang = cpp ? 'cpp' : 'c';
      const family = /clang/.test(driver) ? 'clang' : 'gcc';
      const compiler = family === 'clang' ? (lang === 'c' ? 'cclang2110' : 'clang2110') : (lang === 'c' ? 'cg133' : 'g133');
      cmds.push({ line, driver, lang, compiler, sources, flags: sanitizeFlags(rest) });
      continue;
    }
    const pipe = line.match(/^(echo|printf)\s+(['"])([\s\S]*?)\2\s*\|\s*\.\//);
    if (pipe && stdin === null) {
      stdin = pipe[1] === 'printf' ? pipe[3].replace(/\\n/g, '\n').replace(/\\t/g, '\t') : pipe[3] + '\n';
      continue;
    }
    const run = line.match(/^\.\/[\w.-]+\s+([^|<>&;]+)$/);
    if (run && args === null) args = run[1].trim().split(/\s+/).map(a => a.replace(/^['"]|['"]$/g, ''));
  }
  return { cmds, stdin, args };
}

// ---------- annotate code tokens with run metadata ----------
function annotate(tokens, marked) {
  const codes = [];
  let lastPara = '';
  marked.walkTokens(tokens, (t) => {
    if (t.type === 'paragraph' || t.type === 'heading') lastPara = t.text || '';
    if (t.type === 'code') {
      const raw = (t.lang || '').trim().split(/\s+/)[0].toLowerCase();
      t._prev = lastPara;
      t._raw = raw;
      t._kind = LANG_KIND[raw] || 'other';
      const fm = t.text.split('\n').slice(0, 3).join('\n').match(FILE_RE);
      t._file = fm ? fm[1].replace(/^.*\//, '') : null;
      codes.push(t);
      lastPara = '';
    }
  });

  // Latest version of every named file, in document order.
  const byName = new Map();
  for (const c of codes) if (c._file && (c._kind === 'c' || c._kind === 'cpp')) byName.set(c._file, c);

  const projectFor = (cmd) => {
    const names = cmd.sources.map(s => s.replace(/\.o$/, ''));
    const files = [];
    for (const n of names) {
      const hit = byName.get(n) || byName.get(n + '.c') || byName.get(n + '.cpp');
      if (!hit) return null;
      files.push({ name: hit._file, text: hit.text });
    }
    // headers included with quotes
    const seen = new Set(files.map(f => f.name));
    for (let i = 0; i < files.length; i++) {
      for (const m of files[i].text.matchAll(/#include\s+"([^"]+)"/g)) {
        const nm = m[1].replace(/^.*\//, '');
        const hit = byName.get(nm);
        if (hit && !seen.has(nm)) { seen.add(nm); files.push({ name: nm, text: hit.text }); }
      }
    }
    return files.length > 1 ? files : null;
  };

  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    const meta = { kind: c._kind, file: c._file };
    c._meta = meta;
    if (c._kind === 'c' || c._kind === 'cpp') {
      meta.isProgram = MAIN_RE.test(c.text);
      if (!meta.isProgram) continue;
      for (let j = i + 1; j < Math.min(codes.length, i + 7); j++) {
        const d = codes[j];
        if ((d._kind === 'c' || d._kind === 'cpp') && MAIN_RE.test(d.text)) break;
        const isMakeLog = d._kind === 'text' && /^\s*(gcc|g\+\+|clang|cc)\s/m.test(d.text);
        if ((d._kind === 'bash' || isMakeLog) && !meta.cmds) {
          const p = parseCommands(d.text);
          if (p.cmds.length) {
            const mine = p.cmds.filter(cm => !c._file || cm.sources.some(s => s === c._file || s.replace(/\.o$/, '') === c._file.replace(/\.\w+$/, '')));
            meta.cmds = mine.length ? mine : p.cmds;
            if (p.stdin !== null) meta.stdin = p.stdin;
            if (p.args) meta.args = p.args;
          }
        }
        if ((d._kind === 'text' || d._raw === 'console') && !isMakeLog && meta.expected === undefined &&
            /expected output|expected result|output (is|looks)|it prints|should print|you should see|typical output|sample output|prints:?\s*$/i.test(d._prev)) {
          meta.expected = d.text;
          meta.expectedNote = d._prev;
        }
      }
      if (meta.cmds) {
        const multi = meta.cmds.find(cm => cm.sources.length > 1);
        if (multi) meta.project = projectFor(multi);
      }
    } else if (c._kind === 'bash') {
      const p = parseCommands(c.text);
      const multi = p.cmds.find(cm => cm.sources.length > 1);
      if (multi) {
        const files = projectFor(multi);
        if (files) { meta.project = files; meta.cmds = [multi]; meta.isProjectCmd = true; if (p.stdin !== null) meta.stdin = p.stdin; if (p.args) meta.args = p.args; }
      }
    }
  }
  return codes;
}

// ---------- Markdown rendering ----------
function makeMarked(path) {
  const marked = new Marked({ gfm: true });
  const slugger = ghSlugger();
  marked.use({
    renderer: {
      code(t) {
        if (t._raw === 'mermaid') return `<pre class="mermaid">${esc(t.text)}</pre>`;
        const id = (t._idx = makeMarked.blocks.push(t) - 1);
        const hl = HL_ALIAS[t._raw] || t._raw || 'plaintext';
        return `<div class="cb" data-cb="${id}"><pre><code class="language-${esc(hl)}">${esc(t.text)}</code></pre></div>`;
      },
      heading(t) {
        const inner = this.parser.parseInline(t.tokens);
        const id = slugger(decode(inner.replace(/<[^>]+>/g, '')));
        return `<h${t.depth} id="${esc(id)}">${inner}</h${t.depth}>\n`;
      },
      link(t) {
        const inner = this.parser.parseInline(t.tokens);
        const title = t.title ? ` title="${esc(t.title)}"` : '';
        let href = t.href || '';
        if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('//')) return `<a href="${esc(href)}"${title} target="_blank" rel="noopener">${inner}</a>`;
        if (href.startsWith('#')) return `<a href="#/read/${esc(path)}@${esc(href.slice(1))}"${title}>${inner}</a>`;
        const r = resolvePath(path, href);
        if (/\.md$/i.test(r.path)) return `<a href="#/read/${esc(r.path)}${r.hash ? '@' + esc(r.hash) : ''}"${title}>${inner}</a>`;
        const kind = /\/$|^[^.]+$/.test(r.path) ? 'tree' : 'blob';
        return `<a href="${esc(`${REPO_URL}/${kind}/main/${r.path}`)}"${title} target="_blank" rel="noopener">${inner}</a>`;
      },
      image(t) {
        let src = t.href || '';
        if (!/^[a-z][\w+.-]*:/i.test(src)) src = CONTENT_ROOT + resolvePath(path, src).path;
        return `<img src="${esc(src)}" alt="${esc(t.text || '')}" loading="lazy">`;
      },
    },
  });
  return marked;
}
makeMarked.blocks = [];

// ---------- Mermaid ----------
let mermaidMod = null;
async function renderMermaid(root) {
  const nodes = [...root.querySelectorAll('pre.mermaid')];
  if (!nodes.length) return;
  try {
    if (!mermaidMod) mermaidMod = (await import(MERMAID_URL)).default;
    mermaidMod.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default', fontFamily: 'Inter, system-ui, sans-serif' });
    let n = 0;
    for (const node of nodes) {
      const src = node.textContent;
      try {
        const { svg } = await mermaidMod.render(`mmd-${Date.now()}-${n++}`, src);
        node.innerHTML = svg;
        node.setAttribute('data-processed', '1');
      } catch (e) {
        node.classList.add('mermaid-failed');
        node.setAttribute('data-processed', '1');
        node.textContent = src;
      }
    }
  } catch (e) {
    nodes.forEach(n => { n.classList.add('mermaid-failed'); n.setAttribute('data-processed', '1'); });
  }
}

// ---------- code-block toolbars ----------
const ICON_RUN = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M4 2.5v11l9-5.5z"/></svg>';

function labelFor(t) {
  const m = t._meta || {};
  return { lang: t._raw || 'text', file: m.file };
}

function compilerLabel(id) {
  for (const list of Object.values(COMPILERS)) { const c = list.find(x => x.id === id); if (c) return `${c.name}`; }
  return id;
}

function buildToolbar(t, cb, ctx) {
  const m = t._meta || { kind: t._kind };
  const bar = h('div', { class: 'cb-bar' });
  const lab = labelFor(t);
  bar.append(h('span', { class: 'cb-lang' }, lab.lang || 'text'));
  if (lab.file) bar.append(h('span', { class: 'cb-file' }, lab.file));
  const runnableC = (m.kind === 'c' || m.kind === 'cpp') && m.isProgram;
  const cmd = m.cmds && m.cmds[0];
  let cmdSel = null;
  if ((runnableC || m.isProjectCmd) && m.cmds && m.cmds.length > 1) {
    cmdSel = h('select', { class: 'btn sm', title: 'This module shows several build commands; pick one' },
      m.cmds.map((c, i) => h('option', { value: i }, c.flags.includes('sanitize') ? `Build ${i + 1}: ${c.flags.match(/-fsanitize=\S+/)[0]}` : `Build ${i + 1}`)));
  } else if ((runnableC || m.isProjectCmd) && cmd) {
    bar.append(h('span', { class: 'cb-cmd', title: cmd.line }, cmd.line));
  }
  bar.append(h('span', { class: 'sp' }));
  if (cmdSel) bar.append(cmdSel);

  const currentCmd = () => (m.cmds ? m.cmds[cmdSel ? +cmdSel.value : 0] : null);
  const lab_ = NEEDS_LAB.find(([re]) => re.test(t.text) || (m.project || []).some(f => re.test(f.text)));

  if (runnableC || m.isProjectCmd) {
    const files = m.project || [{ name: m.file || (m.kind === 'c' ? 'main.c' : 'main.cpp'), text: t.text }];
    const langOf = () => (currentCmd() ? currentCmd().lang : m.kind);
    const runBtn = h('button', { class: 'btn sm primary', html: `${ICON_RUN} ${m.project ? `Run project (${m.project.length} files)` : 'Run'}`, title: 'Compile with real GCC/Clang and run in a sandbox' });
    if (lab_) { runBtn.disabled = true; runBtn.title = `Needs ${lab_[1]}: run this one in your lab`; }
    runBtn.onclick = () => runC(cb, t, { files, lang: langOf(), cmd: currentCmd(), btn: runBtn, ctx });
    bar.append(runBtn);
    if (!m.project) {
      bar.append(h('button', { class: 'btn sm', title: 'Step through the program line by line and watch the stack, heap and pointers', onclick: () => showViz(cb, langOf(), t.text, () => ctx.openInIde({ lang: langOf(), files, compiler: currentCmd()?.compiler, flags: currentCmd()?.flags, name: `${ctx.title.split(':')[0]} ${files[0].name}`, from: ctx.path })) }, 'Visualize memory'));
    }
    bar.append(h('button', { class: 'btn sm', title: 'Open in the full IDE', onclick: () => ctx.openInIde({ lang: langOf(), files, compiler: currentCmd()?.compiler, flags: currentCmd()?.flags, stdin: m.stdin || '', args: m.args || [], name: `${ctx.title.split(':')[0]} ${files.find(f => MAIN_RE.test(f.text))?.name || files[0].name}`, from: ctx.path, expected: m.expected }) }, 'Open in IDE'));
    if (lab_) bar.append(h('span', { class: 'chip', title: 'This code needs a library or OS that the browser sandbox does not have' }, `needs ${lab_[1].split(' (')[0]}`));
  } else if (m.kind === 'c' || m.kind === 'cpp') {
    bar.append(h('button', { class: 'btn sm ghost', title: 'Open this snippet in the IDE to experiment (add a main to run it)', onclick: () => ctx.openInIde({ lang: m.kind, files: [{ name: m.file || (m.kind === 'c' ? 'snippet.c' : 'snippet.cpp'), text: t.text }], name: `${ctx.title.split(':')[0]} snippet`, from: ctx.path }) }, 'Open in IDE'));
  } else if (m.kind === 'sql') {
    const runBtn = h('button', { class: 'btn sm primary', html: `${ICON_RUN} Run`, title: 'Run in PostgreSQL inside your browser (shared database)' });
    runBtn.onclick = () => runSqlBlock(cb, t.text, runBtn);
    bar.append(runBtn);
    bar.append(h('button', { class: 'btn sm', title: 'Run every SQL block on this page from the top down to this one (sets up tables the later blocks need)', onclick: (e) => runSqlUpTo(cb, t, ctx, e.currentTarget) }, 'Run all above + this'));
    bar.append(h('button', { class: 'btn sm ghost', onclick: () => ctx.openInIde({ lang: 'sql', files: [{ name: m.file || 'query.sql', text: t.text }], name: `${ctx.title.split(':')[0]} SQL`, from: ctx.path }) }, 'Open in IDE'));
  } else if (m.kind === 'python') {
    const runBtn = h('button', { class: 'btn sm primary', html: `${ICON_RUN} Run`, title: 'Run with Python in your browser' });
    runBtn.onclick = () => runPy(cb, t.text, runBtn);
    bar.append(runBtn);
    bar.append(h('button', { class: 'btn sm', onclick: () => showViz(cb, 'python', t.text, () => ctx.openInIde({ lang: 'python', files: [{ name: m.file || 'main.py', text: t.text }], name: `${ctx.title.split(':')[0]} Python`, from: ctx.path })) }, 'Visualize'));
    bar.append(h('button', { class: 'btn sm ghost', onclick: () => ctx.openInIde({ lang: 'python', files: [{ name: m.file || 'main.py', text: t.text }], name: `${ctx.title.split(':')[0]} Python`, from: ctx.path }) }, 'Open in IDE'));
  }
  bar.append(h('button', { class: 'btn sm ghost', title: 'Copy code', onclick: () => copyText(t.text) }, 'Copy'));
  return bar;
}

function runArea(cb) {
  let area = cb.querySelector('.cb-run');
  if (!area) { area = h('div', { class: 'cb-run' }); cb.append(area); }
  return area;
}
function busy(btn, on, label) {
  if (on) { btn._html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label || 'Running'}`; }
  else { btn.disabled = false; if (btn._html) btn.innerHTML = btn._html; }
}

async function runC(cb, t, { files, lang, cmd, btn, ctx }) {
  const m = t._meta;
  const area = runArea(cb);
  const needsStdin = files.some(f => STDIN_RE.test(f.text)) || m.stdin;
  let stdinBox = area.querySelector('.cb-stdin textarea');
  if (needsStdin && !stdinBox) {
    const row = h('div', { class: 'cb-stdin' }, h('span', {}, 'stdin'), (stdinBox = h('textarea', { spellcheck: 'false', placeholder: 'Input typed into the program (one value per line)' })));
    stdinBox.value = m.stdin || '';
    area.prepend(row);
  }
  area.querySelectorAll('.console, .verdict').forEach(e => e.remove());
  busy(btn, true, 'Compiling');
  const compiler = cmd ? cmd.compiler : (lang === 'c' ? 'cg133' : 'g133');
  const flags = cmd ? cmd.flags : defaultFlags(lang);
  const warn = NET_RE.test(t.text) ? h('div', { class: 'verdict warn' }, h('span', {}, '!'), h('div', { class: 'v-body' }, 'This program uses sockets. The sandbox has no network, so servers and clients usually fail or time out here. Run it in your lab (WSL2) for the real thing.')) : null;
  try {
    const res = await runProgram({ lang, compiler, flags, files, stdin: stdinBox ? stdinBox.value : (m.stdin || ''), args: m.args || [] });
    area.append(consoleFor(res, { compilerName: `${compilerLabel(compiler)}:` }));
    if (warn) area.append(warn);
    if (res.didExecute && m.expected !== undefined) area.append(verdictEl(compareOutput(res.stdout, m.expected)));
    if (!res.built && res.diagnostics.length) {
      area.append(h('div', { class: 'verdict err' }, h('span', {}, '✗'), h('div', { class: 'v-body' }, 'The compiler rejected the code. ', h('a', { href: 'javascript:void 0', onclick: () => ctx.openInIde({ lang, files, compiler, flags, name: `${ctx.title.split(':')[0]} ${files[0].name}`, from: ctx.path }) }, 'Open in the IDE'), ' to see each error underlined on its line.')));
    }
  } catch (e) {
    area.append(h('pre', { class: 'console' }, h('span', { class: 'err' }, String(e.message || e))));
  } finally { busy(btn, false); }
}

async function runSqlBlock(cb, sql, btn) {
  const area = runArea(cb);
  area.innerHTML = '';
  busy(btn, true, 'Starting PostgreSQL');
  try {
    const db = await getDb();
    btn.innerHTML = '<span class="spin"></span> Running';
    const out = await runSql(db, sql);
    area.append(sqlResultEl(out));
  } catch (e) {
    area.append(h('pre', { class: 'console' }, h('span', { class: 'err' }, String(e.message || e))));
  } finally { busy(btn, false); }
}

async function runSqlUpTo(cb, t, ctx, btn) {
  const sqlBlocks = ctx.blocks.filter(b => b._kind === 'sql' && b._idx <= t._idx);
  const area = runArea(cb);
  area.innerHTML = '';
  busy(btn, true, `Running ${sqlBlocks.length} blocks`);
  try {
    const db = await getDb();
    let last = null;
    for (const b of sqlBlocks) {
      last = await runSql(db, b.text);
      if (last.error && b !== t) {
        area.append(h('div', { class: 'sql-out' }, h('div', { class: 'sql-msg notice' }, `An earlier block stopped with: ${last.error.message} (often harmless, e.g. "already exists" when you run twice). Continuing.`)));
      }
    }
    if (last) area.append(sqlResultEl(last));
  } catch (e) {
    area.append(h('pre', { class: 'console' }, h('span', { class: 'err' }, String(e.message || e))));
  } finally { busy(btn, false); }
}

async function runPy(cb, code, btn) {
  const area = runArea(cb);
  area.innerHTML = '';
  const pre = h('pre', { class: 'console' });
  area.append(pre);
  busy(btn, true, 'Loading Python');
  const res = await runPython(code, {
    onOut: (s) => { pre.append(s); },
    onErr: (s) => { pre.append(h('span', { class: 'err' }, s)); },
    onStatus: (s) => { btn.innerHTML = `<span class="spin"></span> ${s.startsWith('Running') ? 'Running' : 'Loading Python'}`; },
    timeoutMs: 30000,
  });
  if (!res.ok) pre.append(h('span', { class: 'err' }, (res.error || 'Error') + '\n'));
  pre.append(h('span', { class: 'meta' }, `───── ${res.ok ? 'finished' : 'failed'}${res.ms ? ` in ${(res.ms / 1000).toFixed(2)} s` : ''}`));
  busy(btn, false);
}

function showViz(cb, lang, code, openIde) {
  const area = runArea(cb);
  let viz = area.querySelector('.cb-viz');
  if (viz) { viz.remove(); return; }
  const big = tutorTooLong(lang, code);
  if (big) {
    area.prepend(h('div', { class: 'cb-viz' }, h('div', { class: 'viz-note', style: { color: 'var(--warn)' } },
      h('span', {}, `This program is ${big} bytes even without comments; the step-by-step visualiser accepts about ${TUTOR_LIMIT}. Open it in the IDE, keep just the part you want to watch (one numbered section of main, say), and press Visualize there.`),
      openIde ? h('button', { class: 'btn sm', onclick: openIde }, 'Open in IDE') : null)));
    return;
  }
  const warns = tutorWarnings(lang, code);
  viz = h('div', { class: 'cb-viz' },
    h('div', { class: 'viz-note' },
      h('span', {}, 'Step with Next / Prev (or drag the slider). Left: the stack frames and their variables. Right: heap objects. Arrows are pointers.'),
      h('a', { href: tutorUrl(lang, code, { embed: false }), target: '_blank', rel: 'noopener' }, 'Open full screen ↗')),
    warns.length ? h('div', { class: 'viz-note', style: { color: 'var(--warn)' } }, warns.join(' ')) : null,
    h('iframe', { src: tutorUrl(lang, code), title: 'Step-by-step memory visualiser (Python Tutor)', loading: 'lazy' }));
  area.prepend(viz);
}

// ---------- public: render a document ----------
export async function renderDoc(path, container, ctx) {
  const md = await fetchText(CONTENT_ROOT + path);
  makeMarked.blocks = [];
  const marked = makeMarked(path);
  const tokens = marked.lexer(md);
  const codes = annotate(tokens, marked);
  const html = marked.parser(tokens);
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'], ADD_TAGS: ['details', 'summary'] });
  const body = h('article', { class: 'md', html: clean });
  container.append(body);

  const title = (md.match(/^#\s+(.+)$/m) || [, path])[1].trim();
  const fullCtx = Object.assign({ title, path, blocks: makeMarked.blocks }, ctx);
  let runnable = 0;
  body.querySelectorAll('.cb').forEach(cb => {
    const t = makeMarked.blocks[+cb.dataset.cb];
    if (!t) return;
    const codeEl = cb.querySelector('code');
    try { if (window.hljs) window.hljs.highlightElement(codeEl); } catch (e) { /* unknown language */ }
    cb.prepend(buildToolbar(t, cb, fullCtx));
    if (t._meta && (t._meta.isProgram || t._meta.isProjectCmd || t._kind === 'sql' || t._kind === 'python')) runnable++;
  });
  renderMermaid(body);
  return { title, md, runnable, codes };
}

export function scrollToAnchor(container, anchor) {
  if (!anchor) { container.scrollTop = 0; return; }
  const el = container.querySelector(`[id="${CSS.escape(anchor)}"]`);
  if (el) el.scrollIntoView({ block: 'start' });
}
