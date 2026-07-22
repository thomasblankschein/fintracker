# CLAUDE.md

Guidance for Claude Code when working in this repository. Read this first — it exists so you don't have to re-derive project context from scratch every session.

## What this is

**Fintracker** — a local, single-user private finance tracker with double-entry bookkeeping, deliberately reduced to essentials (no multi-user, no multi-currency, no enterprise features). Node/TypeScript + Express backend, React/Vite frontend, SQLite storage. Full user-facing docs already exist — read them before re-explaining things to the user:

| File | For |
|---|---|
| [README.md](README.md) | Install & run |
| [ANWENDERHANDBUCH.md](ANWENDERHANDBUCH.md) | End-user manual with screenshots (German) |
| [API_PLAYBOOK.md](API_PLAYBOOK.md) | Practical API usage guide with worked examples |
| [DATENMODELL.md](DATENMODELL.md) | DB schema, ER diagram |
| [server/openapi.yaml](server/openapi.yaml) | Full API reference (served at `/api-docs` via Swagger UI when running) |

**Before answering "what does X do" or "is Y implemented" — check these docs and the code first; don't guess from memory of a past session.**

## Core domain model — read this before touching any booking logic

Only 6 tables: `accounts`, `payees`, `transactions`, `postings`, `recurring_templates`, `import_templates`. Full detail in DATENMODELL.md. The one thing you must internalize before writing any transaction-related code:

- **Categories are not a separate entity.** They're just `accounts` of type `income`/`expense`. The chart of accounts *is* the category list.
- **No debit/credit columns.** Each posting has one signed `amount_cents`: **positive = money flows into the account, negative = money flows out.** A transaction is valid iff its postings sum to exactly 0 (≥2 postings).
- Sign convention by account type at increase: `asset`/`expense` → positive; `liability`/`income`/`equity` → negative. Reports flip income's sign for display so it reads positive to users — the DB itself stays consistent.
- Accounts nest to unlimited depth via `parent_id`. Balances (Konten page) and category reports (`/reports/by-category`) both roll up recursively over descendants — if you add a new aggregate view, roll it up too, or you'll reintroduce the exact inconsistency that was fixed in the "mehrstufige Hierarchien" work (see git log).

## Environment gotchas (cost real time to discover — don't rediscover them)

- **`better-sqlite3` will not build here** — no Visual Studio Build Tools on this machine. The project uses Node's built-in `node:sqlite` (`DatabaseSync`) instead. It has no `.pragma()` or `.transaction()` helper — see `server/src/db.ts`'s hand-rolled `transaction()` wrapper. Do not add `better-sqlite3` back.
- **Windows + stray `node` processes is a real failure mode.** `npm run dev` spawns multiple node processes (concurrently, tsx, vite); killing them with a single `Stop-Process` sometimes misses one, which then keeps the old SQLite file open. Symptom seen in practice: duplicate accounts/rows appearing after a "reset". Always verify with `Get-Process node | Select Id,StartTime` and confirm the list is empty before trusting a fresh `npm run dev` start.
- After any manual/browser testing, **reset the local DB** before leaving the session: stop node, then delete `data/finanzen.db*` (it's gitignored and expected to be empty/absent in a fresh clone — the app seeds a default chart of accounts on first run).
- The Claude Browser pane's screenshot capability is not always available in a given session (fails with "Browser pane is not displayed, so the page is not compositing frames"). When it fails, use the headless-Playwright recipe below instead of giving up.
- `client/tsconfig.tsbuildinfo` is a build cache artifact that reappears locally; it's gitignored, don't add it back.

## Producing annotated screenshots for ANWENDERHANDBUCH.md

Every screenshot in `docs/screenshots/` is a real capture of the running app — forms actually filled and submitted, numbered callouts actually rendered into the live page before capture — not a mockup. This is the exact, tested recipe. Follow it verbatim to add a new screenshot or regenerate an existing one; don't reinvent it.

**Setup, once per session, in a scratch dir outside the repo (never add `playwright` to `server/package.json` or `client/package.json` — it's a docs tool, not an app dependency):**

```bash
mkdir -p /tmp/shots && cd /tmp/shots
npm init -y
npm install playwright
npx playwright install chromium
```

**`annotate.js`** — copy verbatim into that scratch dir, `require("./annotate.js")` from every screenshot script:

```js
async function clearAnnotations(page) {
  await page.evaluate(() => {
    const old = document.getElementById("doc-annotations");
    if (old) old.remove();
  });
}

// items: [{selector?, text?, tag?, index?, number, dx?, dy?, type?: 'dot'|'box'}]
async function annotate(page, items) {
  await clearAnnotations(page);
  await page.evaluate((items) => {
    function resolveElement(spec) {
      if (spec.selector) {
        const els = document.querySelectorAll(spec.selector);
        return els[spec.index || 0] || null;
      }
      if (spec.text) {
        const tag = spec.tag || "*";
        const els = Array.from(document.querySelectorAll(tag));
        const matches = els
          .filter((el) => el.children.length === 0 || spec.tag)
          .filter((el) => el.textContent && el.textContent.trim().includes(spec.text));
        matches.sort((a, b) => a.textContent.trim().length - b.textContent.trim().length);
        return matches[spec.index || 0] || null;
      }
      return null;
    }
    const overlay = document.createElement("div");
    overlay.id = "doc-annotations";
    document.body.appendChild(overlay);
    for (const item of items) {
      const el = resolveElement(item);
      if (!el) { console.warn("Annotation target not found:", JSON.stringify(item)); continue; }
      const rect = el.getBoundingClientRect();
      if (item.type === "box") {
        const box = document.createElement("div");
        box.style.cssText = `position:absolute; left:${rect.left + window.scrollX - 5}px; top:${rect.top + window.scrollY - 5}px; width:${rect.width + 10}px; height:${rect.height + 10}px; border:3px solid #dc2626; border-radius:8px; z-index:999998; pointer-events:none;`;
        overlay.appendChild(box);
        const badge = document.createElement("div");
        badge.textContent = item.number;
        const bx = Math.max(2, rect.left + window.scrollX - 15);
        const by = Math.max(2, rect.top + window.scrollY - 15);
        badge.style.cssText = `position:absolute; left:${bx}px; top:${by}px; width:28px;height:28px;border-radius:50%;background:#dc2626;color:#fff;font:bold 15px/28px Arial,sans-serif;text-align:center;z-index:999999;box-shadow:0 0 0 3px #fff,0 1px 4px rgba(0,0,0,.4);`;
        overlay.appendChild(badge);
      } else {
        const badge = document.createElement("div");
        badge.textContent = item.number;
        const left = rect.left + window.scrollX + (item.dx || 0);
        const top = rect.top + window.scrollY + (item.dy || 0);
        badge.style.cssText = `position:absolute; left:${left}px; top:${top}px; width:28px;height:28px;border-radius:50%;background:#dc2626;color:#fff;font:bold 15px/28px Arial,sans-serif;text-align:center;z-index:999999;box-shadow:0 0 0 3px #fff,0 1px 4px rgba(0,0,0,.4); transform:translate(-50%,-50%);`;
        overlay.appendChild(badge);
      }
    }
  }, items);
}

