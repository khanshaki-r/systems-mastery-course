#!/usr/bin/env node
// Builds site/manifest.json (course structure) and site/exercises/catalog.json (exercise index)
// from the Markdown files in the repository. Run from anywhere:  node site/tools/build-manifest.mjs
// The GitHub Pages workflow runs this on every push, so new modules appear automatically.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = join(root, 'site');
const read = p => readFileSync(join(root, p), 'utf8');

const readme = existsSync(join(root, 'README.md')) ? read('README.md') : '';
const phaseTitles = {};
for (const m of readme.matchAll(/^### Phase (\d+):\s*(.+)$/gm)) phaseTitles[+m[1]] = m[2].trim();

const title = text => ((text.match(/^#\s+(.+)$/m) || [])[1] || '').trim();
const hours = text => { const m = text.match(/\*\*Estimated hours:\*\*\s*([\d.]+)/); return m ? +m[1] : null; };
const deslug = s => s.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());

let programs = 0;
const phases = readdirSync(root)
  .filter(d => /^phase-\d\d-/.test(d) && statSync(join(root, d)).isDirectory())
  .sort()
  .map(dir => {
    const num = +dir.slice(6, 8);
    const files = readdirSync(join(root, dir)).filter(f => f.endsWith('.md')).sort();
    const modules = files.filter(f => /^module-\d\d-/.test(f)).map(f => {
      const path = `${dir}/${f}`;
      const text = read(path);
      programs += (text.match(/^```(?:c|cpp|c\+\+)\s*\n[\s\S]*?\bint\s+main\s*\(/gm) || []).length;
      const t = title(text);
      const m = t.match(/^Module\s+(\d+\.\d+):\s*(.+)$/);
      return { path, num: m ? m[1] : `${num}.${f.slice(7, 9)}`, name: m ? m[2] : (t || deslug(f.slice(10, -3))), hours: hours(text) };
    });
    const extras = [];
    if (files.includes('revision.md')) extras.push({ path: `${dir}/revision.md`, name: 'Revision sheet', icon: 'R' });
    if (files.includes('quiz.md')) extras.push({ path: `${dir}/quiz.md`, name: 'Quiz', icon: 'Q' });
    return { num, dir, title: phaseTitles[num] || deslug(dir.slice(9)), modules, extras };
  });

const other = [];
if (readme) other.push({ path: 'README.md', name: 'Full syllabus and progress (README)' });
for (const base of ['capstones', 'solutions']) {
  if (!existsSync(join(root, base))) continue;
  for (const d of readdirSync(join(root, base)).sort()) {
    const p = `${base}/${d}/README.md`;
    if (existsSync(join(root, p))) other.push({ path: p, name: `${base === 'capstones' ? 'Capstone' : 'Solution'}: ${title(read(p)) || d}` });
    const rd = `${base}/${d}/RESUME-DEFENSE.md`;
    if (existsSync(join(root, rd))) other.push({ path: rd, name: `Resume defense: ${d}` });
  }
}
if (existsSync(join(root, 'journal'))) {
  for (const f of readdirSync(join(root, 'journal')).filter(f => f.endsWith('.md')).sort()) {
    other.push({ path: `journal/${f}`, name: f === 'TEMPLATE.md' ? 'Journal template' : `Journal: ${f.replace(/\.md$/, '')}` });
  }
}

const manifest = { generated: new Date().toISOString(), phases, other, stats: { programs } };
writeFileSync(join(site, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

// ---------- exercises ----------
const exDir = join(site, 'exercises');
const moduleTitle = {};
phases.forEach(p => p.modules.forEach(m => { moduleTitle[m.path] = `${m.num}: ${m.name}`; }));
const exercises = [];
const problems = [];
if (existsSync(exDir)) {
  for (const id of readdirSync(exDir).sort()) {
    const f = join(exDir, id, 'exercise.json');
    if (!existsSync(f)) continue;
    let ex;
    try { ex = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { problems.push(`${id}: bad JSON (${e.message})`); continue; }
    ex.id = id;
    for (const file of ex.files || []) {
      if (!existsSync(join(exDir, id, 'starter', file))) problems.push(`${id}: missing starter/${file}`);
      if (!existsSync(join(exDir, id, 'solution', file))) problems.push(`${id}: missing solution/${file}`);
    }
    if (!existsSync(join(exDir, id, 'README.md'))) problems.push(`${id}: missing README.md`);
    if (ex.module && !moduleTitle[ex.module]) problems.push(`${id}: module ${ex.module} not found`);
    const phaseNum = ex.phase ?? (ex.module ? +ex.module.slice(6, 8) : null);
    ex.phaseTitle = phaseNum !== null ? `Phase ${phaseNum}: ${phases.find(p => p.num === phaseNum)?.title || ''}` : 'Extra';
    ex.moduleTitle = ex.module ? moduleTitle[ex.module] : null;
    exercises.push(ex);
  }
}
writeFileSync(join(exDir, 'catalog.json'), JSON.stringify({ generated: manifest.generated, exercises }, null, 1) + '\n');

const nMods = phases.reduce((s, p) => s + p.modules.length, 0);
console.log(`manifest: ${phases.length} phases, ${nMods} modules, ${programs} runnable programs, ${other.length} other pages`);
console.log(`catalog: ${exercises.length} exercises`);
if (problems.length) { console.error('Problems:\n  ' + problems.join('\n  ')); process.exit(1); }
