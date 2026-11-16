// Main-thread wrapper for the Pyodide worker.
let worker = null;
let seq = 0;

function getWorker() {
  if (!worker) worker = new Worker(new URL('./py-worker.js', import.meta.url));
  return worker;
}

/** Stop any running Python program (terminates the worker; the next run reloads Python). */
export function stopPython() {
  if (worker) { worker.terminate(); worker = null; }
}

/**
 * Run Python. Callbacks: onOut(text), onErr(text), onStatus(text).
 * Resolves { ok, stdout, stderr, error, ms, stopped }.
 */
export function runPython(code, { stdin = '', onOut, onErr, onStatus, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const w = getWorker();
    const id = ++seq;
    let stdout = '', stderr = '';
    let timer = null;
    const finish = (res) => {
      w.removeEventListener('message', handler);
      if (timer) clearTimeout(timer);
      resolve(Object.assign({ stdout, stderr }, res));
    };
    const handler = (ev) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === 'out') { stdout += m.text; onOut && onOut(m.text); }
      else if (m.type === 'err') { stderr += m.text; onErr && onErr(m.text); }
      else if (m.type === 'status') { onStatus && onStatus(m.text); }
      else if (m.type === 'done') finish({ ok: m.ok, error: m.error, ms: m.ms });
    };
    w.addEventListener('message', handler);
    w.addEventListener('error', (e) => finish({ ok: false, error: e.message || 'Python worker failed to load' }), { once: true });
    if (timeoutMs) timer = setTimeout(() => { stopPython(); finish({ ok: false, error: `Stopped after ${timeoutMs / 1000} s (time limit)`, stopped: true }); }, timeoutMs);
    runPython.cancel = () => { stopPython(); finish({ ok: false, error: 'Stopped by you', stopped: true }); };
    w.postMessage({ id, code, stdin });
  });
}
