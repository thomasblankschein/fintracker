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
- The Claude Browser pane's screenshot capability is not always available in a given session (fails with "Browser pane is not displayed, so the page is not compositing frames"). If you need real screenshots (e.g. for docs) and it fails, fall back to a headless Playwright script instead of giving up: `npm install playwright` in a scratch dir (not a project dependency — keep it out of `server`/`client`), launch Chromium, use `page.setInputFiles()` for file uploads, and inject numbered annotation badges via `page.evaluate()` before calling `page.screenshot()` if you need annotated callouts. This is how every screenshot in ANWENDERHANDBUCH.md was produced.
- `client/tsconfig.tsbuildinfo` is a build cache artifact that reappears locally; it's gitignored, don't add it back.

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

## Structure

```
server/src/routes/*.ts      one file per resource (accounts, payees, transactions, recurring, forecast, reports, import, importTemplates)
server/src/services/        forecast.ts (recurring→occurrence expansion), importParser.ts (CSV/date/amount parsing)
server/src/migrations/      plain numbered .sql files, applied in order by db.ts on boot
client/src/api.ts           typed fetch wrapper — the single source of truth for API shapes on the frontend
client/src/pages/*.tsx      one per nav item, matches server/src/routes 1:1
```
