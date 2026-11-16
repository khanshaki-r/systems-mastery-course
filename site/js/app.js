// App shell: routing, sidebar, home page, module pages, exercise list.
import { h, esc, store, session, toast, progress, on, isDark, fetchJSON, SITE_ROOT, REPO_URL } from './util.js';
import { renderDoc, scrollToAnchor } from './reader.js';
import { IDE } from './ide.js';
import { loadCatalog } from './exercises.js';

const pageView = document.getElementById('view-page');
const ideView = document.getElementById('view-ide');
const sidebar = document.getElementById('sidebar');
let manifest = null;
let ide = null;
let currentRoute = null;

// ---------- theme ----------
function applyTheme() {
  const dark = isDark();
  document.getElementById('hljs-light').disabled = dark;
  document.getElementById('hljs-dark').disabled = !dark;
  if (ide) ide.setTheme();
}
document.getElementById('theme-btn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('sm.theme', next); } catch (e) { /* ignore */ }
  applyTheme();
  if (currentRoute && currentRoute.name === 'read') route(); // re-render diagrams in the new theme
});
window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
applyTheme();

// ---------- mobile menu ----------
document.getElementById('menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('side-open'));

// ---------- helpers ----------
function allModules() { return manifest.phases.flatMap(p => p.modules.map(m => Object.assign({ phase: p }, m))); }
function findDoc(path) {
  for (const p of manifest.phases) {
    for (const m of p.modules) if (m.path === path) return { kind: 'module', phase: p, doc: m };
    for (const x of p.extras) if (x.path === path) return { kind: 'extra', phase: p, doc: x };
  }
  for (const x of manifest.other) if (x.path === path) return { kind: 'other', doc: x };
  return null;
}
function openInIde(payload) {
  session.set('sm.handoff', payload);
  location.hash = '#/ide?handoff=1';
}

// ---------- sidebar ----------
function renderSidebar(activePath) {
  const prog = progress.all();
  const mods = allModules();
  const done = mods.filter(m => prog.modules[m.path]).length;
  sidebar.innerHTML = '';
  const search = h('input', { class: 'side-search', type: 'search', placeholder: 'Search modules…', 'aria-label': 'Search modules' });
  sidebar.append(search);
  sidebar.append(h('div', { class: 'side-progress' }, `${done} of ${mods.length} modules complete`, h('div', { class: 'bar' }, h('span', { style: { width: `${mods.length ? (100 * done / mods.length) : 0}%` } }))));
  const r = currentRoute || {};
  sidebar.append(
    h('a', { class: 'side-top' + (r.name === 'home' ? ' active' : ''), href: '#/' }, 'Home'),
    h('a', { class: 'side-top', href: '#/ide' }, 'IDE (C, C++, SQL, Python)'),
    h('a', { class: 'side-top' + (r.name === 'exercises' ? ' active' : ''), href: '#/exercises' }, 'Exercises'),
    h('div', { class: 'side-sep' }));
  const groups = h('div');
  for (const p of manifest.phases) {
    const contains = p.modules.some(m => m.path === activePath) || p.extras.some(x => x.path === activePath);
    const pdone = p.modules.filter(m => prog.modules[m.path]).length;
    const g = h('details', { class: 'side-group', open: contains || null, 'data-phase': p.num },
      h('summary', {}, h('span', {}, `${p.num}. ${p.title}`), h('span', { class: 'count' }, `${pdone}/${p.modules.length}`)));
    for (const m of p.modules) {
      g.append(h('a', { class: 'side-link' + (m.path === activePath ? ' active' : ''), href: `#/read/${m.path}`, 'data-q': `${m.num} ${m.name}`.toLowerCase() },
        h('span', { class: 'num' }, m.num), h('span', {}, m.name), prog.modules[m.path] ? h('span', { class: 'done', title: 'Complete' }, '✓') : null));
    }
    for (const x of p.extras) {
      g.append(h('a', { class: 'side-link' + (x.path === activePath ? ' active' : ''), href: `#/read/${x.path}`, 'data-q': `${p.title} ${x.name}`.toLowerCase() }, h('span', { class: 'num' }, x.icon), h('span', {}, x.name)));
    }
    groups.append(g);
  }
  if (manifest.other.length) {
    const g = h('details', { class: 'side-group', open: manifest.other.some(x => x.path === activePath) || null }, h('summary', {}, h('span', {}, 'Capstones, journal, syllabus')));
    manifest.other.forEach(x => g.append(h('a', { class: 'side-link' + (x.path === activePath ? ' active' : ''), href: `#/read/${x.path}`, 'data-q': x.name.toLowerCase() }, h('span', { class: 'num' }, '•'), h('span', {}, x.name))));
    groups.append(g);
  }
  sidebar.append(groups);
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    groups.querySelectorAll('.side-group').forEach(g => {
      let any = false;
      g.querySelectorAll('.side-link').forEach(a => { const hit = !q || a.dataset.q.includes(q); a.hidden = !hit; any ||= hit; });
      g.hidden = !any;
      if (q) g.open = any;
    });
  });
  const act = sidebar.querySelector('.side-link.active');
  if (act) act.scrollIntoView({ block: 'center' });
}

