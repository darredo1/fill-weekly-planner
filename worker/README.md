# Can-do feedback proxy

A small Cloudflare Worker that gives students structured, rubric-bound
feedback on a single can-do statement. It is the only piece of this project
that talks to an external AI service — the static site in `public/` never
holds an API key and this worker is not deployed by the GitHub Pages
workflow.

## How it works

1. The browser POSTs `{ areaId, canDoText, sessionId }` to this worker.
2. The worker fetches the live `planner-guidance.json` from the deployed
   Pages site (cached for 5 minutes) and looks up the rubric for `areaId`:
   its `description`, `strong_examples`, `weak_examples`, and `self_checks`.
   That rubric — not a separately maintained prompt — is what the model is
   graded against, so editing `public/data/planner-guidance.json` is enough
   to change feedback behavior.
3. An optional `feedback_rules` array can be added to any area object in
   that JSON for extra durable instructions specific to writing can-do
   statements (e.g. once the fuller can-do documentation is ready). If
   present, it's appended to the system prompt verbatim.
4. The worker calls Claude with a forced tool call (`submit_feedback`) so
   the response is always structured JSON (per self-check verdict +
   overall), never free text — this makes it easy to render consistently
   and prevents the model from slipping in a rewritten statement.
5. Feedback is rate-limited per `sessionId`+`areaId` (5 checks, 2 hour
   window) using Workers KV, both for cost control and to discourage
   "keep clicking until it says pass."

Only the can-do statement text and the area id leave the browser — no name,
week, course, or other plan fields are ever sent.

## Setup

```sh
cd worker
npm install

# Create the KV namespace used for rate limiting, then paste the id
# it prints into wrangler.toml's kv_namespaces entry.
npx wrangler kv namespace create RATE_LIMIT_KV

# Local dev secret (never commit .dev.vars)
cp .dev.vars.example .dev.vars
# edit .dev.vars and set your real ANTHROPIC_API_KEY

npm run dev
```

## Deploy

```sh
npx wrangler secret put ANTHROPIC_API_KEY   # prompts for the key, stores it in Cloudflare
npm run deploy
```

## Still to do before this is live on the site

- Add the deployed worker's origin to `connect-src` in
  `public/index.html`'s CSP meta tag.
- Wire `app.js` to call this endpoint (a "Check my can-do" action per
  area) and render the returned checklist without ever writing into the
  student's textarea.
- Generate a client-side `sessionId` (e.g. `crypto.randomUUID()`) stored
  alongside the existing planner state in `sessionStorage`, and send it
  with each request.
- Update `README.md` / `CONTRIBUTING.md`'s privacy section to disclose
  this new data flow in plain language.
- Restrict `ALLOWED_ORIGINS` in `src/index.js` to the real production
  origin(s) before going live; `http://localhost:8000` is included only
  for local development against the static site.
