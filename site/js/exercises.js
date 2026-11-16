// Exercise catalog, loading and checking. Exercises live in site/exercises/<id>/:
//   exercise.json  metadata and tests     README.md  the task
//   starter/...    files the learner gets solution/... reference solution
// tools/build-manifest.mjs collects every exercise.json into exercises/catalog.json.
import { Marked } from 'https://cdn.jsdelivr.net/npm/marked@18.1.1/lib/marked.esm.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.4.17/dist/purify.es.mjs';
import { fetchJSON, fetchText, SITE_ROOT, normOut } from './util.js';
import { runProgram, defaultFlags } from './runners/godbolt.js';
import { runSql, createDb } from './runners/sql.js';
import { runPython } from './runners/python.js';

let catalogP = null;
export function loadCatalog() {
  if (!catalogP) catalogP = fetchJSON(SITE_ROOT + 'exercises/catalog.json').catch(e => { catalogP = null; throw e; });
  return catalogP;
}

const base = id => `${SITE_ROOT}exercises/${id}/`;

export async function loadExercise(id) {
  const cat = await loadCatalog();
  const ex = cat.exercises.find(e => e.id === id);
  if (!ex) throw new Error(`No exercise called "${id}"`);
  const [readme, ...starter] = await Promise.all([
    fetchText(base(id) + 'README.md'),
    ...ex.files.map(f => fetchText(base(id) + 'starter/' + f).then(text => ({ name: f, text }))),
  ]);
  return Object.assign({}, ex, { readme, starter });
}

export async function loadSetup(ex) {
  return ex.setupFile ? fetchText(base(ex.id) + ex.setupFile) : '';
}

export async function loadSolution(ex) {
  return Promise.all(ex.files.map(f => fetchText(base(ex.id) + 'solution/' + f).then(text => ({ name: f, text }))));
}

const md = new Marked({ gfm: true });
export function mdHtml(text) {
  return DOMPurify.sanitize(md.parse(text));
}

export const lines = arr => (Array.isArray(arr) ? arr.join('\n') + (arr.length ? '\n' : '') : String(arr ?? ''));

// ---------- checking ----------
async function checkCompiled(ex, files, onTest, signal) {
  const out = [];
  for (let i = 0; i < ex.tests.length; i++) {
    const t = ex.tests[i];
    onTest && onTest(i, { state: 'run' });
    let r;
    try {
      const res = await runProgram({ lang: ex.lang, compiler: ex.compiler || (ex.lang === 'c' ? 'cg133' : 'g133'), flags: ex.flags || defaultFlags(ex.lang), files, stdin: lines(t.stdin), args: t.args || [], signal });
      const expected = lines(t.expected);
      const wantExit = t.exitCode ?? 0;
      let pass = res.built && res.didExecute && normOut(res.stdout) === normOut(expected) && res.exitCode === wantExit;
      let why = '';
      if (!res.built) why = 'Build failed. See the Output and Problems tabs.';
      else if (!res.didExecute) why = res.timedOut ? 'Time limit hit (infinite loop?).' : 'The program did not run.';
      else if (res.exitCode !== wantExit) why = `Exit code ${res.exitCode}, expected ${wantExit}.${res.stderrRaw ? ' The program reported errors on stderr (sanitizer?).' : ''}`;
      else if (!pass) why = 'Output differs.';
      r = { pass, why, got: res.stdout, expected, stderr: res.stderrRaw, res };
    } catch (e) {
      r = { pass: false, why: String(e.message || e), got: '', expected: lines(t.expected) };
    }
    out.push(r);
    onTest && onTest(i, Object.assign({ state: r.pass ? 'pass' : 'fail' }, r));
  }
  return out;
}

async function checkPython(ex, files, onTest) {
  const out = [];
  const main = files.find(f => f.name === (ex.main || 'main.py')) || files[0];
  for (let i = 0; i < ex.tests.length; i++) {
    const t = ex.tests[i];
    onTest && onTest(i, { state: 'run' });
    const res = await runPython(main.text, { stdin: lines(t.stdin), timeoutMs: 20000 });
    const expected = lines(t.expected);
    const pass = res.ok && normOut(res.stdout) === normOut(expected);
    const r = { pass, why: res.ok ? (pass ? '' : 'Output differs.') : res.error, got: res.stdout, expected, stderr: res.stderr };
    out.push(r);
    onTest && onTest(i, Object.assign({ state: r.pass ? 'pass' : 'fail' }, r));
  }
  return out;
}