// ---------- pages ----------
function setNav(name) {
  document.querySelectorAll('.topnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (name === 'read' ? 'home' : name === 'exercise' ? 'exercises' : name)));
}
function showPage() { ideView.hidden = true; pageView.hidden = false; document.body.classList.remove('ide-mode'); }
function showIde() { pageView.hidden = true; ideView.hidden = false; document.body.classList.add('ide-mode'); }

const ICONS = {
  run: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  mem: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 7h16v10H4zM8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/></svg>',
  bug: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 8h8v8a4 4 0 01-8 0zM12 8v12M4 12h4M16 12h4M5 6l3 2M19 6l-3 2M5 19l3-2M19 19l-3-2M9 5a3 3 0 016 0"/></svg>',
  db: '<svg viewBox="0 0 24 24" width="18" height="18"><ellipse cx="12" cy="6" rx="7" ry="3" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
  asm: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M9 8l-4 4 4 4M15 8l4 4-4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5 9-10"/></svg>',
};

async function renderHome() {
  showPage();
  const prog = progress.all();
  const mods = allModules();
  const done = mods.filter(m => prog.modules[m.path]);
  const hoursDone = done.reduce((s, m) => s + (m.hours || 0), 0);
  const hoursAll = mods.reduce((s, m) => s + (m.hours || 0), 0);
  let cat = { exercises: [] };
  try { cat = await loadCatalog(); } catch (e) { /* catalog optional */ }
  const exDone = cat.exercises.filter(e => prog.exercises[e.id]).length;
  const last = prog.last && findDoc(prog.last);
  const next = mods.find(m => !prog.modules[m.path]);
  const page = h('div', { class: 'page page-wide' });
  page.append(h('div', { class: 'hero' },
    h('h1', {}, 'Systems Mastery Lab'),
    h('p', {}, 'The full course, with a compiler, a database and a memory debugger built in. Every program in every module runs right here: press Run, compare against the expected output, step through memory, then practise with exercises that check your code automatically. Nothing to install.'),
    h('div', { class: 'hero-actions' },
      last ? h('a', { class: 'btn primary lg', href: `#/read/${last.doc.path}` }, `Continue: ${last.doc.num ? last.doc.num + ' ' : ''}${last.doc.name}`) :
        next ? h('a', { class: 'btn primary lg', href: `#/read/${next.path}` }, `Start: ${next.num} ${next.name}`) : null,
      h('a', { class: 'btn lg', href: '#/ide' }, 'Open the IDE'),
      h('a', { class: 'btn lg', href: '#/exercises' }, `Exercises (${cat.exercises.length})`))));
  page.append(h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('div', { class: 'v' }, `${done.length}/${mods.length}`), h('div', { class: 'l' }, 'modules complete')),
    h('div', { class: 'stat' }, h('div', { class: 'v' }, `${exDone}/${cat.exercises.length}`), h('div', { class: 'l' }, 'exercises solved')),
    h('div', { class: 'stat' }, h('div', { class: 'v' }, `${hoursDone}`), h('div', { class: 'l' }, `of ${hoursAll} module hours done`)),
    h('div', { class: 'stat' }, h('div', { class: 'v' }, `${manifest.stats.programs}`), h('div', { class: 'l' }, 'runnable programs in the modules'))));

  page.append(h('h2', { class: 'section-title' }, 'What the lab can do'));
  const feat = (ic, t, d) => h('div', { class: 'feature' }, h('div', { class: 'ic', html: ICONS[ic] }), h('div', {}, h('h4', {}, t), h('p', {}, d)));
  page.append(h('div', { class: 'feature-list' },
    feat('run', 'Run every module program', 'C and C++ compile on real GCC 13/15 and Clang 21 with the exact flags the module uses, then run in a Linux sandbox. Output is checked against the module\'s expected output.'),
    feat('mem', 'See memory move', 'Visualize steps through C, C++ or Python line by line, drawing stack frames, heap blocks and pointer arrows. Step backwards as easily as forwards.'),
    feat('bug', 'Debug like production', 'AddressSanitizer, UBSan and ThreadSanitizer presets catch overflows, use-after-free, leaks and data races, with stack traces that jump to the line.'),
    feat('asm', 'Look under the hood', 'Assembly view maps every source line to its x86-64 instructions. Struct layout draws each byte, field and padding hole.'),
    feat('db', 'Real PostgreSQL', 'PostgreSQL 18 runs inside your browser: tables, indexes, EXPLAIN ANALYZE, PL/pgSQL, transactions. Your database is saved between visits.'),
    feat('check', 'Exercises that grade themselves', 'Write the code, press Check, and every test runs. Starter code, hints and reference solutions for each phase.')));

  page.append(h('h2', { class: 'section-title' }, 'Phases'));
  const grid = h('div', { class: 'grid' });
  for (const p of manifest.phases) {
    const pd = p.modules.filter(m => prog.modules[m.path]).length;
    const first = p.modules.find(m => !prog.modules[m.path]) || p.modules[0];
    grid.append(h('a', { class: 'card', href: first ? `#/read/${first.path}` : '#/' },
      h('div', { class: 'k' }, `Phase ${p.num}`),
      h('h3', {}, p.title),
      h('p', {}, `${p.modules.length} modules · ${p.modules.reduce((s, m) => s + (m.hours || 0), 0)} h · ${pd} done`),
      h('div', { class: 'bar' }, h('span', { style: { width: `${p.modules.length ? 100 * pd / p.modules.length : 0}%` } }))));
  }
  page.append(grid);
  page.append(h('p', { style: { marginTop: '30px', fontSize: '12.5px', color: 'var(--text-3)' } },
    'Code you run is sent to Compiler Explorer (godbolt.org) to compile; code you visualise is sent to Python Tutor (pythontutor.com). SQL and Python run entirely in your browser. Progress is saved in this browser only.'));
  pageView.innerHTML = '';
  pageView.append(page);
  pageView.scrollTop = 0;
}

