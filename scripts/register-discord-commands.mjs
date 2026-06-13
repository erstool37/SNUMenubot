import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DISCORD_API = "https://discord.com/api/v10";

const fileEnv = loadEnv(join(homedir(), ".codex", "secrets", "snu-food-bot.env"));
const env = { ...fileEnv, ...process.env };
const token = env.DISCORD_BOT_TOKEN || env.DISCORD_TOKEN;
if (!token) {
  throw new Error("Set DISCORD_BOT_TOKEN or DISCORD_TOKEN before registering commands.");
}

const application = await getApplication(token);
const applicationId = env.DISCORD_APPLICATION_ID || env.DISCORD_CLIENT_ID || application.id;
if (!applicationId) {
  throw new Error("Set DISCORD_APPLICATION_ID or DISCORD_CLIENT_ID.");
}

const commands = [
  {
    name: "lunch",
    type: 1,
    description: "Show the SNU lunch menu for 302동, 301동, and 교직원식당.",
  },
  {
    name: "dinner",
    type: 1,
    description: "Show the SNU dinner menu for 302동식당.",
  },
  {
    name: "time",
    type: 1,
    description: "Show operating hours for selected SNU cafeterias.",
  },
  {
    name: "food",
    type: 1,
    description: "Show the SNU lunch and dinner menu for selected cafeterias.",
  },
  {
    name: "menu",
    type: 1,
    description: "Show the SNU menu for a selected meal.",
    options: [
      {
        name: "meal",
        description: "Meal to show.",
        type: 3,
        required: true,
        choices: [
          { name: "breakfast", value: "breakfast" },
          { name: "lunch", value: "lunch" },
          { name: "dinner", value: "dinner" },
          { name: "lunch and dinner", value: "all" },
        ],
      },
    ],
  },
  {
    name: "ping",
    type: 1,
    description: "Check whether the SNU food bot is responding.",
  },
];

const route = env.DISCORD_GUILD_ID
  ? `/applications/${applicationId}/guilds/${env.DISCORD_GUILD_ID}/commands`
  : `/applications/${applicationId}/commands`;

const response = await fetch(`${DISCORD_API}${route}`, {
  method: "PUT",
  headers: {
    authorization: `Bot ${token}`,
    "content-type": "application/json; charset=utf-8",
  },
  body: JSON.stringify(commands),
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`Discord command registration failed: HTTP ${response.status} ${body}`);
}

console.log(
  `Registered ${commands.length} ${env.DISCORD_GUILD_ID ? "guild" : "global"} commands for application ${applicationId}.`,
);
console.log(`Application public key: ${application.verify_key || "(not returned)"}`);
console.log(
  `Install URL: https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=applications.commands`,
);

async function getApplication(botToken) {
  const response = await fetch(`${DISCORD_API}/oauth2/applications/@me`, {
    headers: { authorization: `Bot ${botToken}` },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Could not read Discord application metadata: HTTP ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return values;
}
