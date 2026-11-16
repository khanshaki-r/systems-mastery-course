// The in-browser IDE: Monaco editor + real compilers + memory visualiser + exercises.
import { h, esc, store, session, toast, copyText, isDark, packText, unpackText, progress, normOut } from './util.js';
import { COMPILERS, PRESETS, defaultFlags, runProgram, compileAsm, structLayout, SOURCE_EXT, HEADER_EXT, STD_DEFAULT, WARN_DEFAULT } from './runners/godbolt.js';
import { runSql, describeSchema, createDb } from './runners/sql.js';
import { runPython, stopPython } from './runners/python.js';
import { getDb, resetDb } from './sqlsession.js';
import { consoleFor, sqlResultEl, tutorUrl, tutorWarnings, tutorTooLong, TUTOR_LIMIT, layoutEl, compareOutput, verdictEl, diffView } from './output.js';
import { loadExercise, loadSolution, loadSetup, checkExercise, mdHtml, lines } from './exercises.js';

const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
const LANGS = { c: 'C', cpp: 'C++', sql: 'PostgreSQL', python: 'Python' };

// ---------- starter templates ----------
const TEMPLATES = {
  c: [{ name: 'main.c', text: `// main.c: your C scratchpad.
// Ctrl+Enter runs it on real GCC. "Visualize" steps through it and draws memory.
// "Layout" shows every byte of each struct, including padding.
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    char   type;          /* 'H' home loan, 'P' personal loan */
    double amount;        /* rupees */
    int    term_months;
} Loan;

static double monthly_interest(const Loan *loan, double annual_rate) {
    return loan->amount * annual_rate / 12.0;
}

int main(void) {
    Loan *loan = malloc(sizeof *loan);      /* one Loan on the heap */
    if (loan == NULL) return 1;
    loan->type = 'H';
    loan->amount = 2500000.0;
    loan->term_months = 240;

    printf("sizeof(Loan) = %zu bytes\\n", sizeof(Loan));
    printf("first month interest at 8.5%%: %.2f\\n", monthly_interest(loan, 0.085));

    free(loan);                              /* every malloc needs exactly one free */
    return 0;
}
` }],
  cpp: [{ name: 'main.cpp', text: `// main.cpp: your C++17 scratchpad.
// Ctrl+Enter runs it on real GCC. Try the "AddressSanitizer" preset, or open
// the Assembly tab to see what the compiler generated for each line.
#include <iostream>
#include <memory>
#include <string>
#include <vector>

struct Account {
    std::string id;
    long long balance_paise;
    Account(std::string i, long long b) : id(std::move(i)), balance_paise(b) {
        std::cout << "open  " << id << "\\n";
    }
    ~Account() { std::cout << "close " << id << "\\n"; }   // RAII: runs automatically
};

int main() {
    std::vector<std::unique_ptr<Account>> book;
    book.push_back(std::make_unique<Account>("SB-1001", 250000));
    book.push_back(std::make_unique<Account>("SB-1002", 990000));

    long long total = 0;
    for (const auto& a : book) total += a->balance_paise;
    std::cout << "accounts: " << book.size() << ", total: " << total / 100 << " rupees\\n";
    return 0;   // the vector is destroyed here, so both accounts close
}
` }],
  sql: [{ name: 'main.sql', text: `-- main.sql: real PostgreSQL running inside your browser (PGlite).
-- Ctrl+Enter runs the whole file, or just the selected text.
-- The database is saved in this browser; "Reset DB" wipes it.

DROP TABLE IF EXISTS loans;
CREATE TABLE loans (
    loan_id     bigint PRIMARY KEY,
    branch_code text    NOT NULL,
    amount      numeric(14,2) NOT NULL CHECK (amount > 0),
    status      text    NOT NULL DEFAULT 'NEW'
);

INSERT INTO loans
SELECT g, 'BR' || lpad((g % 50)::text, 3, '0'), 10000 + (g % 997) * 1000, 'NEW'
FROM generate_series(1, 20000) AS g;

ANALYZE loans;

-- Without an index on branch_code this is a sequential scan of all 20000 rows.
EXPLAIN ANALYZE SELECT count(*), sum(amount) FROM loans WHERE branch_code = 'BR007';

CREATE INDEX loans_branch_idx ON loans (branch_code) INCLUDE (amount);

-- Now compare the plan: an index-only scan reads far fewer pages.
EXPLAIN ANALYZE SELECT count(*), sum(amount) FROM loans WHERE branch_code = 'BR007';
` }],
  python: [{ name: 'main.py', text: `# main.py: Python running inside your browser (Pyodide).
# Ctrl+Enter runs it. "Visualize" steps through it line by line.
# Lines you type in the stdin box are what input() returns.

def percentile(sorted_values, p):
    """Nearest-rank percentile, the way latency dashboards usually report it."""
    if not sorted_values:
        raise ValueError("no samples")
    rank = max(1, round(p / 100 * len(sorted_values)))
    return sorted_values[rank - 1]

latencies_ms = [12, 15, 11, 240, 14, 13, 16, 12, 18, 900, 13, 14]
latencies_ms.sort()
for p in (50, 90, 99):
    print(f"p{p} = {percentile(latencies_ms, p)} ms")
` }],
};

// ---------- workspace storage ----------
const WS_KEY = 'sm.workspaces';
const CUR_KEY = 'sm.ws.current';
function allWs() { return store.get(WS_KEY, {}); }
function saveWs(ws) { const all = allWs(); ws.updated = Date.now(); all[ws.id] = ws; store.set(WS_KEY, all); }
function deleteWs(id) { const all = allWs(); delete all[id]; store.set(WS_KEY, all); }
function scratch(lang) {
  const id = `scratch:${lang}`;
  const existing = allWs()[id];
  if (existing) return existing;
  const ws = { id, name: `${LANGS[lang]} scratchpad`, lang, files: clone(TEMPLATES[lang]), orig: clone(TEMPLATES[lang]), active: 0, preset: 'debug', compiler: defaultCompiler(lang), flags: isCompiled(lang) ? defaultFlags(lang) : '', stdin: '', args: '' };
  saveWs(ws);
  return ws;
}
const clone = x => JSON.parse(JSON.stringify(x));
const isCompiled = lang => lang === 'c' || lang === 'cpp';
const defaultCompiler = lang => (isCompiled(lang) ? COMPILERS[lang][0].id : '');
function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); }