const solutionCache = new Map();
function resultText(r) {
  if (!r) return '';
  if (!r.fields.length) return r.command;
  return [r.fields.join(' | '), ...r.rows.map(row => row.map(v => v === null ? 'NULL' : v).join(' | '))].join('\n');
}

export async function sqlExpectations(ex, setup, solutionText) {
  if (solutionCache.has(ex.id)) return solutionCache.get(ex.id);
  const db = await createDb();
  if (setup) { const s = await runSql(db, setup); if (s.error) throw new Error('Exercise setup failed: ' + s.error.message); }
  const sol = await runSql(db, solutionText);
  if (sol.error) throw new Error('Reference solution failed: ' + sol.error.message);
  const exp = [];
  for (const t of ex.tests) {
    if (t.query) { const q = await runSql(db, t.query); exp.push(q.error ? { error: q.error.message } : q.results[q.results.length - 1]); }
    else exp.push(sol.results[sol.results.length - 1]);
  }
  await db.close?.();
  solutionCache.set(ex.id, exp);
  return exp;
}

async function checkSql(ex, files, onTest) {
  const setup = ex.setupFile ? await fetchText(base(ex.id) + ex.setupFile) : '';
  const sol = (await loadSolution(ex)).map(f => f.text).join('\n;\n');
  const user = files.map(f => f.text).join('\n;\n');
  const exps = await sqlExpectations(ex, setup, sol);
  const db = await createDb();
  if (setup) await runSql(db, setup);
  const run = await runSql(db, user);
  const out = [];
  for (let i = 0; i < ex.tests.length; i++) {
    const t = ex.tests[i];
    onTest && onTest(i, { state: 'run' });
    let r;
    if (run.error) {
      r = { pass: false, why: `Your SQL stopped with an error at line ${run.error.line}: ${run.error.message}`, got: '', expected: resultText(exps[i]) };
    } else {
      let got;
      if (t.query) { const q = await runSql(db, t.query); got = q.error ? { error: q.error.message } : q.results[q.results.length - 1]; }
      else got = run.results[run.results.length - 1];
      if (got && got.error) r = { pass: false, why: `Check query failed: ${got.error}`, got: '', expected: t.contains ? t.contains.join('\n') : resultText(exps[i]) };
      else if (t.contains) {
        const text = resultText(got);
        const missing = t.contains.filter(s => !text.includes(s));
        const forbidden = (t.notContains || []).filter(s => text.includes(s));
        r = { pass: !missing.length && !forbidden.length, why: missing.length ? `Expected to see: ${missing.join(', ')}` : (forbidden.length ? `Should not see: ${forbidden.join(', ')}` : ''), got: text, expected: `contains: ${t.contains.join(', ')}` };
      } else {
        const e = exps[i];
        let a = got ? got.rows.map(x => JSON.stringify(x)) : [];
        let b = e && e.rows ? e.rows.map(x => JSON.stringify(x)) : [];
        if (t.unordered) { a = a.slice().sort(); b = b.slice().sort(); }
        const sameCols = got && e && got.fields.length === e.fields.length;
        const pass = !!sameCols && a.length === b.length && a.every((v, k) => v === b[k]);
        r = { pass, why: pass ? '' : (!got ? 'Your script produced no result to check.' : !sameCols ? `Expected ${e.fields.length} column(s) (${e.fields.join(', ')}), got ${got.fields.length}.` : 'The rows differ.'), got: resultText(got), expected: resultText(e) };
      }
    }
    out.push(r);
    onTest && onTest(i, Object.assign({ state: r.pass ? 'pass' : 'fail' }, r));
  }
  await db.close?.();
  return out;
}

/** Run every test. onTest(index, state) is called as each test starts and finishes. */
export async function checkExercise(ex, files, { onTest, signal } = {}) {
  if (ex.lang === 'sql') return checkSql(ex, files, onTest);
  if (ex.lang === 'python') return checkPython(ex, files, onTest);
  return checkCompiled(ex, files, onTest, signal);
}
