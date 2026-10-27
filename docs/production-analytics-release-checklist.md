# Production analytics release checklist

This checklist is a release gate. Complete the preview and production columns
for one deployment before continuing to the next checkpoint. Do not record
student plans, names, exports, feedback, or screenshots containing them here.
Before enabling either analytics feature, review Cloudflare's request-metadata
and analytics-data handling and complete any required institutional review.

## Baseline snapshot

| Item | Expected value | Preview | Production |
| --- | --- | --- | --- |
| Pages URL | `https://darredo1.github.io/fill-weekly-planner/` | ☐ | ☐ |
| Feedback Worker URL | `https://fill-weekly-planner-feedback.darredo1.workers.dev/` | ☐ | ☐ |
| Source commit | Record the exact deployed commit SHA | ☐ | ☐ |
| CSP | Worker origin; `static.cloudflareinsights.com`; `cloudflareinsights.com` | ☐ | ☐ |
| Guidance library loads | All guidance cards load without console or CSP errors | ☐ | ☐ |
| Five-step planner | Complete Start, Focus, Build, Plan Approaches, and Review | ☐ | ☐ |
| Session-only preservation and reset | Reload preserves the session; Reset clears it | ☐ | ☐ |
| Exports | Copy and download match the displayed export | ☐ | ☐ |
| Claude feedback | A synthetic can-do returns feedback; errors and rate limit remain usable | ☐ | ☐ |

## Checkpoint 1 — Web Analytics beacon

1. Confirm the Cloudflare Web Analytics site exists for `darredo1.github.io`
   and the public token in `public/index.html` matches its managed snippet.
2. Deploy the preview with the beacon enabled.
3. Complete every baseline row in preview. Confirm no CSP or console error.
4. Deploy production only after preview passes; repeat every baseline row and
   confirm a page-view signal in Cloudflare.

If the beacon or CSP causes a regression, remove that change and restore the
previous deployment before proceeding.

## Checkpoint 2 — Aggregate telemetry endpoint

1. After the handling review is complete, deploy the Worker preview with the
   `TELEMETRY` Analytics Engine binding.
2. Send only synthetic payloads to `/telemetry`: a valid
   `{"event":"step_completed","step":3}` request and invalid requests with
   an extra field, an unknown event, or an invalid step.
3. Confirm the dataset contains only an event name and step number.
4. Confirm the feedback root route still returns its existing validation and
   feedback responses.

## Checkpoint 3 — Client events

Inspect the browser network panel for each event. Payloads may contain only
`event`, plus `step` for `step_completed`:

- `planner_open`
- `step_completed`
- `export_copied`
- `export_downloaded`
- `ai_feedback_requested`
- `ai_feedback_completed`

For each event, complete the full baseline table. Temporarily block
`/telemetry` in the browser and confirm navigation, storage, copy, download,
and Claude feedback still work.

## Production acceptance

Enable `TELEMETRY_ENABLED` in `public/assets/app.js` only after the handling
review and preview checks pass. Use a second browser or device session to repeat the baseline. Confirm
Cloudflare's Web Analytics and Analytics Engine reporting show aggregate
totals only. Keep reporting in Cloudflare: do not export it, join it with
Canvas, or add course, level, or session breakdowns.
