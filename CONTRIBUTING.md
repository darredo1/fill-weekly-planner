# Contributing to the FILL Weekly Planner

## Privacy rule

Do not add personally identifiable information to this repository or its collaboration surfaces. This rule applies to tracked files, commit messages, branch names, pull requests, issues, releases, screenshots, test fixtures, deployment logs, and documentation.

Never contribute student or project-member names, email addresses, usernames, IDs, enrollment details, completed plans, Canvas exports, instructor feedback, rosters, contact information, or identifiable working notes. Use role labels and synthetic examples only. GitHub account and normal Git author metadata are managed by the platform and are outside this content rule.

If you notice PII before merging, remove it and substitute synthetic or de-identified content. If it is already on a shared branch, stop release work and notify the repository maintainer without repeating the sensitive material in an issue or chat.

## Before opening a pull request

1. Run `python3 scripts/privacy_scan.py --history`.
2. Run `python3 -m json.tool public/data/planner-guidance.json > /dev/null` and `node --check public/assets/app.js`.
3. Confirm every example, screenshot, fixture, and guidance item is synthetic, public, or explicitly approved for publication.

To enable the local pre-commit check once per clone, run:

```sh
git config core.hooksPath .githooks
```

The GitHub Actions workflow runs the privacy scan again for pull requests and deployments. Automated checks help catch common patterns; they do not replace the human review requirement.