function monacoLang(name, wsLang) {
  if (/\.(cpp|cc|cxx|hpp|hh|hxx)$/i.test(name)) return 'cpp';
  if (/\.h$/i.test(name)) return wsLang === 'cpp' ? 'cpp' : 'c';
  if (/\.c$/i.test(name)) return 'c';
  if (/\.sql$/i.test(name)) return 'pgsql';
  if (/\.py$/i.test(name)) return 'python';
  if (/\.md$/i.test(name)) return 'markdown';
  if (/\.(json)$/i.test(name)) return 'json';
  if (/^makefile$/i.test(name)) return 'plaintext';
  return 'plaintext';
}

// ---------- Monaco loader ----------
let monacoP = null;
function loadMonaco() {
  if (monacoP) return monacoP;
  monacoP = new Promise((resolve, reject) => {
    window.MonacoEnvironment = {
      getWorkerUrl() {
        return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${MONACO}/'};importScripts('${MONACO}/vs/base/worker/workerMain.js');`);
      },
    };
    const s = document.createElement('script');
    s.src = `${MONACO}/vs/loader.js`;
    s.onload = () => {
      window.require.config({ paths: { vs: `${MONACO}/vs` } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    s.onerror = () => reject(new Error('Could not load the editor from the CDN. Check your connection.'));
    document.head.append(s);
  });
  return monacoP;
}

// ---------- IDE ----------
export class IDE {
  constructor(root, { openModule }) {
    this.root = root;
    this.openModule = openModule;
    this.ws = null;
    this.models = [];
    this.ex = null;          // current exercise, if any
    this.busy = false;
    this.asmMap = null;
    this.build();
  }

  // ----- DOM skeleton -----
  build() {
    const $ = (sel) => this.root.querySelector(sel);
    this.root.innerHTML = `
      <div class="ide">
        <div class="ide-toolbar">
          <div class="grp">
            <select data-r="lang" title="Language (switches to your scratchpad for that language)">
              ${Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
            </select>
            <select data-r="wsSel" title="Your saved workspaces" style="max-width:220px"></select>
          </div>
          <span class="sep"></span>
          <div class="grp" data-r="ccOpts">
            <select data-r="compiler" title="Compiler"></select>
            <select data-r="preset" title="Build preset">
              ${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
              <option value="custom">Custom flags</option>
            </select>
            <input type="text" class="flags" data-r="flags" spellcheck="false" title="Compiler flags (edit freely)">
          </div>
          <div class="grp">
            <button class="btn primary" data-r="runBtn" title="Run (Ctrl+Enter)"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M4 2.5v11l9-5.5z"/></svg> Run</button>
            <button class="btn ok" data-r="checkBtn" hidden title="Run every test for this exercise">✓ Check</button>
            <button class="btn" data-r="vizBtn" title="Step through the program and watch memory">Visualize</button>
            <button class="btn" data-r="asmBtn" title="Show the assembly the compiler generated">Assembly</button>
            <button class="btn" data-r="layoutBtn" title="Byte-by-byte layout of your structs and classes">Layout</button>
            <button class="btn" data-r="resetDbBtn" hidden title="Drop every table, function and index">Reset DB</button>
          </div>
          <span class="sp"></span>
          <div class="grp">
            <button class="btn ghost" data-r="shareBtn" title="Copy a link containing this code">Share</button>
            <button class="btn ghost" data-r="dlBtn" title="Download the current file">Download</button>
            <button class="btn ghost" data-r="resetBtn" title="Restore the original code">Reset</button>
            <button class="btn ghost" data-r="delBtn" title="Delete this workspace">Delete</button>
          </div>
        </div>
        <div class="ide-body">
          <aside class="ide-ex" data-r="exPane" hidden></aside>
          <div class="ide-editor-col" data-r="edCol">
            <div class="file-tabs" data-r="tabs"></div>
            <div class="editor-host" data-r="host"><div class="editor-loading">Loading editor…</div></div>
          </div>
          <div class="ide-split" data-r="split" title="Drag to resize"></div>
          <div class="ide-panel-col">
            <div class="panel-tabs" data-r="ptabs"></div>
            <div class="panel-body" data-r="pbody"></div>
            <div class="status-line" data-r="status"><span><span class="dot ok"></span>Ready</span></div>
          </div>
        </div>
      </div>`;
    this.r = {};
    this.root.querySelectorAll('[data-r]').forEach(el => { this.r[el.dataset.r] = el; });
    const r = this.r;

    // panes
    this.panes = {};
    const pane = (key, label) => {
      const tab = h('button', { class: 'panel-tab', 'data-p': key, onclick: () => this.showPane(key) }, label);
      const body = h('div', { class: 'pane', hidden: true });
      r.ptabs.append(tab); r.pbody.append(body);
      this.panes[key] = { tab, body, label };
      return body;
    };
    // Tests (exercise mode only; first so it is never scrolled out of view)
    this.testsBody = pane('tests', 'Tests');
    // Output
    const out = pane('output', 'Output');
    this.outHost = h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', overflow: 'auto' } });
    this.outHost.append(this.emptyOutput());
    this.stdinEl = h('textarea', { spellcheck: 'false', placeholder: 'Text the program reads from stdin (scanf, std::cin, input())' });
    this.argsEl = h('input', { type: 'text', spellcheck: 'false', placeholder: 'args', style: { width: '45%', height: '24px', border: '1px solid var(--border)', borderRadius: '5px', background: 'var(--surface-2)', font: '12px var(--mono)', padding: '0 6px' } });
    this.stdinWrap = h('div', { class: 'stdin-box' }, h('label', {}, h('span', {}, 'stdin'), this.argsEl), this.stdinEl);
    out.append(this.outHost, this.stdinWrap);
    // Problems
    this.probList = h('ul', { class: 'problems' });
    pane('problems', 'Problems').append(this.probList);
    // Assembly
    const asm = pane('asm', 'Assembly');
    this.asmHead = h('div', { class: 'pane-head' }, h('span', {}, 'Each colour links source lines to the instructions generated for them. Hover an instruction to find its line.'), h('span', { class: 'sp' }));
    this.asmBody = h('div', { class: 'asm' }, h('div', { class: 'pane-empty' }, 'Press Assembly to compile the current file and see the x86-64 instructions.'));
    asm.append(this.asmHead, this.asmBody);
    // Memory & debug
    const viz = pane('viz', 'Memory & debug');
    this.vizBody = viz;
    viz.append(this.vizEmpty());
    // Layout
    const lay = pane('layout', 'Layout');
    this.layoutBody = h('div', { style: { flex: '1', overflow: 'auto' } }, h('div', { class: 'pane-empty' }, 'Press Layout to see how the compiler places each field of your structs in memory, including the padding it adds for alignment.'));
    lay.append(this.layoutBody);
    // Database (SQL)
    const dbp = pane('db', 'Database');
    this.dbBody = h('div', { class: 'db-schema' }, 'Run something to see your tables here.');
    dbp.append(h('div', { class: 'pane-head' }, h('span', {}, 'Tables, columns, indexes and functions in the public schema.'), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => this.refreshSchema() }, 'Refresh')), this.dbBody);

    // toolbar events
    r.lang.onchange = () => this.openWorkspace(scratch(r.lang.value));
    r.wsSel.onchange = () => { const ws = allWs()[r.wsSel.value]; if (ws) this.openWorkspace(ws); };
    r.compiler.onchange = () => { this.ws.compiler = r.compiler.value; this.persist(); this.updateStatusIdle(); };
    r.preset.onchange = () => {
      const p = r.preset.value;
      this.ws.preset = p;
      if (p !== 'custom') { const std = (r.flags.value.match(/-std=\S+/) || [STD_DEFAULT[this.ws.lang]])[0]; r.flags.value = `${std} ${WARN_DEFAULT} ${PRESETS[p].flags}${this.ws.lang === 'cpp' ? ' -pthread' : ''}`; }
      this.ws.flags = r.flags.value; this.persist();
    };
    r.flags.oninput = () => { this.ws.flags = r.flags.value; this.ws.preset = 'custom'; r.preset.value = 'custom'; this.persist(); };
    r.runBtn.onclick = () => this.run();
    r.checkBtn.onclick = () => this.check();
    r.vizBtn.onclick = () => this.visualize();
    r.asmBtn.onclick = () => this.assembly();
    r.layoutBtn.onclick = () => this.layout();
    r.resetDbBtn.onclick = () => this.confirm('Reset the database?', this.ex ? 'The exercise database goes back to its starting tables.' : 'This drops every table, index and function you created in the browser database.', 'Reset', async () => { if (this.ex) { this.exDb = null; } else { await resetDb(); } toast('Database reset'); this.refreshSchema(); });
    r.shareBtn.onclick = () => this.share();
    r.dlBtn.onclick = () => this.download();
    r.resetBtn.onclick = () => this.confirm('Restore the original code?', 'Your edits in this workspace will be replaced by the original version.', 'Restore', () => { this.ws.files = clone(this.ws.orig || TEMPLATES[this.ws.lang]); this.ws.active = 0; this.persist(); this.loadModels(); });
    r.delBtn.onclick = () => this.confirm('Delete this workspace?', `"${this.ws.name}" and its files will be removed from this browser.`, 'Delete', () => { deleteWs(this.ws.id); this.openWorkspace(scratch(this.ws.lang)); });
    this.stdinEl.oninput = () => { this.ws.stdin = this.stdinEl.value; this.persist(); };
    this.argsEl.oninput = () => { this.ws.args = this.argsEl.value; this.persist(); };

    // splitter
    r.split.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const body = r.split.parentElement;
      const rect = body.getBoundingClientRect();
      const exW = r.exPane.hidden ? 0 : r.exPane.getBoundingClientRect().width;
      r.split.classList.add('drag');
      const move = (ev) => {
        const x = Math.min(Math.max(ev.clientX - rect.left - exW, 240), rect.width - exW - 260);
        r.edCol.style.flex = `0 0 ${x}px`;
      };
      const up = () => { r.split.classList.remove('drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  emptyOutput() {
    return h('div', { class: 'pane-empty' },
      h('h4', {}, 'Press Run or Ctrl+Enter'),
      'C and C++ compile on real GCC/Clang (Compiler Explorer) and run in a sandboxed x86-64 Linux machine. SQL runs in PostgreSQL inside your browser. Python runs in your browser too.',
      h('ul', {},
        h('li', {}, 'Pick the AddressSanitizer preset to catch buffer overflows, use-after-free and leaks.'),
        h('li', {}, 'Pick ThreadSanitizer to catch data races in threaded code.'),
        h('li', {}, 'Add files with + to build a multi-file project (built with CMake).')));
  }
  vizEmpty() {
    return h('div', { class: 'pane-empty' },
      h('h4', {}, 'Watch your program run, one line at a time'),
      'Press Visualize. You will see each step of execution: the current line, every stack frame with its local variables, heap blocks from malloc/new, and pointers drawn as arrows. Step forward and backward freely; it works like a debugger that can rewind.',
      h('ul', {},
        h('li', {}, 'Works for C, C++ (GCC 9.3 in the visualiser) and Python.'),
        h('li', {}, 'Best for programs under about 100 lines and 1000 steps.'),
        h('li', {}, 'No threads or sockets; use Run with the sanitizer presets for those.')),
      h('p', { style: { marginTop: '10px' } }, 'The visualiser is Python Tutor (pythontutor.com); your code is sent to it when you press Visualize.'));
  }

  showPane(key) {
    for (const [k, p] of Object.entries(this.panes)) {
      p.tab.classList.toggle('active', k === key);
      p.body.hidden = k !== key;
    }
    this.activePane = key;
  }
  setPaneVisible(key, on) { this.panes[key].tab.hidden = !on; if (!on && this.activePane === key) this.showPane(this.ws && this.ws.lang === 'sql' ? 'output' : 'output'); }
  badge(key, n, kind = '') {
    const tab = this.panes[key].tab;
    tab.querySelector('.badge')?.remove();
    if (n) tab.append(h('span', { class: `badge ${kind}` }, String(n)));
  }
  status(text, state = 'ok') {
    this.r.status.innerHTML = '';
    this.r.status.append(h('span', {}, h('span', { class: `dot ${state}` }), text));
  }
  updateStatusIdle() {
    const ws = this.ws;
    if (!ws) return;
    const where = isCompiled(ws.lang)
      ? `${COMPILERS[ws.lang].find(c => c.id === ws.compiler)?.name || ws.compiler} · x86-64 Linux sandbox (Compiler Explorer)`
      : ws.lang === 'sql' ? 'PostgreSQL 18 in your browser (PGlite) · saved in this browser' : 'Python 3 in your browser (Pyodide)';
    this.status(`Ready · ${where}`);
  }

  // ----- confirm modal -----
  confirm(title, text, okLabel, onOk, input) {
    const back = h('div', { class: 'modal-back' });
    const inp = input ? h('input', { type: 'text', value: input.value || '', spellcheck: 'false' }) : null;
    const close = () => back.remove();
    const ok = h('button', { class: 'btn primary', onclick: () => { close(); onOk(inp ? inp.value.trim() : undefined); } }, okLabel);
    back.append(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', {}, title), text ? h('p', { style: { margin: '0 0 10px', color: 'var(--text-2)' } }, text) : null, inp, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), ok)));
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && inp) ok.click(); });
    document.body.append(back);
    (inp || ok).focus();
    if (inp) inp.select();
  }

  // ----- route entry -----
  async show(params = {}) {
    this.monaco = await loadMonaco().catch(e => { this.r.host.innerHTML = `<div class="err-page">${esc(e.message)}</div>`; throw e; });
    if (!this.editor) this.createEditor();
    if (params.exercise) return this.openExercise(params.exercise);
    this.exitExercise();
    if (params.handoff) {
      const p = session.get('sm.handoff');
      session.del('sm.handoff');
      if (p) return this.openHandoff(p);
    }
    if (params.share) {
      try {
        const data = JSON.parse(await unpackText(params.share));
        const ws = { id: `shared:${hashStr(params.share)}`, name: `Shared ${LANGS[data.lang] || ''} code`, lang: data.lang, files: data.files, orig: clone(data.files), active: 0, compiler: data.compiler || defaultCompiler(data.lang), flags: data.flags || (isCompiled(data.lang) ? defaultFlags(data.lang) : ''), preset: 'custom', stdin: data.stdin || '', args: data.args || '' };
        const existing = allWs()[ws.id];
        this.openWorkspace(existing || ws);
        history.replaceState(null, '', '#/ide');
        return;
      } catch (e) { toast('That share link is damaged'); }
    }
    if (!this.ws) {
      const cur = allWs()[store.get(CUR_KEY)];
      this.openWorkspace(cur && !cur.id.startsWith('ex:') ? cur : scratch('cpp'));
    } else this.editor.layout();
  }

  createEditor() {
    const monaco = this.monaco;
    this.r.host.innerHTML = '';
    this.editor = monaco.editor.create(this.r.host, {
      automaticLayout: true,
      theme: isDark() ? 'vs-dark' : 'vs',
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: 13.5,
      lineHeight: 21,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 4,
      insertSpaces: true,
      renderWhitespace: 'selection',
      fixedOverflowWidgets: true,
      smoothScrolling: true,
      padding: { top: 8 },
      bracketPairColorization: { enabled: true },
    });
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => this.run());
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => toast('Saved automatically in this browser'));
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => { if (this.ex) this.check(); });
    this.editor.onDidChangeCursorPosition((e) => this.highlightAsmFor(e.position.lineNumber));
    this.asmDeco = this.editor.createDecorationsCollection();
    this.hlDeco = this.editor.createDecorationsCollection();
    // asm colour classes
    const css = Array.from({ length: 10 }, (_, i) => `.asm-c${i}{background:hsla(${i * 36},80%,60%,.13)} .asm-g${i}{border-left:3px solid hsl(${i * 36},70%,55%)}`).join('\n');
    document.head.append(h('style', {}, css));
  }

  setTheme() { if (this.monaco) this.monaco.editor.setTheme(isDark() ? 'vs-dark' : 'vs'); }

  // ----- workspaces -----
  openWorkspace(ws) {
    this.ws = ws;
    if (!ws.id.startsWith('ex:')) store.set(CUR_KEY, ws.id);
    saveWs(ws);
    const r = this.r;
    r.lang.value = ws.lang;
    this.fillWsSelect();
    const cc = isCompiled(ws.lang);
    r.ccOpts.hidden = !cc;
    r.asmBtn.hidden = !cc;
    r.layoutBtn.hidden = !cc;
    r.vizBtn.hidden = ws.lang === 'sql';
    r.resetDbBtn.hidden = ws.lang !== 'sql';
    r.delBtn.hidden = ws.id.startsWith('scratch:') || ws.id.startsWith('ex:');
    if (cc) {
      r.compiler.innerHTML = COMPILERS[ws.lang].map(c => `<option value="${c.id}">${esc(c.name)}${c.note ? ' (' + esc(c.note) + ')' : ''}</option>`).join('');
      r.compiler.value = ws.compiler || defaultCompiler(ws.lang);
      r.preset.value = ws.preset || 'custom';
      r.flags.value = ws.flags || defaultFlags(ws.lang);
    }
    this.panes.output.tab.textContent = ws.lang === 'sql' ? 'Results' : 'Output';
    this.setPaneVisible('problems', cc);
    this.setPaneVisible('asm', cc);
    this.setPaneVisible('layout', cc);
    this.setPaneVisible('viz', ws.lang !== 'sql');
    this.setPaneVisible('db', ws.lang === 'sql');
    this.setPaneVisible('tests', !!this.ex);
    this.stdinWrap.hidden = ws.lang === 'sql';
    this.argsEl.hidden = !cc;
    this.stdinEl.value = ws.stdin || '';
    this.argsEl.value = ws.args || '';
    this.outHost.innerHTML = '';
    this.outHost.append(this.emptyOutput());
    this.badge('problems', 0);
    this.probList.innerHTML = '';
    this.asmMap = null;
    this.asmBody.innerHTML = '';
    this.asmBody.append(h('div', { class: 'pane-empty' }, 'Press Assembly to compile the current file and see the x86-64 instructions.'));
    this.vizBody.innerHTML = '';
    this.vizBody.append(this.vizEmpty());
    this.showPane(this.ex ? 'tests' : 'output');
    this.loadModels();
    this.updateStatusIdle();
    if (ws.lang === 'sql') this.refreshSchema();
  }

  fillWsSelect() {
    const all = Object.values(allWs()).filter(w => !w.id.startsWith('ex:')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const sel = this.r.wsSel;
    sel.innerHTML = '';
    if (this.ws.id.startsWith('ex:')) sel.append(h('option', { value: this.ws.id }, `Exercise: ${this.ex ? this.ex.title : ''}`));
    for (const w of all) sel.append(h('option', { value: w.id }, `${w.name} (${LANGS[w.lang]})`));
    sel.value = this.ws.id;
  }

  persist() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => saveWs(this.ws), 250);
  }

  loadModels() {
    const monaco = this.monaco;
    this.models.forEach(m => m.dispose());
    this.models = this.ws.files.map((f, i) => {
      const uri = monaco.Uri.parse(`file:///${encodeURIComponent(this.ws.id)}/${i}/${encodeURIComponent(f.name)}`);
      const model = monaco.editor.createModel(f.text, monacoLang(f.name, this.ws.lang), uri);
      model.onDidChangeContent(() => { f.text = model.getValue(); this.persist(); this.asmDeco.clear(); });
      return model;
    });
    this.setActive(Math.min(this.ws.active || 0, this.models.length - 1));
  }

  setActive(i) {
    this.ws.active = i;
    this.editor.setModel(this.models[i]);
    this.renderTabs();
    this.persist();
    this.asmDeco && this.asmDeco.clear();
  }

  renderTabs() {
    const tabs = this.r.tabs;
    tabs.innerHTML = '';
    this.ws.files.forEach((f, i) => {
      const tab = h('div', { class: 'file-tab' + (i === this.ws.active ? ' active' : ''), title: 'Double-click to rename', onclick: () => this.setActive(i), ondblclick: () => this.renameFile(i) }, f.name);
      if (this.ws.files.length > 1) tab.append(h('button', { class: 'x', title: 'Delete file', onclick: (e) => { e.stopPropagation(); this.confirm(`Delete ${f.name}?`, null, 'Delete', () => this.removeFile(i)); } }, '×'));
      tabs.append(tab);
    });
    tabs.append(h('button', { class: 'add', title: 'Add a file (headers, more .c/.cpp files, CMakeLists.txt)', onclick: () => this.addFile() }, '+'));
  }

  addFile() {
    const lang = this.ws.lang;
    const suggestion = { c: 'util.h', cpp: 'util.h', sql: 'more.sql', python: 'helper.py' }[lang];
    this.confirm('New file', isCompiled(lang) ? 'Headers (.h) are included with #include "name.h". Two or more .c/.cpp files are compiled and linked together with CMake.' : null, 'Create', (name) => {
      if (!name || !/^[\w.+-]+$/.test(name)) return toast('Use letters, digits, dot, dash or underscore');
      if (this.ws.files.some(f => f.name === name)) return toast('A file with that name exists');
      let text = '';
      if (/\.h(pp)?$/.test(name)) { const g = name.toUpperCase().replace(/[^A-Z0-9]/g, '_'); text = `#ifndef ${g}\n#define ${g}\n\n\n\n#endif /* ${g} */\n`; }
      this.ws.files.push({ name, text });
      this.persist();
      this.loadModels();
      this.setActive(this.ws.files.length - 1);
    }, { value: suggestion });
  }
  renameFile(i) {
    this.confirm('Rename file', null, 'Rename', (name) => {
      if (!name || !/^[\w.+-]+$/.test(name)) return;
      this.ws.files[i].name = name; this.persist(); this.loadModels(); this.setActive(i);
    }, { value: this.ws.files[i].name });
  }
  removeFile(i) {
    this.ws.files.splice(i, 1);
    this.ws.active = 0;
    this.persist();
    this.loadModels();
  }

  openHandoff(p) {
    const sig = hashStr(JSON.stringify(p.files));
    const id = `mod:${p.from || 'x'}:${sig}`;
    const existing = allWs()[id];
    if (existing) {
      this.openWorkspace(existing);
      if (JSON.stringify(existing.files) !== JSON.stringify(existing.orig)) toast('Opened your edited copy. Reset restores the module version.', 3500);
      return;
    }
    const lang = p.lang;
    const ws = {
      id, name: p.name || 'Module code', lang, from: p.from,
      files: clone(p.files), orig: clone(p.files), active: Math.max(0, p.files.findIndex(f => /\bmain\s*\(/.test(f.text))),
      compiler: p.compiler || defaultCompiler(lang),
      flags: p.flags || (isCompiled(lang) ? defaultFlags(lang) : ''),
      preset: p.flags ? 'custom' : 'debug',
      stdin: p.stdin || '', args: (p.args || []).join(' '), expected: p.expected,
    };
    this.openWorkspace(ws);
  }

  files() { return this.ws.files.map((f, i) => ({ name: f.name, text: this.models[i] ? this.models[i].getValue() : f.text })); }
  activeFile() { return this.files()[this.ws.active]; }

  // ----- markers / problems -----
  setDiagnostics(diags) {
    const monaco = this.monaco;
    const sevMap = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
    this.models.forEach((m, i) => {
      const name = this.ws.files[i].name;
      const mine = diags.filter(d => d.file === name);
      monaco.editor.setModelMarkers(m, 'build', mine.map(d => ({
        severity: sevMap[d.severity], message: d.message,
        startLineNumber: d.line, startColumn: d.col, endLineNumber: d.line, endColumn: Math.max(d.col + 1, m.getLineMaxColumn(Math.min(d.line, m.getLineCount()))),
      })));
    });
    this.probList.innerHTML = '';
    const real = diags.filter(d => d.severity !== 'info');
    if (!diags.length) this.probList.append(h('li', { style: { cursor: 'default', color: 'var(--text-3)' } }, 'No problems. Clean build.'));
    diags.forEach(d => {
      this.probList.append(h('li', { onclick: () => this.jump(d.file, d.line, d.col) },
        h('span', { class: `sev ${d.severity[0]}` }, d.severity === 'info' ? 'note' : d.severity),
        h('span', { class: 'loc' }, `${d.file}:${d.line}:${d.col}`),
        h('span', {}, d.message)));
    });
    const errs = real.filter(d => d.severity === 'error').length;
    this.badge('problems', real.length, errs ? '' : 'warn');
  }

  jump(file, line, col = 1) {
    const i = this.ws.files.findIndex(f => f.name === file);
    if (i >= 0 && i !== this.ws.active) this.setActive(i);
    this.editor.revealLineInCenter(line);
    this.editor.setPosition({ lineNumber: line, column: col });
    this.editor.focus();
  }

  // ----- run -----
  setBusy(on, label) {
    this.busy = on;
    const b = this.r.runBtn;
    if (on) {
      b.dataset.html ||= b.innerHTML;
      if (this.ws.lang === 'python') { b.innerHTML = '■ Stop'; b.disabled = false; b.onclick = () => runPython.cancel && runPython.cancel(); }
      else { b.innerHTML = `<span class="spin"></span> ${label || 'Running'}`; b.disabled = true; }
      this.status(label || 'Running…', 'busy');
    } else {
      b.innerHTML = b.dataset.html; b.disabled = false; b.onclick = () => this.run();
    }
  }

  async run() {
    if (this.busy) return;
    const ws = this.ws;
    this.showPane('output');
    if (isCompiled(ws.lang)) return this.runCompiled();
    if (ws.lang === 'sql') return this.runSqlWs();
    return this.runPy();
  }

  async runCompiled() {
    const ws = this.ws;
    const files = this.files();
    if (!files.some(f => SOURCE_EXT.test(f.name))) { toast('Add a .c or .cpp file to run'); return; }
    this.setBusy(true, 'Compiling and running…');
    this.outHost.innerHTML = '';
    try {
      const res = await runProgram({ lang: ws.lang, compiler: this.r.compiler.value, flags: this.r.flags.value, files, stdin: this.stdinEl.value, args: this.argsEl.value.trim() ? this.argsEl.value.trim().split(/\s+/) : [] });
      const cname = COMPILERS[ws.lang].find(c => c.id === this.r.compiler.value)?.name || '';
      this.outHost.append(consoleFor(res, { files: files.map(f => f.name), onJump: (f, l, c) => this.jump(f, l, c), compilerName: cname + ':' }));
      if (res.didExecute && ws.expected !== undefined) this.outHost.append(verdictEl(compareOutput(res.stdout, ws.expected)));
      this.setDiagnostics(res.diagnostics);
      if (!res.built) { this.status(`Build failed · ${res.diagnostics.filter(d => d.severity === 'error').length} error(s)`, 'err'); }
      else if (res.didExecute) this.status(`Exit code ${res.exitCode} · ${(res.ms / 1000).toFixed(1)} s · ${res.mode === 'cmake' ? 'CMake multi-file build' : 'single file'}`, res.exitCode === 0 ? 'ok' : 'err');
      else this.status('Did not execute', 'err');
      if (this.activePane === 'asm' || this.asmMap) this.asmMap = null;
    } catch (e) {
      this.outHost.append(h('pre', { class: 'console' }, h('span', { class: 'err' }, String(e.message || e))));
      this.status('Network error', 'err');
    } finally { this.setBusy(false); }
  }

  async runSqlWs() {
    const model = this.editor.getModel();
    const sel = this.editor.getSelection();
    const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
    const text = selected || model.getValue();
    const lineOffset = selected ? sel.startLineNumber - 1 : 0;
    this.setBusy(true, 'Starting PostgreSQL…');
    this.outHost.innerHTML = '';
    try {
      const db = await this.sqlDb();
      this.status('Running SQL…', 'busy');
      const out = await runSql(db, text);
      this.outHost.append(sqlResultEl(out));
      const monaco = this.monaco;
      monaco.editor.setModelMarkers(model, 'sql', out.error ? [{ severity: monaco.MarkerSeverity.Error, message: out.error.message, startLineNumber: out.error.line + lineOffset, startColumn: out.error.col, endLineNumber: out.error.line + lineOffset, endColumn: out.error.col + 8 }] : []);
      this.status(out.error ? `Error at line ${out.error.line + lineOffset}` : `${out.results.length} statement(s) OK${selected ? ' (selection)' : ''}`, out.error ? 'err' : 'ok');
      this.refreshSchema();
    } catch (e) {
      this.outHost.append(h('pre', { class: 'console' }, h('span', { class: 'err' }, String(e.message || e))));
      this.status('PostgreSQL failed to start', 'err');
    } finally { this.setBusy(false); }
  }

  async runPy() {
    const files = this.files();
    const main = files.find(f => f.name === 'main.py') || files[this.ws.active];
    this.outHost.innerHTML = '';
    const pre = h('pre', { class: 'console' });
    this.outHost.append(pre);
    this.setBusy(true, 'Loading Python…');
    const res = await runPython(main.text, {
      stdin: this.stdinEl.value,
      onOut: s => pre.append(s), onErr: s => pre.append(h('span', { class: 'err' }, s)),
      onStatus: s => this.status(s, 'busy'),
    });
    if (!res.ok) pre.append(h('span', { class: 'err' }, (res.error || 'Error') + '\n'));
    pre.append(h('span', { class: 'meta' }, `───── ${res.ok ? 'finished' : 'stopped'}${res.ms ? ` in ${(res.ms / 1000).toFixed(2)} s` : ''}`));
    if (res.ok && this.ws.expected !== undefined) this.outHost.append(verdictEl(compareOutput(res.stdout, this.ws.expected)));
    this.status(res.ok ? 'Finished' : 'Error', res.ok ? 'ok' : 'err');
    this.setBusy(false);
  }

  // Exercises get their own in-memory database preloaded with the exercise's setup.sql.
  async sqlDb() {
    if (this.ex && this.ex.lang === 'sql') {
      if (!this.exDb || this.exDbId !== this.ex.id) {
        const db = await createDb();
        const setup = await loadSetup(this.ex);
        if (setup) await runSql(db, setup);
        this.exDb = db;
        this.exDbId = this.ex.id;
      }
      return this.exDb;
    }
    return getDb();
  }

  async refreshSchema() {
    if (this.ws.lang !== 'sql') return;
    try {
      const db = await this.sqlDb();
      const s = await describeSchema(db);
      this.dbBody.innerHTML = '';
      if (!s.tables.length && !s.functions.length) { this.dbBody.textContent = 'The public schema is empty.'; return; }
      s.tables.forEach(t => this.dbBody.append(h('div', { class: 'tbl' },
        h('div', {}, h('b', {}, t.table), t.kind === 'v' ? ' (view)' : ''),
        (t.cols || []).map(c => h('div', { class: 'col' }, `${c.n}  ${c.t}`)),
        (t.idx || []).map(i => h('div', { class: 'col', style: { color: 'var(--text-3)' } }, `index ${i}`)))));
      if (s.functions.length) this.dbBody.append(h('div', { class: 'tbl' }, h('b', {}, 'functions'), s.functions.map(f => h('div', { class: 'col' }, `${f.name}(${f.args})  ${f.lang}`))));
    } catch (e) { this.dbBody.textContent = String(e.message || e); }
  }

  // ----- visualise -----
  visualize() {
    const ws = this.ws;
    const f = this.activeFile();
    this.showPane('viz');
    const lang = ws.lang;
    let code = f.text;
    const warns = tutorWarnings(lang, code);
    if (isCompiled(lang) && this.ws.files.filter(x => SOURCE_EXT.test(x.name)).length > 1) warns.unshift('Only the current file is visualised; multi-file projects are not supported there.');
    if (isCompiled(lang) && /#include\s+"/.test(code)) warns.unshift('Local #include "..." files are not available to the visualiser; paste their contents into this file to visualise.');
    this.vizBody.innerHTML = '';
    const big = tutorTooLong(lang, code);
    if (big) {
      this.vizBody.append(h('div', { class: 'pane-empty' }, h('h4', {}, 'Too long for the visualiser'),
        `After removing comments this file is ${big} URL-encoded bytes; the visualiser accepts about ${TUTOR_LIMIT}. Delete the parts you do not want to watch (or copy one function and a small main into a new workspace) and press Visualize again.`));
      return;
    }
    this.vizBody.append(
      h('div', { class: 'pane-head' },
        h('span', {}, 'Next / Prev step through execution. Frames (left) hold local variables; objects (right) are heap memory; arrows are pointers.'),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', onclick: () => this.visualize() }, 'Re-run'),
        h('a', { class: 'btn sm', href: tutorUrl(lang, code, { stdin: this.stdinEl.value, embed: false }), target: '_blank', rel: 'noopener' }, 'Full screen ↗')),
      warns.length ? h('div', { class: 'pane-head', style: { color: 'var(--warn)' } }, warns.join(' ')) : null,
      h('iframe', { class: 'viz-frame', src: tutorUrl(lang, code, { stdin: this.stdinEl.value }), title: 'Step-by-step memory visualiser' }));
  }

  // ----- assembly -----
  async assembly() {
    const f = this.activeFile();
    if (!SOURCE_EXT.test(f.name) && !HEADER_EXT.test(f.name)) return toast('Open a .c or .cpp file first');
    this.showPane('asm');
    this.asmBody.innerHTML = '<div class="pane-empty">Compiling…</div>';
    try {
      const { asm, ok, errors } = await compileAsm({ lang: this.ws.lang, compiler: this.r.compiler.value, flags: this.r.flags.value, source: f.text, files: this.files() });
      this.asmBody.innerHTML = '';
      if (!ok) { this.asmBody.append(h('pre', { class: 'console' }, errors || 'Compilation failed')); return; }
      this.asmMap = new Map();
      const frag = document.createDocumentFragment();
      asm.forEach((a, idx) => {
        const cls = a.line ? `al asm-c${a.line % 10} asm-g${a.line % 10}` : 'al';
        const el = h('span', { class: cls, 'data-line': a.line || '' });
        if (a.isLabel) el.append(h('span', { class: 'lbl' }, a.text)); else el.textContent = a.text || ' ';
        if (a.line) {
          if (!this.asmMap.has(a.line)) this.asmMap.set(a.line, []);
          this.asmMap.get(a.line).push(el);
          el.title = `${f.name} line ${a.line}`;
          el.addEventListener('mouseenter', () => this.flashSource(a.line));
          el.addEventListener('click', () => this.jump(f.name, a.line));
        }
        frag.append(el);
      });
      this.asmBody.append(frag);
      const flags = this.r.flags.value;
      this.asmHead.firstChild.textContent = `${asm.length} lines of x86-64 (Intel syntax) for ${f.name} with ${(flags.match(/-O\w*/) || ['-O0'])[0]}. Colours link source lines to their instructions; try -O2 to see the optimiser at work.`;
      this.asmDeco.set([...this.asmMap.keys()].map(l => ({ range: new this.monaco.Range(l, 1, l, 1), options: { isWholeLine: true, className: `asm-c${l % 10}` } })));
    } catch (e) { this.asmBody.innerHTML = ''; this.asmBody.append(h('pre', { class: 'console' }, String(e.message || e))); }
  }
  flashSource(line) {
    this.hlDeco.set([{ range: new this.monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'monaco-src-hl' } }]);
    this.editor.revealLineInCenterIfOutsideViewport(line);
  }
  highlightAsmFor(line) {
    if (!this.asmMap) return;
    this.asmBody.querySelectorAll('.al.hot').forEach(e => e.classList.remove('hot'));
    const els = this.asmMap.get(line);
    if (els && els.length) { els.forEach(e => e.classList.add('hot')); if (this.activePane === 'asm') els[0].scrollIntoView({ block: 'nearest' }); }
  }

  // ----- layout -----
  async layout() {
    const f = this.activeFile();
    this.showPane('layout');
    this.layoutBody.innerHTML = '<div class="pane-empty">Asking Clang for the record layouts…</div>';
    try {
      const all = this.files();
      const src = SOURCE_EXT.test(f.name) || HEADER_EXT.test(f.name) ? f.text : all.find(x => SOURCE_EXT.test(x.name))?.text || '';
      const { records, ok, errors } = await structLayout({ lang: this.ws.lang, flags: this.r.flags.value, source: src, files: all });
      this.layoutBody.innerHTML = '';
      if (!ok && !records.length) { this.layoutBody.append(h('pre', { class: 'console' }, errors || 'Clang could not parse the file')); return; }
      this.layoutBody.append(h('div', { class: 'pane-head' }, `Layout computed by Clang 21 for x86-64 Linux (the same ABI GCC uses). Each square is one byte; hatched squares are padding.`));
      this.layoutBody.append(layoutEl(records));
    } catch (e) { this.layoutBody.innerHTML = ''; this.layoutBody.append(h('pre', { class: 'console' }, String(e.message || e))); }
  }

  // ----- share / download -----
  async share() {
    const ws = this.ws;
    const data = { lang: ws.lang, files: this.files(), compiler: ws.compiler, flags: ws.flags, stdin: ws.stdin, args: ws.args };
    const packed = await packText(JSON.stringify(data));
    const url = `${location.origin}${location.pathname}#/ide?share=${packed}`;
    if (url.length > 60000) return toast('Too much code to fit in a link');
    copyText(url);
    toast('Link copied: anyone with it can open this code');
  }
  download() {
    const f = this.activeFile();
    const a = h('a', { href: URL.createObjectURL(new Blob([f.text], { type: 'text/plain' })), download: f.name });
    document.body.append(a); a.click(); a.remove();
  }

  // ----- exercises -----
  exitExercise() {
    if (!this.ex) return;
    this.ex = null;
    this.r.exPane.hidden = true;
    this.r.checkBtn.hidden = true;
    this.setPaneVisible('tests', false);
  }

  async openExercise(id) {
    let ex;
    try { ex = await loadExercise(id); }
    catch (e) { this.r.exPane.hidden = false; this.r.exPane.innerHTML = `<div class="err-page">${esc(e.message)}</div>`; return; }
    this.ex = ex;
    const wsId = `ex:${id}`;
    let ws = allWs()[wsId];
    if (!ws || JSON.stringify(ws.orig) !== JSON.stringify(ex.starter)) {
      // new exercise, or the starter changed upstream: keep edits only if the starter is unchanged
      const keep = ws && JSON.stringify(ws.orig) === JSON.stringify(ex.starter);
      ws = keep ? ws : {
        id: wsId, name: ex.title, lang: ex.lang, files: clone(ex.starter), orig: clone(ex.starter), active: 0,
        compiler: ex.compiler || defaultCompiler(ex.lang), flags: ex.flags || (isCompiled(ex.lang) ? defaultFlags(ex.lang) : ''), preset: 'custom',
        stdin: ex.tests[0] && ex.tests[0].stdin ? lines(ex.tests[0].stdin) : '', args: '',
      };
    }
    this.r.checkBtn.hidden = false;
    this.renderExercisePane();
    this.openWorkspace(ws);
    this.renderTests();
    this.showPane('tests');
  }

  renderExercisePane() {
    const ex = this.ex;
    const pane = this.r.exPane;
    pane.hidden = false;
    pane.innerHTML = '';
    const done = progress.exerciseDone(ex.id);
    pane.append(
      h('div', { class: 'crumbs' }, h('a', { href: '#/exercises' }, 'Exercises'), '›', h('span', {}, ex.phaseTitle || '')),
      h('h2', {}, ex.title),
      h('div', { style: { margin: '4px 0 12px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        h('span', { class: `tag ${ex.difficulty}` }, ex.difficulty),
        h('span', { class: 'tag' }, LANGS[ex.lang]),
        done ? h('span', { class: 'tag easy' }, '✓ solved') : null),
      ex.module ? h('p', { style: { fontSize: '13px', margin: '0 0 10px' } }, 'Read first: ', h('a', { href: `#/read/${ex.module}` }, ex.moduleTitle || ex.module)) : null,
      h('div', { class: 'md', html: mdHtml(ex.readme) }));
    if (ex.setupFile) {
      const setup = h('details', { class: 'md' }, h('summary', {}, 'Tables created for you before your SQL runs'));
      setup.addEventListener('toggle', async () => {
        if (!setup.open || setup.dataset.loaded) return;
        setup.dataset.loaded = '1';
        const code = h('code', { class: 'language-pgsql' }, await loadSetup(ex));
        try { window.hljs && window.hljs.highlightElement(code); } catch (e) { /* ignore */ }
        setup.append(h('div', { class: 'cb' }, h('pre', {}, code)));
      });
      pane.append(setup);
      pane.append(h('p', { style: { fontSize: '12.5px', color: 'var(--text-3)' } }, 'Check runs your file on a fresh database with these tables, so experiments in Run do not affect the result.'));
    }
    if (ex.hints && ex.hints.length) {
      const hl = h('div', { class: 'hint-list md' }, h('h2', {}, 'Hints'));
      ex.hints.forEach((t, i) => hl.append(h('details', {}, h('summary', {}, `Hint ${i + 1}`), h('div', { style: { paddingBottom: '10px' }, html: mdHtml(t) }))));
      pane.append(hl);
    }
    const sol = h('details', { class: 'md' }, h('summary', {}, 'Reference solution (try first!)'));
    sol.addEventListener('toggle', async () => {
      if (!sol.open || sol.dataset.loaded) return;
      sol.dataset.loaded = '1';
      const files = await loadSolution(ex);
      files.forEach(f => {
        const code = h('code', { class: `language-${f.name.endsWith('.sql') ? 'pgsql' : f.name.endsWith('.py') ? 'python' : ex.lang}` }, f.text);
        try { window.hljs && window.hljs.highlightElement(code); } catch (e) { /* ignore */ }
        sol.append(h('div', { class: 'cb' }, h('div', { class: 'cb-bar' }, h('span', { class: 'cb-file' }, f.name), h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost', onclick: () => copyText(f.text) }, 'Copy')), h('pre', {}, code)));
      });
    });
    pane.append(h('div', { style: { marginTop: '18px' } }, sol));
  }

  renderTests(results = []) {
    const ex = this.ex;
    const body = this.testsBody;
    body.innerHTML = '';
    const head = h('div', { class: 'pane-head' }, h('span', {}, `${ex.tests.length} test${ex.tests.length === 1 ? '' : 's'}${isCompiled(ex.lang) ? ` · built with ${ex.flags || defaultFlags(ex.lang)}` : ''}`), h('span', { class: 'sp' }), h('button', { class: 'btn sm ok', onclick: () => this.check() }, '✓ Check'));
    body.append(head);
    this.banner = h('div');
    body.append(this.banner);
    const ul = h('ul', { class: 'tests' });
    this.testEls = ex.tests.map((t, i) => {
      const li = h('li');
      this.paintTest(li, t, results[i] || { state: 'idle' });
      ul.append(li);
      return li;
    });
    body.append(h('div', { style: { overflow: 'auto', flex: '1' } }, ul));
  }

  paintTest(li, t, st) {
    li.innerHTML = '';
    const icon = { idle: '·', run: '…', pass: '✓', fail: '✗' }[st.state];
    li.append(h('div', { class: 't-head' }, h('span', { class: `ic ${st.state}` }, icon), h('b', {}, t.name), st.why ? h('span', { style: { color: 'var(--err)', fontSize: '12.5px' } }, st.why) : null));
    if (t.stdin && t.stdin.length && st.state !== 'pass') li.append(h('details', {}, h('summary', { style: { fontSize: '12px', color: 'var(--text-3)', cursor: 'pointer' } }, 'input'), h('pre', {}, lines(t.stdin))));
    if (st.state === 'fail' && (st.got !== undefined)) {
      const a = normOut(st.got).split('\n'); const e = normOut(st.expected).split('\n');
      const rows = Array.from({ length: Math.max(a.length, e.length) }, (_, k) => ({ a: a[k] ?? '', e: e[k] ?? '', ok: (a[k] ?? '') === (e[k] ?? '') }));
      li.append(diffView(rows, ['Expected', 'Your program']));
      if (st.stderr && st.stderr.trim()) li.append(h('pre', { class: 'console', style: { marginTop: '8px', maxHeight: '220px' } }, st.stderr.slice(0, 4000)));
    }
  }

  async check() {
    if (!this.ex || this.busy) return;
    const ex = this.ex;
    this.showPane('tests');
    this.renderTests();
    this.r.checkBtn.disabled = true;
    this.status('Checking…', 'busy');
    let results = [];
    try {
      results = await checkExercise(ex, this.files(), { onTest: (i, st) => this.paintTest(this.testEls[i], ex.tests[i], st) });
    } catch (e) {
      this.banner.className = 'banner err'; this.banner.textContent = String(e.message || e);
      this.r.checkBtn.disabled = false; this.status('Check failed', 'err');
      return;
    }
    this.r.checkBtn.disabled = false;
    const passed = results.filter(r => r.pass).length;
    const all = passed === results.length;
    this.banner.className = `banner ${all ? 'ok' : 'err'}`;
    this.banner.textContent = all ? `${passed === 1 ? 'The test passes' : `All ${passed} tests pass`}. Exercise solved! Write a journal line about what tripped you up.` : `${passed} of ${results.length} tests pass. Open a failing test to compare outputs.`;
    this.badge('tests', all ? '✓' : results.length - passed, all ? 'ok' : '');
    // Show the first test's build output in the Output pane for context.
    const first = results.find(r => r.res) || null;
    if (first && first.res) { this.outHost.innerHTML = ''; this.outHost.append(consoleFor(first.res, { files: this.ws.files.map(f => f.name), onJump: (f, l, c) => this.jump(f, l, c) })); this.setDiagnostics(first.res.diagnostics); }
    if (all) { progress.setExercise(ex.id); this.renderExercisePane(); }
    this.status(all ? 'All tests pass' : `${results.length - passed} failing`, all ? 'ok' : 'err');
  }
}
