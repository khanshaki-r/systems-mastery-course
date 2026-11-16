// Compile and run C/C++ on Compiler Explorer (godbolt.org), which provides real GCC/Clang
// toolchains and a sandboxed x86-64 Linux executor. No setup on the learner's machine.
// This module has no DOM dependencies so tools/verify-exercises.mjs can reuse it under Node.

const API = 'https://godbolt.org/api';

export const COMPILERS = {
  c: [
    { id: 'cg133', name: 'GCC 13.3', note: 'as on Ubuntu 24.04' },
    { id: 'cg152', name: 'GCC 15.2' },
    { id: 'cclang2110', name: 'Clang 21.1' },
  ],
  cpp: [
    { id: 'g133', name: 'GCC 13.3', note: 'as on Ubuntu 24.04' },
    { id: 'g152', name: 'GCC 15.2' },
    { id: 'clang2110', name: 'Clang 21.1' },
  ],
};
export const LAYOUT_COMPILER = { c: 'cclang2110', cpp: 'clang2110' };

export const PRESETS = {
  debug: { label: 'Debug (-O0 -g)', flags: '-O0 -g' },
  release: { label: 'Release (-O2)', flags: '-O2' },
  asan: { label: 'AddressSanitizer + UBSan', flags: '-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer' },
  tsan: { label: 'ThreadSanitizer', flags: '-O1 -g -fsanitize=thread' },
};
export const STD_DEFAULT = { c: '-std=c17', cpp: '-std=c++17' };
export const WARN_DEFAULT = '-Wall -Wextra';

export function defaultFlags(lang, preset = 'debug') {
  const base = `${STD_DEFAULT[lang]} ${WARN_DEFAULT} ${PRESETS[preset].flags}`;
  return lang === 'cpp' ? `${base} -pthread` : base;
}

