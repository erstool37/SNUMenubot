# SNU Food Discord Worker

Cloudflare Worker for SNUCO menu Discord slash commands.

Commands:

- `/lunch`
- `/dinner`
- `/food`
- `/menu meal:<breakfast|lunch|dinner|lunch and dinner>`
- `/ping`

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
5. Name it `snu-food-discord-bot`.
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
https://snu-food-discord-bot.<your-subdomain>.workers.dev/
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
https://snu-food-discord-bot.<your-subdomain>.workers.dev/
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