async function renderRead(path, anchor) {
  showPage();
  const info = findDoc(path);
  const page = h('div', { class: 'page' });
  pageView.innerHTML = '';
  pageView.append(page);
  const crumbs = h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Course'));
  if (info && info.phase) crumbs.append('›', h('span', {}, `Phase ${info.phase.num}: ${info.phase.title}`));
  page.append(crumbs);
  const actions = h('div', { class: 'module-actions' });
  page.append(actions);
  const holder = h('div', {}, h('div', { class: 'loading-page' }, 'Loading…'));
  page.append(holder);
  let doc;
  try {
    holder.innerHTML = '';
    doc = await renderDoc(path, holder, { openInIde });
  } catch (e) {
    holder.innerHTML = '';
    holder.append(h('div', { class: 'err-page' }, `Could not load ${path}: ${e.message}`));
    return;
  }
  document.title = `${doc.title} · Systems Mastery Lab`;
  progress.setLast(path);
  if (info && info.doc.hours) actions.append(h('span', { class: 'chip' }, `${info.doc.hours} h`));
  if (doc.runnable) actions.append(h('span', { class: 'chip accent', title: 'Code blocks with a Run button' }, `${doc.runnable} runnable block${doc.runnable === 1 ? '' : 's'}`));
  try {
    const cat = await loadCatalog();
    const exs = cat.exercises.filter(e => e.module === path);
    exs.forEach(e => actions.append(h('a', { class: 'chip ' + (progress.exerciseDone(e.id) ? 'ok' : 'accent'), href: `#/exercise/${e.id}` }, `${progress.exerciseDone(e.id) ? '✓' : '✎'} Exercise: ${e.title}`)));
  } catch (e) { /* ignore */ }
  actions.append(h('a', { class: 'chip', href: `${REPO_URL}/blob/main/${path}`, target: '_blank', rel: 'noopener' }, 'View on GitHub'));
  if (info && info.kind === 'module') {
    const mk = () => {
      const d = progress.moduleDone(path);
      return h('button', { class: `btn ${d ? 'ok' : 'primary'}`, onclick: () => { progress.setModule(path, !progress.moduleDone(path)); toast(progress.moduleDone(path) ? 'Marked complete' : 'Marked not complete'); refreshMark(); } }, d ? '✓ Completed' : 'Mark module complete');
    };
    const top = h('span', {}, mk());
    const bottom = h('div', { style: { margin: '30px 0 0', display: 'flex', gap: '10px', flexWrap: 'wrap' } }, mk());
    const refreshMark = () => { top.replaceChildren(mk()); bottom.replaceChildren(mk()); };
    actions.append(top);
    const mods = allModules();
    const idx = mods.findIndex(m => m.path === path);
    if (idx >= 0 && mods[idx + 1]) bottom.append(h('a', { class: 'btn', href: `#/read/${mods[idx + 1].path}` }, `Next: ${mods[idx + 1].num} ${mods[idx + 1].name} →`));
    page.append(bottom);
  }
  requestAnimationFrame(() => scrollToAnchor(pageView, anchor));
}

