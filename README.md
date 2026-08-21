# SNU Food Discord Worker

Cloudflare Worker for SNUCO menu Discord slash commands.

Commands:

- `/lunch`
- `/dinner` (302동식당 only)
- `/time`
- `/food`
- `/menu meal:<breakfast|lunch|dinner|lunch and dinner>`
- `/ping`
- Slack: `/snumenu lunch`, `/snumenu dinner`, `/snumenu time`

The menu source is the official SNUCO page:

- `https://snuco.snu.ac.kr/foodmenu/`

The default restaurant filter is:

- `302동,301동,교직원식당`

## Local Check

```bash
node scripts/test-menu.mjs
node scripts/test-discord-ping.mjs
```

## Cloudflare Setup

### Dashboard Setup

Use this path if `wrangler` is not installed locally.

1. Open `https://dash.cloudflare.com/`.
2. Go to **Workers & Pages**.
3. Click **Create application**.
4. Choose **Worker**.
5. Name it `snumenubot`.
6. Deploy the starter Worker.
7. Open **Edit code**.
8. Replace the starter code with the contents of `src/worker.compact.js`.
9. Click **Save and deploy**.
10. Open the Worker **Settings**.
11. Add this variable:

```text
DISCORD_PUBLIC_KEY=0c9390ef0af085be066f03938f1cd6a82f32f1b255b75b07eea5ac1d23924517
```

Do not add `DISCORD_TOKEN` to Cloudflare. The bot token is only needed locally to register slash commands.

12. Copy the Worker URL, for example:

```text
https://snumenubot.<your-subdomain>.workers.dev/
```

13. In Discord Developer Portal, open the app and paste that URL into **General Information → Interactions Endpoint URL**.

14. Save. Discord should verify the endpoint.

15. Install the app to your server:

```text
https://discord.com/oauth2/authorize?client_id=1501183299064828114&scope=applications.commands
```

16. In Discord, test `/ping`, then `/lunch`.

Global commands were registered for this app. They can take time to appear. For faster server-only commands, register with `DISCORD_GUILD_ID`.

### Wrangler Setup

Deploy the Worker:

```bash
wrangler login
wrangler secret put DISCORD_PUBLIC_KEY
wrangler deploy
```

Set the Discord app's Interactions Endpoint URL to the deployed Worker URL, for example:

```text
https://snumenubot.<your-subdomain>.workers.dev/
```

Discord will verify the endpoint using the app public key.

## Register Discord Commands

The command registration script reads `DISCORD_TOKEN` from `~/.codex/secrets/snu-food-bot.env` if present. You can also pass values directly:

```bash
DISCORD_TOKEN="..." DISCORD_APPLICATION_ID="..." node scripts/register-discord-commands.mjs
```

For this Discord application:

```bash
DISCORD_TOKEN="..." DISCORD_APPLICATION_ID="1501183299064828114" node scripts/register-discord-commands.mjs
```

For immediate guild-only command registration:

```bash
DISCORD_TOKEN="..." DISCORD_APPLICATION_ID="..." DISCORD_GUILD_ID="..." node scripts/register-discord-commands.mjs
```

Global commands can take time to propagate. Guild commands usually appear quickly.

