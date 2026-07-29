# FILL Weekly Planner V2

A privacy-first, static planning wizard for students. It helps students author a weekly plan, then export it for submission in Canvas. This repository intentionally contains no student submissions, raw source materials, credentials, analytics, or backend services.

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

The application uses browser `sessionStorage` only; plans are cleared when the browser session ends or the student selects Reset. The Pages site does not transmit or retain plan answers. Canvas is the submission and feedback channel.

This repository must never contain student or project-member PII, completed plans, Canvas exports, feedback, raw sources, credentials, or local working notes. Use only synthetic examples and reviewed public guidance. See [CONTRIBUTING.md](CONTRIBUTING.md) for the mandatory privacy rule and pull-request checks.

Use feature branches and pull requests. The GitHub Actions workflow validates the static files and deploys only `public/` after changes reach the protected `main` branch. In the GitHub repository, set Pages to deploy with **GitHub Actions** and record the default `https://darredo1.github.io/fill-weekly-planner/` URL here after the first deployment. Keep the GitHub repository private only if the account plan supports Pages for private repositories; the Pages site itself is public.
