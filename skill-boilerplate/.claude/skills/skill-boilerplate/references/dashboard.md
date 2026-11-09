# Dashboard

The dashboard is a page on `127.0.0.1`. Offer it only when you run on the user's own computer. If you run in a cloud agent, over SSH, or in a container, run `session.mjs mode --set chat`.

## Commands

```text
dashboard.mjs start [--no-open]
dashboard.mjs status
dashboard.mjs stop

session.mjs mode    --set dashboard|chat
session.mjs step    --id decide --status running|waiting|done|skipped [--doing "..."] [--progress 3/12]
session.mjs ask     --id <id>
session.mjs wait    --id <id> [--timeout 25]
session.mjs answer  --id <id> --value <option id or text>
session.mjs next
session.mjs done    [--summary "..."]
session.mjs show
```

## The wait contract

`ask` publishes a decision. `wait` blocks for up to `--timeout` seconds (default 25, at most 110) and prints one of:

- `{"status":"answered","value":"...","via":"dashboard"}`. Act on `value`.
- `{"status":"pending"}`. Run the same `wait` again, immediately.
- `{"status":"server-down"}`. Run `dashboard.mjs start` once. If that fails, `mode --set chat`, call AskQuestion, and record it with `answer`. This is the only dashboard-mode path that uses AskQuestion.
- `{"status":"missing"}`. You waited on an id you never published.

Do not write to the user between `ask` and `wait`. Do not end your turn while `status` is `pending`.

## Security

- Binds to `127.0.0.1` only.
- A random token in the link. Every request needs it. Without it: 401.
- The `Host` header must be the loopback address and port. Otherwise the request is refused.
- A POST must come from the page itself. `Origin` must match.
- An answer must match a published option, or be the text of a text question. A question can be answered once.
- Files are served only from the session folder, and only `report.md` and images in `shots/`.
- `server.json` is mode `0600`.
- The server stops itself after 45 minutes with no request.