Install URL format:

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=applications.commands
```

## Slack Setup

The Slack path is slash-command only. It does not request channel read, channel write,
DM read, or bot message scopes. Successful menu and time responses are posted
to the channel through Slack's `response_url`; loading, help, and error messages
remain ephemeral.

1. Deploy the Worker so the Slack request URL is reachable over HTTPS.
2. In Cloudflare, add this Worker secret:

```text
SLACK_SIGNING_SECRET=<Slack app signing secret>
```

3. In `slack-app-manifest.yaml`, replace:

```text
https://snumenubot.whddnjs472.workers.dev/slack/commands
```

with the deployed Worker URL plus `/slack/commands`.

4. In Slack app settings, create or update an app from the manifest.
5. Install the app only after confirming the workspace approval prompt.

Usage:

```text
/snumenu lunch
/snumenu dinner
/snumenu time
```

The command can be typed from Slack. Successful menu and time response payloads
use `response_type: in_channel` so other channel members can see them.

## Scheduled Lunch Announcement

The Worker posts the **lunch** menu automatically to a Slack channel every weekday
(Mon–Fri) at **10:30 KST**. It skips posting when there is no lunch to show — which
covers public holidays and any day the cafeterias are closed (the SNUCO page returns no
lunch, so the Worker stays silent). No holiday calendar or extra API is required.

This is driven by a Cloudflare Cron Trigger (`scheduled` handler) and a Slack **Incoming
Webhook** — separate from the slash-command path. The slash command's `response_url`
cannot be used here (it is only issued in response to a command and expires), so a real
Incoming Webhook is needed.

### 1. Create a Slack Incoming Webhook (once)

1. Open `https://api.slack.com/apps` and select **SNU Menu Bot**.
2. Go to **Incoming Webhooks** and toggle it **On**.
3. Click **Add New Webhook to Workspace**, pick the target channel, and **Allow**.
4. Copy the generated URL (`https://hooks.slack.com/services/...`). Treat it as a secret.

The manifest (`slack-app-manifest.yaml`) already declares `incoming-webhook`; reinstalling
the app from the manifest also enables this.

### 2. Deploy the updated Worker

Deploy `src/worker.compact.js` the same way as before (Dashboard **Edit code** paste, or
`wrangler deploy`). The compact file is the deployed entry point.

### 3. Add the webhook URL as a Worker secret

- Dashboard: Worker → **Settings → Variables and Secrets** → **Add** →
  name `SLACK_WEBHOOK_URL`, value = the webhook URL, type **Secret** → **Save**.
- Wrangler: `wrangler secret put SLACK_WEBHOOK_URL`

Do not put the webhook URL in `wrangler.toml` `[vars]`, the code, or any commit. For local
testing put it in `.dev.vars` (gitignored) only.

### 4. Register the Cron Trigger

- Dashboard: Worker → **Settings → Triggers → Cron Triggers → Add Cron Trigger** →
  `30 1 * * 1-5`.
- Wrangler: the `[triggers]` block in `wrangler.toml` is applied on `wrangler deploy`.

The cron is UTC. Korea has no DST, so `30 1 * * 1-5` is always 10:30 KST, Mon–Fri.

### 5. Failure handling

A missing post is never ambiguous any more. `postLunch` distinguishes three cases:

| Case | Behaviour |
|---|---|
| SNUCO fetch fails | 3 attempts, 1.5s/3.0s backoff, 10s timeout each. If all fail, a `:warning:` notice is posted to the channel and the reason is logged. |
| Page returns 200 but the menu table is gone | Treated as a **failure**, not a holiday — markup change or a block page would otherwise be indistinguishable from an empty menu. Retried, then reported. |
| No lunch on the page | Stays silent, by design — this is the holiday/closed-cafeteria path. Logged with the row count. |
| Slack rejects the post | Status and body are logged, then the invocation throws so it is recorded as an error in the dashboard. |

Every scheduled run logs `scheduled: start` on entry, so "did the cron fire at all?"
is answerable from Workers Logs alone. This requires the `[observability]` block in
`wrangler.toml`; without it a dropped cron and a dead webhook are indistinguishable.

### 5. Verify

- `npm run check` — static checks incl. `scripts/test-schedule.mjs`.
- `npm run test:schedule` — asserts empty menu → skip, lunch present → text, and fetch retry/exhaustion.
- Local rehearsal (wrangler only): `npx wrangler dev`, then in another shell
  `curl "http://localhost:8787/cdn-cgi/handler/scheduled"`. With `SLACK_WEBHOOK_URL`
  in `.dev.vars`, this posts a real test message to the channel.
- The dashboard has **no** "run now" button for cron. To test a deployed Worker without
  wrangler, temporarily set the cron a few minutes ahead (in UTC) in the dashboard, watch
  the channel, then set it back to `30 1 * * 1-5`. Test on a weekday when cafeterias serve
  (otherwise the empty-menu skip correctly posts nothing).
