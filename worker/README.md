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
3. A top-level `feedback_guidance` object in that same JSON carries the
   course-wide rubric that applies across every area: the six "what makes a
   can-do statement good" writing criteria, the common weak-statement
   pattern to watch for, and a `target_level` (currently `"novice"`) with
   ACTFL proficiency descriptions so the model can recognize when a
   statement describes above-target ability and say so, rather than just
   scoring it as "too hard." This is separate from each area's own
   `self_checks` (still the actual scored checklist) — it's context that
   shapes how the model explains its verdicts. An optional `feedback_rules`
   array can also be added to any individual area object for guidance
   specific to that one area; if present, it's appended to the system
   prompt verbatim.
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

## Site wiring

`app.js` already calls this worker: step 3's area cards render a "Check my
can-do" button (only when `FEEDBACK_ENABLED` is true) that POSTs the
statement, renders the returned checklist, and never writes into the
student's textarea. A per-tab `sessionId` is generated with
`crypto.randomUUID()` and stored in `sessionStorage` separately from the
plan itself, cleared on Reset.

## Still to do before this is live on the site

1. Deploy this worker (see Deploy above) and note the `*.workers.dev` URL
   Cloudflare gives you.
2. Replace the placeholder URL in exactly two places with that real URL:
   - `FEEDBACK_ENDPOINT` in `public/assets/app.js`
   - the `connect-src` entry in the CSP meta tag in `public/index.html`
   (Both files have a comment pointing at each other and at this file.)
   Until both are updated, the feedback UI stays hidden — `FEEDBACK_ENABLED`
   in `app.js` checks for the placeholder string and disables the feature
   rather than shipping a broken button.
3. Restrict `ALLOWED_ORIGINS` in `src/index.js` to the real production
   origin(s) before going live; `http://localhost:8000` is included only
   for local development against the static site.