async function renderExercises() {
  showPage();
  const page = h('div', { class: 'page' });
  pageView.innerHTML = '';
  pageView.append(page);
  let cat;
  try { cat = await loadCatalog(); } catch (e) { page.append(h('div', { class: 'err-page' }, `Could not load exercises: ${e.message}`)); return; }
  const prog = progress.all();
  page.append(h('h1', { style: { margin: '0 0 6px' } }, 'Exercises'),
    h('p', { style: { color: 'var(--text-2)', margin: '0 0 16px' } }, 'Each exercise opens in the IDE with starter code, a task and automatic tests. Press Check to run them. Solved exercises are remembered in this browser.'));
  const filters = h('div', { class: 'ex-filters' });
  const list = h('div');
  const kinds = [['all', 'All'], ['c', 'C'], ['cpp', 'C++'], ['sql', 'SQL'], ['python', 'Python'], ['todo', 'Not solved']];
  let sel = session.get('sm.exfilter') || 'all';
  const draw = () => {
    filters.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === sel));
    list.innerHTML = '';
    let lastPhase = null;
    cat.exercises.filter(e => sel === 'all' || e.lang === sel || (sel === 'todo' && !prog.exercises[e.id])).forEach(e => {
      if (e.phaseTitle !== lastPhase) { lastPhase = e.phaseTitle; list.append(h('h2', { class: 'section-title' }, e.phaseTitle)); }
      const done = !!prog.exercises[e.id];
      list.append(h('a', { class: 'ex-row', href: `#/exercise/${e.id}` },
        h('span', { class: 'st' + (done ? ' done' : '') }, done ? '✓' : ''),
        h('div', {}, h('h3', {}, e.title, h('span', { class: `tag ${e.difficulty}` }, e.difficulty), h('span', { class: 'tag' }, { c: 'C', cpp: 'C++', sql: 'SQL', python: 'Python' }[e.lang])), h('p', {}, e.summary)),
        h('span', { style: { color: 'var(--text-3)', fontSize: '12.5px' } }, e.moduleTitle ? e.moduleTitle.split(':')[0] : '')));
    });
  };
  kinds.forEach(([k, l]) => filters.append(h('button', { 'data-k': k, onclick: () => { sel = k; session.set('sm.exfilter', k); draw(); } }, l)));
  page.append(filters, list);
  draw();
}

async function renderIde(params) {
  showIde();
  if (!ide) ide = new IDE(ideView, { openModule: (p) => { location.hash = `#/read/${p}`; } });
  document.title = 'IDE · Systems Mastery Lab';
  try { await ide.show(params); } catch (e) { console.error(e); }
}

// ---------- router ----------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  if (!pathPart) return { name: 'home', params };
  if (pathPart.startsWith('read/')) {
    const rest = decodeURIComponent(pathPart.slice(5));
    const at = rest.indexOf('@');
    return { name: 'read', path: at >= 0 ? rest.slice(0, at) : rest, anchor: at >= 0 ? rest.slice(at + 1) : '', params };
  }
  if (pathPart === 'ide') return { name: 'ide', params };
  if (pathPart === 'exercises') return { name: 'exercises', params };
  if (pathPart.startsWith('exercise/')) return { name: 'exercise', id: decodeURIComponent(pathPart.slice(9)), params };
  // Plain GitHub-style anchors (#some-heading) inside a module page
  if (currentRoute && currentRoute.name === 'read') return Object.assign({}, currentRoute, { anchor: raw });
  return { name: 'home', params };
}

async function route() {
  const prev = currentRoute;
  const r = parseHash();
  currentRoute = r;
  document.body.classList.remove('side-open');
  setNav(r.name);
  if (r.name === 'read' && prev && prev.name === 'read' && prev.path === r.path && r.anchor !== prev.anchor) {
    scrollToAnchor(pageView, r.anchor);
    return;
  }
  renderSidebar(r.path);
  if (r.name === 'home') { document.title = 'Systems Mastery Lab'; return renderHome(); }
  if (r.name === 'read') return renderRead(r.path, r.anchor);
  if (r.name === 'exercises') { document.title = 'Exercises · Systems Mastery Lab'; return renderExercises(); }
  if (r.name === 'exercise') return renderIde({ exercise: r.id });
  if (r.name === 'ide') return renderIde(r.params);
}

on('progress', () => { if (currentRoute) renderSidebar(currentRoute.path); });

(async function start() {
  try {
    manifest = await fetchJSON(SITE_ROOT + 'manifest.json');
  } catch (e) {
    pageView.innerHTML = `<div class="err-page">Could not load the course manifest (${esc(e.message)}). If you are running locally, start a web server in the repository root (not inside site/) and open /site/.</div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
})();
