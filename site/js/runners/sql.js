// PostgreSQL in the browser via PGlite (real PostgreSQL compiled to WebAssembly).
// Supports PL/pgSQL, EXPLAIN ANALYZE, RAISE NOTICE, transactions. No DOM use here, so
// tools/verify-exercises.mjs can run the same code under Node.

export const PGLITE_URL = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.10/dist/index.js';

let PGliteClass = null;
export function setPGlite(cls) { PGliteClass = cls; }
async function getPGlite() {
  if (!PGliteClass) PGliteClass = (await import(/* @vite-ignore */ PGLITE_URL)).PGlite;
  return PGliteClass;
}

/** Create a database. dataDir: undefined for in-memory, or 'idb://name' to persist in the browser. */
export async function createDb(dataDir) {
  const PGlite = await getPGlite();
  try {
    return await PGlite.create(dataDir ? { dataDir } : {});
  } catch (e) {
    if (dataDir) return PGlite.create({}); // IndexedDB unavailable (private window): fall back to memory
    throw e;
  }
}

/**
 * Split a SQL script into statements, respecting quotes, dollar quotes ($$ ... $$),
 * comments and psql meta-commands (lines starting with a backslash, which are skipped).
 * Returns [{ sql, start }] plus skipped meta-commands.
 */
export function splitSql(text) {
  const out = [];
  const meta = [];
  let i = 0, start = 0;
  const n = text.length;
  const push = (end) => {
    const raw = text.slice(start, end);
    const body = raw.replace(/^\s+/, '');
    if (body.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) out.push({ sql: body.replace(/\s+$/, ''), start: start + (raw.length - body.length) });
  };
  let atLineStart = true;
  while (i < n) {
    const c = text[i];
    if (atLineStart && c === '\\') {
      // psql meta-command: skip to end of line, close any pending statement first
      const nl = text.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      push(i);
      meta.push(text.slice(i, end).trim());
      i = end; start = i; continue;
    }
    if (c === '\n') { atLineStart = true; i++; continue; }
    if (c !== ' ' && c !== '\t' && c !== '\r') atLineStart = false;
    if (c === '-' && text[i + 1] === '-') { const nl = text.indexOf('\n', i); i = nl === -1 ? n : nl; continue; }
    if (c === '/' && text[i + 1] === '*') {
      let depth = 1; i += 2;
      while (i < n && depth) { if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2; } else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2; } else i++; }
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      const escapes = q === "'" && /[eE]/.test(text[i - 1] || '') && !/\w/.test(text[i - 2] || '');
      i++;
      while (i < n) { if (text[i] === q) { if (text[i + 1] === q) { i += 2; continue; } i++; break; } if (escapes && text[i] === '\\') { i += 2; continue; } i++; }
      continue;
    }
    if (c === '$') {
      const m = text.slice(i).match(/^\$([A-Za-z_]\w*)?\$/);
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }
    if (c === ';') { push(i); i++; start = i; continue; }
    i++;
  }
  push(n);
  return { statements: out, meta };
}

function cell(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '');
  if (typeof v === 'object') {
    if (v instanceof Uint8Array) return '\\x' + Array.from(v, b => b.toString(16).padStart(2, '0')).join('');
    return JSON.stringify(v);
  }
  return String(v);
}

function lineCol(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const col = offset - before.lastIndexOf('\n');
  return { line, col };
}

/**
 * Run a script statement by statement (like psql). Stops at the first error.
 * Returns { results: [{ sql, command, fields, rows, affected, notices, ms }], error, meta }.
 */
export async function runSql(db, text) {
  const { statements, meta } = splitSql(text);
  const results = [];
  let error = null;
  for (const st of statements) {
    const notices = [];
    const t0 = performance.now();
    try {
      const res = await db.exec(st.sql, { onNotice: (nm) => notices.push(`${nm.severity || 'NOTICE'}: ${nm.message}`) });
      const r = res[res.length - 1] || { rows: [], fields: [] };
      const fields = (r.fields || []).map(f => f.name);
      results.push({
        sql: st.sql,
        command: (st.sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').match(/^\s*(\w+(?:\s+\w+)?)/) || [, ''])[1].toUpperCase(),
        fields,
        rows: (r.rows || []).map(row => fields.map(f => cell(row[f]))),
        affected: r.affectedRows ?? null,
        notices,
        ms: performance.now() - t0,
      });
    } catch (e) {
      const pos = e.position ? st.start + Number(e.position) - 1 : st.start;
      const lc = lineCol(text, pos);
      error = { message: e.message, detail: e.detail, hint: e.hint, line: lc.line, col: lc.col, sql: st.sql, notices };
      break;
    }
  }
  return { results, error, meta };
}

/** Tables and columns in the public schema, for the IDE's Database panel. */
export async function describeSchema(db) {
  const r = await db.query(`
    SELECT c.relname AS table, c.relkind AS kind,
           (SELECT json_agg(json_build_object('n', a.attname, 't', format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS cols,
           (SELECT json_agg(i.relname) FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = c.oid) AS idx
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
     ORDER BY c.relname`);
  const fns = await db.query(`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, l.lanname AS lang
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public' ORDER BY 1`);
  return { tables: r.rows, functions: fns.rows };
}