module.exports = { annotate, clearAnnotations };
```

**Script pattern:**

```js
const { chromium } = require("playwright");
const { annotate, clearAnnotations } = require("./annotate.js");
const path = require("path");
const OUT = "C:\\Users\\thomas\\OneDrive\\Dokumente\\Finanzen\\docs\\screenshots";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("http://localhost:5173/…");
  await page.waitForTimeout(400); // let the SPA render/fetch before annotating
  await annotate(page, [{ text: "Gesamtsaldo", number: 2, dx: -22, dy: 10 }]);
  await page.screenshot({ path: path.join(OUT, "name.png"), fullPage: true });
  await browser.close();
})();
```

**Lessons already paid for — apply them, don't relearn them:**

1. **Seed realistic demo data via the API first**, in exactly one `node -e` / script run (`fetch('http://localhost:3001/api/...')`). Every number quoted in ANWENDERHANDBUCH.md's examples ties back to specific seeded transactions — running seed logic twice (e.g. after a half-finished dev-server restart) silently created duplicate accounts once, see the stray-process gotcha above. After seeding, sanity-check with `GET /api/accounts` before shooting anything.
2. **Prefer Playwright's own locators** (`getByRole`, `getByLabel`, `getByPlaceholder`) over raw CSS for interactions — far more robust, and they tell you when a match is ambiguous.
3. **Scope locators to the specific form** on pages that also carry a persistent filter bar (Buchungen page: `page.locator("form.card")`) — otherwise `input[type="date"]` or `select` resolve to more than one element and Playwright throws a strict-mode violation.
4. **Select account `<select>` fields by value (account ID), not by label** — `AccountSelect` indents option labels with leading spaces to show tree depth, which breaks exact-label matching. Fetch IDs upfront with `fetch('/api/accounts/flat')`.
5. **File upload (CSV import wizard):** `page.setInputFiles('input[type="file"]', absoluteCsvPath)`. Reliable; don't simulate a `DataTransfer` drop.
6. **Badge position clamping matters:** an element flush with the viewport edge (e.g. the sidebar nav) pushed the badge fully off-screen before the `Math.max(2, …)` clamp was added — keep it.
7. When two buttons/labels sit close together, a `dx`-only offset can land the badge on the *neighboring* element's text — either use `type: "box"` (frames the exact element, unambiguous) or push the badge below the element (`dy` large, `dx` small) instead of beside it.
8. **Clean up afterwards like any other manual test:** stop node, delete `data/finanzen.db*`, restart, confirm `GET /api/accounts/flat` shows the clean seed. Don't leave demo data in the working DB file.

**Style conventions already established — match them when adding a screenshot:** numbered red circles (`type` omitted/`"dot"`) for pointing near a label or row; red boxes (`type: "box"`) for framing a specific input/button. Number sequentially from ① within one screenshot. In the manual, the legend is prose directly under the image (one clause per number), not a separate table — follow that pattern rather than introducing a new one.

## Conventions to follow (established through explicit user feedback this project)

- **Keep documentation in sync on every feature change** — the user checks for this explicitly and has caught real gaps before (e.g. DATENMODELL.md missing a new table, README.md not mentioning a new capability). When you add/change an endpoint or table: update `openapi.yaml`, `API_PLAYBOOK.md`, `DATENMODELL.md` (schema changes only), and `README.md`'s concept bullets. Verify with a quick script/grep pass before saying "docs are up to date" — don't just assert it.
- **Commit in multiple small, topically-scoped commits with descriptive messages**, not one giant commit, when a session produced several distinct features. Explain *why*, not just *what*, in the body.
- **Only commit/push when explicitly asked.**
- For non-trivial new features, use plan mode to align on approach before implementing (data model shape, which files, UX flow) — this project's owner reads and edits plans, not just rubber-stamps them.
- Test end-to-end in the running app (not just `tsc --noEmit`) before declaring a feature done, then reset the DB (see above).
- No test framework is set up by design (scope kept intentionally small); typecheck via `npx tsc --noEmit -p tsconfig.json` in `server/` and `client/` is the current safety net.

## Running & verifying

```bash
npm install        # root, installs both workspaces
npm run dev         # server on :3001 (+ /api-docs), client on :5173
```

```bash
npx tsc --noEmit -p server/tsconfig.json
npx tsc --noEmit -p client/tsconfig.json
```

## Production deployment (Docker)

Target environment: the owner's private Proxmox cluster, in an unprivileged LXC container with Docker nested inside (Proxmox "Nesting" feature enabled), not a VM — chosen for lower overhead and because Proxmox's own backup/snapshot tooling (`vzdump`) then covers the whole app including the SQLite file for free. `docker compose up -d --build` is the whole deployment. Decision log (don't redo this analysis unprompted if asked to touch deployment again):

- **PostgreSQL was considered and rejected** for this app — single-file SQLite fits a low-concurrency personal/family tool, avoids a second container, and Proxmox backup already covers it. Revisit only if a genuinely concurrent multi-instance or ephemeral-filesystem (serverless/PaaS) target comes up.
- **Auth/roles were discussed but explicitly deferred** ("just an idea for now, leave the app as is") — Owner/Editor/Viewer roles, session-based auth via `express-session`, password hashing via `node:crypto`'s `scrypt` (not `bcrypt`, to avoid reintroducing a native-binding dependency on a machine that already can't build one). Not implemented. Don't build this unprompted; the deployment work above shipped without it deliberately, on the assumption the app stays on a private/trusted network for now.
- **One container, not two.** `server/src/index.ts` conditionally serves the built client (`express.static` + a `"*"` catch-all returning `index.html`, guarded by `fs.existsSync(clientDist)` so dev mode — where `client/dist` doesn't exist and Vite's own dev server handles the client — is unaffected). This means client and API share an origin in production; no CORS/proxy config needed there.
- **`tsc` doesn't copy non-TS files.** `server/scripts/copy-migrations.js` runs as an npm `postbuild` hook and copies `src/migrations/*.sql` → `dist/migrations` — without it the production server 500s on boot (`ENOENT` looking for migrations next to the compiled `dist/index.js`). `server/openapi.yaml` needs no such step; it already lives outside `src/`, so its `path.resolve(__dirname, "../openapi.yaml")` resolution is correct unchanged in both dev and the compiled `dist/` layout.
- **Docker was not actually run/tested here** — this dev machine has no Docker installed. What *was* verified: built server + built client run correctly together via plain `node server/dist/index.js` (migrations, static serving, SPA fallback routing, API all confirmed working), and separately, the exact file layout the `Dockerfile`'s `COPY` lines produce was reproduced by hand in a scratch directory and booted successfully from there (including the `data/` relative path that `docker-compose.yml`'s volume mount targets). Still run `docker compose up -d --build` for real before trusting this in production — if it fails, it's most likely a `COPY` path or `npm ci` workspace-hoisting detail, not the application logic itself.

## Structure

```
server/src/routes/*.ts      one file per resource (accounts, payees, transactions, recurring, forecast, reports, import, importTemplates)
server/src/services/        forecast.ts (recurring→occurrence expansion), importParser.ts (CSV/date/amount parsing)
server/src/migrations/      plain numbered .sql files, applied in order by db.ts on boot
client/src/api.ts           typed fetch wrapper — the single source of truth for API shapes on the frontend
client/src/pages/*.tsx      one per nav item, matches server/src/routes 1:1
```
