# Systems Mastery Lab (the course website)

A static website that turns this repository into an interactive course: every module is readable, every program in it can be run, and exercises check themselves. Nothing is installed on the learner's machine.

Live site (after GitHub Pages is enabled): `https://khanshaki-r.github.io/systems-mastery-course/`

## What it does

| Feature | How it works |
|---|---|
| Read modules | Renders the Markdown in `phase-*/` with diagrams (Mermaid), syntax highlighting and working links between modules. |
| Run module code | Each C/C++ program with a `main` gets a **Run** button. The site finds the module's own compile command (`gcc -std=c17 -Wall ...`) and its "Expected output" block, compiles with real GCC/Clang on [Compiler Explorer](https://godbolt.org), runs it in a sandbox, and compares the output (memory addresses are allowed to differ). Multi-file programs (`gcc main.c loan.c`, or `make` output) are built together with CMake. |
| Run SQL | SQL blocks run in **PostgreSQL 18 inside the browser** ([PGlite](https://pglite.dev)): tables, indexes, `EXPLAIN ANALYZE`, PL/pgSQL. One database is shared by the reader and the IDE and is saved in the browser. psql meta-commands (`\d`, `\timing`) are skipped. |
| Run Python | Python blocks run in the browser with [Pyodide](https://pyodide.org). |
| IDE | Monaco editor (the VS Code editor) with file tabs, workspaces, compiler choice (GCC 13.3, GCC 15.2, Clang 21), build presets (Debug, Release, AddressSanitizer + UBSan, ThreadSanitizer), stdin and arguments, compile errors underlined in the editor, and share links. |
| Memory & debug | **Visualize** steps through C, C++ or Python line by line, forward and backward, drawing stack frames, heap blocks and pointer arrows ([Python Tutor](https://pythontutor.com), embedded). Comments are stripped first; programs must stay under about 5,600 bytes and 1,000 steps. |
| Assembly | Compiles the current file and maps every source line to its x86-64 instructions (colour-linked, hover to find the line). |
| Struct layout | Asks Clang for the exact record layout and draws every byte of each struct/class: fields, padding holes, vtable pointers. |
| Exercises | `site/exercises/`: starter code, task, hints, reference solution, and tests that run when the learner presses **Check**. |
| Progress | Modules marked complete and exercises solved are remembered in the browser (localStorage). |

What it cannot do (use the lab from module 0.04 for these): real networking (the sandbox has no network), programs that need libraries such as Berkeley DB, libpq or GoogleTest, Windows/MSVC builds, interactive GDB, Docker, and YugabyteDB. Code blocks that need one of these say so and their Run button is disabled.

Privacy: C/C++ code you run is sent to godbolt.org; code you visualise is sent to pythontutor.com. SQL and Python never leave the browser.

## Files

```text
site/
  index.html              page shell
  css/app.css             all styles (light and dark)
  js/app.js               router, sidebar, home, module pages, exercise list
  js/reader.js            Markdown rendering and runnable code blocks
  js/ide.js               the IDE
  js/exercises.js         exercise loading and checking
  js/output.js            console, diffs, SQL tables, layout drawing, visualiser links
  js/runners/godbolt.js   compile/run/assembly/layout via Compiler Explorer (no DOM; also used by tools/)
  js/runners/sql.js       PostgreSQL via PGlite (no DOM; also used by tools/)
  js/runners/python.js    Pyodide in a Web Worker (py-worker.js)
  manifest.json           generated: phases and modules
  exercises/catalog.json  generated: exercise index
  exercises/<id>/         one folder per exercise
  tools/build-manifest.mjs     regenerates manifest.json and catalog.json
  tools/verify-exercises.mjs   checks every exercise against its solution
```

## Run it locally

The site reads the module Markdown from the repository, so serve the **repository root**, not `site/`:

```bash
node site/tools/build-manifest.mjs     # after adding modules or exercises
npx serve .                            # or: python3 -m http.server 8000
# open http://localhost:3000/site/ (or :8000/site/)
```

Opening `index.html` straight from disk does not work: browsers block `fetch` and module scripts on `file://`.

## Publish it

`.github/workflows/pages.yml` deploys on every push to `main`. One-time setup in the repository on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow regenerates the manifest, so new modules appear automatically.

## Add an exercise

Create `site/exercises/<id>/` (the id's prefix sets the order, e.g. `p03-06-arena-allocator`):

```text
exercise.json      metadata and tests
README.md          the task, in Markdown
starter/<file>     what the learner starts with (must compile, must fail a test)
solution/<file>    the reference solution (must pass every test)
setup.sql          SQL exercises only: tables created before the learner's SQL runs
```

`exercise.json`:

```json
{
  "title": "A growable array with realloc",
  "summary": "One line shown in the list.",
  "module": "phase-01-c-from-zero-to-systems/module-08-dynamic-memory.md",
  "difficulty": "easy | medium | hard",
  "lang": "c | cpp | sql | python",
  "files": ["main.c"],
  "flags": "-std=c17 -Wall -Wextra -Werror -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all",
  "compiler": "cg133",
  "tests": [
    { "name": "ten amounts", "stdin": ["120", "5"], "expected": ["count=2 ..."] }
  ],
  "hints": ["Markdown text, revealed one at a time"]
}
```

- C/C++ tests compare stdout line by line (trailing spaces ignored) and require exit code 0 (or `exitCode`). Sanitizer reports make the exit code non-zero, so leaks, overflows and races fail the test.
- ThreadSanitizer needs GCC 15 or Clang on Compiler Explorer (`"compiler": "g152"`); the site switches automatically when GCC 13 is selected.
- SQL tests run on a fresh database: `setup.sql`, then the learner's file. A test with `query` runs that query afterwards; without it, the learner's last statement is checked. Rows are compared with the reference solution's, unless the test has `contains` / `notContains` (text that must or must not appear, for `EXPLAIN` plans).
- Use `"phase": 6` instead of `module` when the module does not exist yet.

Then:

```bash
node site/tools/build-manifest.mjs
npm install @electric-sql/pglite      # once, anywhere above the repo, to verify SQL exercises
node site/tools/verify-exercises.mjs p01-08
```

`verify-exercises.mjs` fails if a solution misses a test or a starter already passes them all.

## Module authoring conventions the site relies on

- A runnable C/C++ program contains `int main(`. Name the file in its first comment (`/* pointers.c ...` or `// main.cpp`).
- Put the exact compile command in a following ```` ```bash ```` block (`gcc -std=c17 -Wall -Wextra -Werror -g -o pointers pointers.c`). Multi-file builds list all sources, or show the `make` output.
- Put the output in a ```` ```text ```` block right after a paragraph that says "Expected output". Machine-specific values (addresses) are tolerated; others will show as a difference with an explanation.
- Input can be shown as `echo "..." | ./prog` or `printf '...' | ./prog`, and arguments as `./prog arg1 arg2`; the Run button uses them.
