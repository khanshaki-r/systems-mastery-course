// Small shared helpers: safe storage, progress, DOM, text.

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

export const session = {
  get(key) { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  del(key) { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

// ---------- progress (modules read, exercises solved) ----------
const PROG = 'sm.progress';
function prog() { return store.get(PROG, { modules: {}, exercises: {}, last: null }); }
export const progress = {
  all: prog,
  moduleDone(path) { return !!prog().modules[path]; },
  setModule(path, done) {
    const p = prog();
    if (done) p.modules[path] = Date.now(); else delete p.modules[path];
    store.set(PROG, p);
    emit('progress');
  },
  exerciseDone(id) { return !!prog().exercises[id]; },
  setExercise(id) { const p = prog(); p.exercises[id] = Date.now(); store.set(PROG, p); emit('progress'); },
  setLast(path) { const p = prog(); p.last = path; store.set(PROG, p); },
};

// ---------- tiny event bus ----------
const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); }
export function emit(evt, data) { (listeners[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

// ---------- DOM ----------
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

export function slug(s) {
  return String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Copy failed'); }
    ta.remove();
  }
}

export function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Content (Markdown, exercises) lives next to the site folder: site/ is served at <root>/site/.
export const CONTENT_ROOT = new URL('../', document.baseURI).href;
export const SITE_ROOT = new URL('./', document.baseURI).href;
export const REPO_URL = 'https://github.com/khanshaki-r/systems-mastery-course';

export async function fetchText(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.text();
}
export async function fetchJSON(url) { return JSON.parse(await fetchText(url)); }

// Normalise program output for comparison: CRLF, trailing spaces, trailing blank lines.
export function normOut(s) {
  return String(s ?? '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
}

// URL-safe base64 of deflated UTF-8 text, for share links.
export async function packText(text) {
  const bytes = new TextEncoder().encode(text);
  let out = bytes;
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    out = new Uint8Array(await new Response(cs).arrayBuffer());
  }
  let bin = ''; out.forEach(b => { bin += String.fromCharCode(b); });
  return (typeof CompressionStream !== 'undefined' ? 'z' : 'r') + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function unpackText(packed) {
  const kind = packed[0];
  const b64 = packed.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  if (kind === 'z') {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(ds).arrayBuffer());
  }
  return new TextDecoder().decode(bytes);
}
