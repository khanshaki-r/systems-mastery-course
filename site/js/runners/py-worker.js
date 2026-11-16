/* Python runner worker: loads Pyodide (CPython compiled to WebAssembly) once, then runs scripts.
   Runs off the main thread so the page stays responsive and "Stop" can terminate it. */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/';
importScripts(PYODIDE + 'pyodide.js');

let ready = null;
function boot() {
  if (!ready) ready = loadPyodide({ indexURL: PYODIDE });
  return ready;
}

self.onmessage = async (ev) => {
  const { id, code, stdin } = ev.data;
  const post = (type, extra) => self.postMessage(Object.assign({ id, type }, extra));
  try {
    post('status', { text: 'Loading Python (first run downloads about 10 MB)...' });
    const py = await boot();
    // Hand over all input in one read, then EOF: works for input(), readline() and read().
    let text = String(stdin || '');
    if (text && !text.endsWith('\n')) text += '\n';
    let given = false;
    py.setStdin({ stdin: () => { if (given || !text) return undefined; given = true; return text; } });
    py.setStdout({ batched: (s) => post('out', { text: s + '\n' }) });
    py.setStderr({ batched: (s) => post('err', { text: s + '\n' }) });
    post('status', { text: 'Running...' });
    const t0 = performance.now();
    await py.loadPackagesFromImports(code);
    await py.runPythonAsync(code);
    post('done', { ok: true, ms: performance.now() - t0 });
  } catch (e) {
    post('done', { ok: false, error: String(e && e.message ? e.message : e) });
  }
};
