# FILL Weekly Planner V2

A privacy-first, static planning wizard for students. It helps students author a weekly plan, then export it for submission in Canvas. This repository intentionally contains no student submissions, raw source materials, credentials, or student-level analytics.

## Local preview

From the repository root, serve `public/` with any static web server, for example:

```sh
python3 -m http.server 8000 --directory public
```

Open `http://localhost:8000`. Opening `index.html` directly may prevent the browser from loading the JSON guidance library.

## Editing guidance

All student-facing guidance is in `public/data/planner-guidance.json`. Content editors can revise the adapted language, examples, prompts, and cards there without changing application code. Every curated record retains:

- `source_document`
- `source_section_or_page`
- `content_status`

Use only short, adapted, reviewed content. Do not commit raw FILL/ACTFL working documents, confidential curation notes, or student data.

## Privacy and publishing

The application uses browser `sessionStorage` only; plans are cleared when the browser session ends or the student selects Reset. Canvas is the submission and feedback channel.

The code includes optional aggregate interaction counts for planner opens, completed steps, copies, downloads, and AI-feedback requests/completions. Telemetry is disabled in the client by default, separately from the feedback feature. Before enabling it, review Cloudflare's handling and retention of Worker request metadata and Analytics Engine data, and complete any required institutional review. When enabled, the custom telemetry payload is limited to an allowlisted event name and, for completed steps, a number from 1–5. It contains no plan content, student information, course, proficiency level, identifiers, or session tokens. Keep reporting in Cloudflare; do not export the counts, join them with Canvas, or break them down by course, level, or session.

The one exception: if a student clicks "Check my can-do" in step 3, that single can-do statement's text (and the learning area it belongs to) is sent to a separate feedback service (`worker/`) to get AI-generated feedback against the same rubric shown on screen. No other field — name, course, week, topic, activities, or any other statement — is included in that request, and the request is not required to complete or export a plan. See `worker/README.md` for how that service is configured and what it does and does not retain.

This repository must never contain student or project-member PII, completed plans, Canvas exports, feedback, raw sources, credentials, or local working notes. Use only synthetic examples and reviewed public guidance. See [CONTRIBUTING.md](CONTRIBUTING.md) for the mandatory privacy rule and pull-request checks.

Use feature branches and pull requests. The GitHub Actions workflow validates the static files and deploys only `public/` after changes reach the protected `main` branch. In the GitHub repository, set Pages to deploy with **GitHub Actions** and record the default `https://darredo1.github.io/fill-weekly-planner/` URL here after the first deployment. Keep the GitHub repository private only if the account plan supports Pages for private repositories; the Pages site itself is public.

## Production analytics release gate

The Cloudflare Web Analytics beacon is configured in `public/index.html`. Deploy a preview first and verify page-view reporting alongside the planner, guidance, five-step flow, session storage, copy/download, and Claude feedback before production. Custom interaction events remain disabled; review Cloudflare's data handling and retention and complete any required institutional review before enabling `TELEMETRY_ENABLED` in `public/assets/app.js` or deploying that endpoint for production use. If enabled, verify the `fill_weekly_planner_telemetry` dataset separately.
