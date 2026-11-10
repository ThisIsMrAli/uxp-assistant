# Dashboard

The dashboard is a page on `127.0.0.1`. Offer it only when you run on the user's own computer. If you run in a cloud agent, over SSH, or in a container, run `node scripts/skill.mjs session mode --set chat`.

## Commands

```text
node scripts/skill.mjs dashboard start [--no-open]
node scripts/skill.mjs dashboard status
node scripts/skill.mjs dashboard stop

node scripts/skill.mjs session mode    --set dashboard|chat
node scripts/skill.mjs session step    --id implement --status running|waiting|done|skipped [--doing "..."] [--progress 3/12]
node scripts/skill.mjs session ask     --id <id>
node scripts/skill.mjs session wait    --id <id> [--timeout 25]
node scripts/skill.mjs session answer  --id <id> --value <option id or text> [--text "<their words>"] [--image <file>]...
node scripts/skill.mjs session note    --text "<what is wrong>" [--id x] [--screen "<where>"] [--shot <image>]   |   --id x --status open|fixed|skipped
node scripts/skill.mjs feedback        [--changed "<what you changed>"] [--skip]
node scripts/skill.mjs session next
node scripts/skill.mjs session done    [--summary "..."]
node scripts/skill.mjs session show
```

## The wait contract

`ask` publishes a decision. `wait` blocks for up to `--timeout` seconds (default 25, at most 110) and prints one of:

- `{"status":"answered","value":"...","via":"dashboard"}`. Act on `value`. A try card also carries `text` and `images` (absolute paths), and `next` says what to do with them.
- `{"status":"pending"}`. Run the same `wait` again, immediately.
- `{"status":"server-down"}`. Run `node scripts/skill.mjs dashboard start --no-open` once. If that fails, `mode --set chat`, call AskQuestion, and record it with `answer`. This is the only dashboard-mode path that uses AskQuestion.
- `{"status":"missing"}`. You waited on an id you never published.

Do not write to the user between `ask` and `wait`. Do not end your turn while `status` is `pending`.

## Security

- Binds to `127.0.0.1` only.
- A random token in the link. Every request needs it. Without it: 401.
- The `Host` header must be the loopback address and port. Otherwise the request is refused.
- A POST must come from the page itself. `Origin` must match.
- An answer must match a published option, or be the text of a text question. A question can be answered once.
- Screenshots: only a question published with `attach` (the try card) takes them. Up to 6 images of 5 MB each, as base64 in the JSON body. The first bytes decide the type (PNG, JPEG, WebP), never the name or the declared type. They are written as `shots/fb-<nonce>-<n>.<ext>`, so the server only ever serves what it wrote itself. Only while such a question is pending may a body exceed 64 KB; every other body over 64 KB gets 413.
- Files are served only from the session folder, and only `report.md` and images in `shots/`.
- `server.json` is mode `0600`.
- The server stops itself after 45 minutes with no request.
