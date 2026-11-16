#!/usr/bin/env node
// Verifies every exercise: the reference solution must pass all tests and the starter must
// fail at least one. C/C++ run on Compiler Explorer (network needed); SQL runs in PGlite
// (npm install @electric-sql/pglite first). Python exercises are skipped here (they run
// in the browser via Pyodide; check them in the site).
//
//   node site/tools/verify-exercises.mjs            # all exercises
//   node site/tools/verify-exercises.mjs p01-08     # ids starting with p01-08
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { runProgram, defaultFlags } from '../js/runners/godbolt.js';
import { runSql, setPGlite, createDb } from '../js/runners/sql.js';

const here = dirname(fileURLToPath(import.meta.url));
const exRoot = join(here, '..', 'exercises');
const filter = process.argv[2] || '';
const catalog = JSON.parse(readFileSync(join(exRoot, 'catalog.json'), 'utf8'));
const lines = arr => (Array.isArray(arr) ? arr.join('\n') + (arr.length ? '\n' : '') : String(arr ?? ''));
const norm = s => String(s ?? '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
const read = (id, p) => readFileSync(join(exRoot, id, p), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pgOk = false;
try {
  // Resolve PGlite from the current working directory's node_modules (or the repo's).
  const req = createRequire(join(process.cwd(), 'noop.js'));
  const mod = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
  setPGlite(mod.PGlite);
  pgOk = true;
} catch (e) { /* SQL exercises will be skipped */ }

async function runCompiled(ex, files) {
  const results = [];
  for (const t of ex.tests) {
    const res = await runProgram({ lang: ex.lang, compiler: ex.compiler || (ex.lang === 'c' ? 'cg133' : 'g133'), flags: ex.flags || defaultFlags(ex.lang), files, stdin: lines(t.stdin) });
    const pass = res.built && res.didExecute && res.exitCode === (t.exitCode ?? 0) && norm(res.stdout) === norm(lines(t.expected));
    results.push({ name: t.name, pass, res });
    await sleep(250);
  }
  return results;
}

const textOf = r => (!r ? '' : !r.fields.length ? r.command : [r.fields.join(' | '), ...r.rows.map(x => x.map(v => v ?? 'NULL').join(' | '))].join('\n'));

async function sqlRun(ex, code) {
  const setup = ex.setupFile ? read(ex.id, ex.setupFile) : '';
  const db = await createDb();
  if (setup) { const s = await runSql(db, setup); if (s.error) throw new Error('setup failed: ' + s.error.message); }
  const run = await runSql(db, code);
  const outs = [];
  for (const t of ex.tests) {
    if (run.error) { outs.push({ error: run.error.message }); continue; }
    if (t.query) { const q = await runSql(db, t.query); outs.push(q.error ? { error: q.error.message } : q.results[q.results.length - 1]); }
    else outs.push(run.results[run.results.length - 1]);
  }
  await db.close();
  return outs;
}

async function runSqlEx(ex, files, expected) {
  const outs = await sqlRun(ex, files.map(f => f.text).join('\n;\n'));
  return ex.tests.map((t, i) => {
    const got = outs[i];
    if (got.error) return { name: t.name, pass: false, detail: got.error };
    if (t.contains) {
      const txt = textOf(got);
      return { name: t.name, pass: t.contains.every(s => txt.includes(s)) && !(t.notContains || []).some(s => txt.includes(s)), detail: txt };
    }
    const e = expected[i];
    const a = JSON.stringify(got.rows), b = JSON.stringify(e.rows);
    return { name: t.name, pass: got.fields.length === e.fields.length && a === b, detail: textOf(got) };
  });
}

let failures = 0;
for (const ex of catalog.exercises) {
  if (filter && !ex.id.startsWith(filter)) continue;
  const load = dir => ex.files.map(f => ({ name: f, text: read(ex.id, `${dir}/${f}`) }));
  const sol = load('solution');
  const starter = load('starter');
  if (ex.lang === 'python') { console.log(`-- ${ex.id}: skipped (Python runs in the browser)`); continue; }
  if (ex.lang === 'sql' && !pgOk) { console.log(`-- ${ex.id}: skipped (npm install @electric-sql/pglite to check SQL)`); continue; }
  try {
    let solRes, startRes;
    if (ex.lang === 'sql') {
      const expected = await sqlRun(ex, sol.map(f => f.text).join('\n;\n'));
      expected.forEach((e, i) => { if (e.error) throw new Error(`solution failed on "${ex.tests[i].name}": ${e.error}`); });
      solRes = await runSqlEx(ex, sol, expected);
      startRes = await runSqlEx(ex, starter, expected);
    } else {
      solRes = await runCompiled(ex, sol);
      startRes = await runCompiled(ex, starter);
    }
    const solOk = solRes.every(r => r.pass);
    const starterFails = startRes.some(r => !r.pass);
    const ok = solOk && starterFails;
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${ex.id}: solution ${solRes.filter(r => r.pass).length}/${solRes.length} pass, starter ${startRes.filter(r => r.pass).length}/${startRes.length} pass`);
    for (const r of solRes.filter(r => !r.pass)) {
      console.log(`     solution failed "${r.name}"`);
      if (r.res) console.log('     build:', r.res.built, 'exit:', r.res.exitCode, '\n     stdout:\n' + r.res.stdout.split('\n').map(l => '       | ' + l).join('\n') + '\n     stderr/build:\n' + (r.res.stderrRaw + r.res.buildRaw).replace(/\x1b\[[0-9;]*m|\x1b\[K/g, '').slice(0, 1500));
      else console.log('     got:', r.detail);
    }
    if (!starterFails) console.log('     the starter already passes every test: the exercise teaches nothing');
  } catch (e) {
    failures++;
    console.log(`FAIL ${ex.id}: ${e.message}`);
  }
}
console.log(failures ? `\n${failures} exercise(s) need attention` : '\nAll checked exercises are consistent.');
process.exit(failures ? 1 : 0);
