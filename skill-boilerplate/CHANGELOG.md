# Changelog

## 0.1.2

- The dashboard question card no longer says to answer in chat. Chat mode and a stopped dashboard still say so.
- The theme key is `skill-boilerplate-theme`. A saved `review-theme` or `session-theme` value is copied once.

## 0.1.1

- `questionsAfterDocs(session, out)` receives the session folder, so a skill can read `out/docs`.
- The docs pill uses fresh, stale, and failed counts.
- Findings, Notes, Details, and Captures render only when the session has them.
- `docs.everyInvocation: false` reuses `docs/summary.json`. `true` fetches again.

## 0.1.0

- First extraction of the session, dashboard, and question workflow from express-addon-review 0.4.0.
- Skills add an extension. The first question is mode. Docs are a later command.
- Sources are fetched in parallel, with a per-page timeout and an overall budget. A page is fresh, stale, or failed, and stale is not fresh.
