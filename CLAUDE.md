# Twitter Comment Pack — instructions for Claude Code

You are helping a user set up Twitter Comment Pack. Follow these steps.

## Step 1 — Check current state

Look in `data/`:
- If `data/config.json` exists, the user has already configured. Skip to Step 3 unless they want to reconfigure.
- If `node_modules/` is missing, run `npm install` first.

## Step 2 — Run the wizard or write config directly

Two options:

**Option A (interactive)**: Tell the user to run `node setup-wizard.mjs` (or `npm run setup`) in their terminal. The wizard handles everything.

**Option B (you write config directly)**: If the user has already pasted answers in chat, you can write `data/config.json` yourself using the schema in `config.example.json`. You will also need to write `data/cookies.json` in the format `{ "cookies": [{name, value, domain, path}, ...] }`. Required cookies: at minimum `auth_token` and `ct0`.

The wizard asks 3 questions:

1. **Twitter cookies** — accepts either Cookie-Editor JSON array OR `{auth_token, ct0}` object. Wizard normalizes to `data/cookies.json`. See `guides/01-get-cookies.md`.

2. **Twitter list IDs** — comma-separated IDs of lists to crawl. See `guides/03-modes-explained.md`.

3. **Rate** — comments per hour (default 15). See `guides/04-rate-limits.md`.

Then: **AI provider** — `deepseek` (default) | `openai` | `openrouter` | `anthropic`, plus API key and optional model override.

## Step 3 — Install autostart (Windows only, optional)

`npm run install-service` creates Scheduled Tasks `TwitterCommentPack` (ONLOGON) and `TwitterCommentPack_Startup` (ONSTART). Idempotent.

## Step 4 — Start

`npm start`. Bot writes to `data/run.log`. To watch live in PowerShell: `Get-Content data/run.log -Wait`. On Linux/macOS: `tail -f data/run.log`.

## Useful guides

When the user asks how to do something, point them to the right guide:
- Cookies → `guides/01-get-cookies.md`
- List IDs & mode explanation → `guides/03-modes-explained.md`
- Rate limits → `guides/04-rate-limits.md`


## Troubleshooting

- `ct0 cookie not found` → cookie file is incomplete; re-export from a logged-in browser.
- `RATE_LIMITED 429/403` → bot is being throttled; lower `commentsPerHour` in `data/config.json`.
- `SESSION_EXPIRED` → cookies expired. User needs to re-export and re-run wizard's Q1 (or rewrite `data/cookies.json` directly).
- AI 401 → API key wrong; edit `data/config.json` `ai.apiKey` field.