const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\[K/g;
const strip = s => String(s ?? '').replace(ANSI_RE, '');
const joinText = arr => (arr || []).map(x => x.text).join('\n');

export const SOURCE_EXT = /\.(c|cc|cpp|cxx|c\+\+)$/i;
export const HEADER_EXT = /\.(h|hh|hpp|hxx|inc|ipp|tpp)$/i;

// Keep only flags that make sense for a single sandboxed build: drop -o, -c, file names, -I/-L paths,
// and libraries that do not exist on the executor (libdb, libpq, ...).
export function sanitizeFlags(flags) {
  const out = [];
  const toks = String(flags || '').replace(/["']/g, '').split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-o' || t === '-MF' || t === '-MT' || t === '-MQ' || t === '-I' || t === '-L') { i++; continue; }
    if (t === '-c' || t === '-S' || t === '-E' || /^-M(M?D|P)$/.test(t)) continue;
    if (/^-[IL]/.test(t)) continue;
    if (/^-l/.test(t) && !/^-l(m|pthread|rt|atomic|dl)$/.test(t)) continue;
    if (!t.startsWith('-')) continue;
    out.push(t);
  }
  return out.join(' ');
}

async function post(path, body, signal) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (r.status === 429) throw new Error('Compiler Explorer is rate-limiting requests right now. Wait a few seconds and try again.');
  if (!r.ok) throw new Error(`Compiler Explorer returned HTTP ${r.status}. Try again in a moment.`);
  return r.json();
}

// Parse GCC/Clang/CMake diagnostics out of raw compiler text.
const DIAG_RE = /^(?:.*?\/)?(<source>|[^\s:/]+\.[A-Za-z+]+):(\d+):(?:(\d+):)?\s+(fatal error|error|warning|note):\s+(.*)$/;
export function parseDiagnostics(text, mainFile) {
  const out = [];
  for (const raw of strip(text).split('\n')) {
    const m = raw.match(DIAG_RE);
    if (!m) continue;
    let file = m[1];
    if (file === '<source>' || /^example\.(c|cpp)$/.test(file)) file = mainFile;
    const sev = m[4] === 'note' ? 'info' : (m[4] === 'warning' ? 'warning' : 'error');
    out.push({ file, line: +m[2], col: m[3] ? +m[3] : 1, severity: sev, message: m[5] });
  }
  return out;
}

// Replace Compiler Explorer's internal names with the learner's file names.
function tidy(text, mainFile) {
  return String(text ?? '')
    .replace(/<source>/g, mainFile)
    .replace(/\/app\/example\.(c|cpp)/g, mainFile)
    .replace(/\/app\/build\//g, '')
    .replace(/\/app\//g, '')
    .replace(/\(\/app\/output\.s\+/g, '(prog+')
    .replace(/\/nosym\/tmp\/compiler-explorer-compiler\w+\/build\/output\.s/g, 'prog')
    .replace(/\/cefs\/[0-9a-f]+\/[0-9a-f]+_consolidated\/compilers_c\+\+_x86_gcc_[\d.]+\//g, '<gcc>/')
    .replace(/\/opt\/compiler-explorer\/gcc-[\d.]+\//g, '<gcc>/');
}

function makeCMakeLists(lang, flags, sources) {
  const san = flags.split(/\s+/).filter(f => /^-fsanitize|^-pthread$|^-l|^-static|^-fno-omit-frame-pointer$|^-g/.test(f)).join(' ');
  return [
    'cmake_minimum_required(VERSION 3.16)',
    'project(lab LANGUAGES C CXX)',
    `set(CMAKE_C_FLAGS "${lang === 'c' ? flags : ''}")`,
    `set(CMAKE_CXX_FLAGS "${lang === 'cpp' ? flags : ''}")`,
    `set(CMAKE_EXE_LINKER_FLAGS "${san}")`,
    '# Compiler Explorer runs the executable named output.s',
    `add_executable(output.s ${sources.join(' ')})`,
    '',
  ].join('\n');
}

/**
 * Build and run a program.
 * files: [{ name, text }]; lang: 'c' | 'cpp'. Returns a normalised result object.
 */
// ThreadSanitizer from GCC 13/14 fails to start on Compiler Explorer's executor kernel
// ("unexpected memory mapping" or SIGSEGV); GCC 15 and Clang work. Switch transparently.
export function tsanCompatible(compiler, flags) {
  if (/-fsanitize=(\S*,)?thread/.test(flags) && /^c?g1[34]\d$/.test(compiler)) {
    return { compiler: compiler.startsWith('c') ? 'cg152' : 'g152', note: 'ThreadSanitizer in GCC 13/14 cannot start on the sandbox kernel, so this build used GCC 15.2.' };
  }
  return { compiler, note: '' };
}

export async function runProgram({ lang, compiler, flags, files, stdin = '', args = [], signal }) {
  const t0 = Date.now();
  const clean = sanitizeFlags(flags);
  const compat = tsanCompatible(compiler, clean);
  compiler = compat.compiler;
  const sources = files.filter(f => SOURCE_EXT.test(f.name));
  const cmakeFile = files.find(f => /^cmakelists\.txt$/i.test(f.name));
  const useCMake = sources.length > 1 || !!cmakeFile;
  let mainFile = (sources.find(f => /\bmain\s*\(/.test(f.text)) || sources[0] || files[0]).name;

  const exec = { args, stdin };
  if (!useCMake) {
    const main = files.find(f => f.name === mainFile);
    const extra = files.filter(f => f !== main && HEADER_EXT.test(f.name)).map(f => ({ filename: f.name, contents: f.text }));
    const d = await post(`/compiler/${compiler}/compile`, {
      source: main.text,
      files: extra,
      lang: lang === 'c' ? 'c' : 'c++',
      options: {
        userArguments: clean,
        executeParameters: exec,
        compilerOptions: { executorRequest: true },
        filters: { execute: true },
        tools: [], libraries: [],
      },
      allowStoreCodeDebug: false,
    }, signal);
    const build = d.buildResult || {};
    const buildText = [joinText(build.stdout), joinText(build.stderr)].filter(Boolean).join('\n');
    const built = build.code === 0;
    return {
      mode: 'single', mainFile, flags: clean, compiler, note: compat.note,
      built, didExecute: !!d.didExecute,
      exitCode: d.didExecute ? d.code : null,
      stdout: d.didExecute ? strip(joinText(d.stdout)) : '',
      stderrRaw: d.didExecute ? tidy(joinText(d.stderr), mainFile) : '',
      buildRaw: tidy(buildText, mainFile),
      diagnostics: parseDiagnostics(buildText, mainFile),
      timedOut: !!(d.timedOut || build.timedOut),
      truncated: !!d.truncated,
      ms: Date.now() - t0,
    };
  }

  const cmakeText = cmakeFile ? cmakeFile.text : makeCMakeLists(lang, clean, sources.map(s => s.name));
  const d = await post(`/compiler/${compiler}/cmake`, {
    source: cmakeText,
    files: files.filter(f => f !== cmakeFile).map(f => ({ filename: f.name, contents: f.text })),
    lang: 'cmake',
    options: {
      userArguments: clean, cmakeArgs: '',
      executeParameters: exec,
      compilerOptions: { executorRequest: true },
      filters: { execute: true },
      tools: [], libraries: [],
    },
  }, signal);
  const steps = d.buildsteps || [];
  const buildText = steps.map(s => [joinText(s.stdout), joinText(s.stderr)].filter(Boolean).join('\n'))
    .concat([joinText(d.result?.stderr)]).filter(Boolean).join('\n');
  const built = steps.length > 0 && steps.every(s => s.code === 0) && (d.result ? d.result.code === 0 : true);
  const ex = d.execResult || {};
  const didExecute = built && !!d.didExecute;
  return {
    mode: 'cmake', mainFile, flags: clean, cmakeText, compiler, note: compat.note,
    built, didExecute,
    exitCode: didExecute ? ex.code : null,
    stdout: didExecute ? strip(joinText(ex.stdout)) : '',
    stderrRaw: didExecute ? tidy(joinText(ex.stderr), mainFile) : '',
    buildRaw: tidy(buildText, mainFile),
    diagnostics: parseDiagnostics(buildText, mainFile),
    timedOut: !!(d.timedOut || ex.timedOut),
    truncated: !!ex.truncated,
    ms: Date.now() - t0,
  };
}

/** Compile one file to assembly. Returns [{ text, line, isLabel }]. */
export async function compileAsm({ lang, compiler, flags, source, files = [], signal }) {
  const d = await post(`/compiler/${compiler}/compile`, {
    source,
    files: files.filter(f => HEADER_EXT.test(f.name)).map(f => ({ filename: f.name, contents: f.text })),
    lang: lang === 'c' ? 'c' : 'c++',
    options: {
      userArguments: sanitizeFlags(flags).replace(/-fsanitize=\S+/g, ''),
      compilerOptions: {},
      filters: { binary: false, labels: true, directives: true, commentOnly: true, demangle: true, intel: true, libraryCode: true, execute: false },
      tools: [], libraries: [],
    },
  }, signal);
  const asm = (d.asm || []).map(a => ({
    text: a.text,
    line: a.source && (a.source.file === null || a.source.file === undefined) ? a.source.line : null,
    isLabel: /^[^\s].*:/.test(a.text),
  }));
  return { asm, ok: d.code === 0, errors: strip(joinText(d.stderr)) };
}

// ---------- struct / class layout (Clang record-layout dump + -Wpadded) ----------

// Every struct/class/union the user defined, with its namespace/class qualification,
// so sizeof(ns::Name) can force Clang to lay it out. Templates are skipped.
function userRecordNames(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, m => ' '.repeat(m.length));
  const names = new Map();   // qualified name -> keyword
  const scope = [];          // one entry per open brace: a name for namespaces/records, '' otherwise
  const re = /\b(namespace|struct|class|union)\s+([A-Za-z_]\w*)[^;{}()]*\{|\{|\}/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[0] === '}') { scope.pop(); continue; }
    if (m[0] === '{') { scope.push(''); continue; }
    const before = code.slice(Math.max(0, m.index - 200), m.index);
    const stmt = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('}'), before.lastIndexOf('{')) + 1);
    const inFunction = scope.some(s => s === '');
    if (m[1] !== 'namespace' && !/\btemplate\b/.test(stmt) && !inFunction) {
      names.set([...scope, m[2]].join('::'), m[1]);
    }
    scope.push(m[2]);
  }
  for (const t of code.matchAll(/typedef\s+(?:struct|union)\s*(?:[A-Za-z_]\w*)?\s*\{[\s\S]*?\}\s*([A-Za-z_]\w*)\s*;/g)) names.set(t[1], 'typedef');
  return names;
}

function bareName(n) { return n.replace(/^(struct|class|union)\s+/, '').trim(); }

export function parseRecordLayouts(text, padWarnings) {
  const records = [];
  for (const block of strip(text).split('*** Dumping AST Record Layout').slice(1)) {
    const lines = block.split('\n').filter(l => l.trim());
    const rows = [];
    let sizeof = null, align = null;
    for (const l of lines) {
      const m = l.match(/^\s*(\d+)(?::(\d+)-(\d+))?\s*\|(\s*)(.*)$/);
      if (m) { rows.push({ off: +m[1], bitLo: m[2] ? +m[2] : null, bitHi: m[3] ? +m[3] : null, indent: m[4].length, decl: m[5].trim() }); continue; }
      const s = l.match(/sizeof=(\d+)/); if (s) sizeof = +s[1];
      const a = l.match(/\balign=(\d+)/); if (a) align = +a[1];
    }
    if (!rows.length || sizeof === null) continue;
    const head = rows[0];
    const fullName = head.decl;
    const kind = (fullName.match(/^(struct|class|union)\b/) || [, 'struct'])[1];
    const name = bareName(fullName);
    const top = rows.filter(r => r.indent === head.indent + 2);
    const fields = top.map(r => {
      const decl = r.decl;
      const nm = decl.startsWith('(') ? decl : (decl.match(/([A-Za-z_]\w*)\s*$/) || [, decl])[1];
      const type = decl.startsWith('(') ? '' : decl.slice(0, decl.length - nm.length).trim();
      return { name: nm, type, decl, off: r.off, bitLo: r.bitLo, bitHi: r.bitHi };
    });
    const pads = padWarnings.filter(p => bareName(p.record) === name);
    const padBefore = new Map(pads.filter(p => p.field).map(p => [p.field, p.bits ? Math.ceil(p.amount / 8) : p.amount]));
    const tail = pads.find(p => !p.field);
    const tailBytes = tail ? (tail.bits ? Math.floor(tail.amount / 8) : tail.amount) : 0;
    // Field byte sizes: distance to the next distinct offset minus the padding reported before it.
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (kind === 'union') { f.size = null; continue; }
      let j = i + 1; while (j < fields.length && fields[j].off === f.off) j++;
      const nextOff = j < fields.length ? fields[j].off : sizeof - tailBytes;
      const padNext = j < fields.length ? (padBefore.get(fields[j].name) || 0) : 0;
      f.size = Math.max(0, nextOff - f.off - padNext);
      f.sharesWithNext = j > i + 1;
    }
    records.push({ name, kind, sizeof, align, fields, padding: pads.reduce((n, p) => n + (p.bits ? p.amount / 8 : p.amount), 0), anonymous: /unnamed/.test(name) });
  }
  return records;
}

function parsePadWarnings(text) {
  const out = [];
  for (const l of strip(text).split('\n')) {
    let m = l.match(/padding (?:struct|class|union) '([^']+)' with (\d+) (bytes?|bits?) to align '([^']+)'/);
    if (m) { out.push({ record: m[1], amount: +m[2], bits: m[3].startsWith('bit'), field: m[4] }); continue; }
    m = l.match(/padding size of '([^']+)' with (\d+) (bytes?|bits?) to alignment boundary/);
    if (m) out.push({ record: m[1], amount: +m[2], bits: m[3].startsWith('bit'), field: null });
  }
  return out;
}

export async function structLayout({ lang, flags, source, files = [], signal }) {
  const names = userRecordNames(source);
  const std = (String(flags).match(/-std=\S+/) || [STD_DEFAULT[lang]])[0];
  const defs = (String(flags).match(/-D\S+/g) || []).join(' ');
  // Force a layout for every user record, even unused ones, by asking for its size.
  const forceLine = ([n, kw], i) => {
    const ty = lang === 'c' && kw !== 'typedef' ? `${kw === 'union' ? 'union' : 'struct'} ${n}` : n;
    return `extern char sm_layout_force_${i}[sizeof(${ty})];`;
  };
  const entries = [...names.entries()].slice(0, 24);
  const call = async (src) => post(`/compiler/${LAYOUT_COMPILER[lang]}/compile`, {
    source: src,
    files: files.filter(f => HEADER_EXT.test(f.name)).map(f => ({ filename: f.name, contents: f.text })),
    lang: lang === 'c' ? 'c' : 'c++',
    options: { userArguments: `${std} ${defs} -Xclang -fdump-record-layouts -Wpadded -fsyntax-only`, filters: {}, tools: [], libraries: [] },
  }, signal);
  let d = await call(`${source}\n${entries.map(forceLine).join('\n')}\n`);
  if (d.code !== 0 && entries.length) {
    // One forced sizeof did not compile (an incomplete type, say). Keep only the ones that do.
    const good = [];
    for (let i = 0; i < Math.min(entries.length, 8); i++) {
      const t = await call(`${source}\n${forceLine(entries[i], i)}\n`);
      if (t.code === 0) good.push(entries[i]);
    }
    d = await call(`${source}\n${good.map(forceLine).join('\n')}\n`);
  }
  const all = parseRecordLayouts(joinText(d.stdout), parsePadWarnings(joinText(d.stderr)));
  const wanted = new Set([...names.keys()].flatMap(n => [n, n.split('::').pop()]));
  const seen = new Set();
  const records = all.filter(r => !r.anonymous && (wanted.has(r.name) || wanted.has(r.name.split('::').pop())) && !seen.has(r.name) && seen.add(r.name));
  return { records, ok: d.code === 0, errors: d.code === 0 ? '' : tidy(strip(joinText(d.stderr)), 'main') };
}

export function describeExit(code) {
  if (code === null || code === undefined) return '';
  const sig = { 134: 'SIGABRT (abort, often a failed assert or sanitizer report)', 136: 'SIGFPE (e.g. integer divide by zero)', 137: 'SIGKILL (killed, often time or memory limit)', 139: 'SIGSEGV (segmentation fault: invalid memory access)' };
  return sig[code] ? `${code} = ${sig[code]}` : String(code);
}
