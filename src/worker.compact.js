const API = "https://discord.com/api/v10";
const MENU = "https://snuco.snu.ac.kr/foodmenu/";
const RESTAURANTS = "302동,301동,교직원식당";
const LIMIT = 1900;
const LABEL = { breakfast: "아침", lunch: "점심", dinner: "저녁" };
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return text(`ok\npublic_key_configured=${env.DISCORD_PUBLIC_KEY ? "true" : "false"}\n`);
    }
    if (req.method !== "POST") return text("Discord interaction endpoint\n");
    const body = await req.text();
    if (!(await verify(req, body, env.DISCORD_PUBLIC_KEY))) return text("invalid request signature", 401);
    const interaction = JSON.parse(body);
    if (interaction.type === 1) return json({ type: 1 });
    if (interaction.type !== 2) {
      return json({ type: 4, data: { content: "Unsupported Discord interaction type.", flags: 64 } });
    }
    ctx.waitUntil(handleCommand(interaction, env));
    return json({ type: 5 });
  },
};
async function handleCommand(interaction, env) {
  try {
    if (interaction.data?.name === "ping") return reply(interaction, "pong");
    const rows = await fetchMenu(env);
    const out = formatMenu(rows, getMeals(interaction), env.SNU_FOOD_BOT_RESTAURANTS || RESTAURANTS);
    return reply(interaction, out);
  } catch (err) {
    return reply(interaction, `Could not fetch the SNU menu: ${err?.message || err}`, 64);
  }
}
async function verify(req, body, publicKeyHex) {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!sig || !ts || !publicKeyHex) return false;
  const key = await crypto.subtle.importKey("raw", hex(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, hex(sig), new TextEncoder().encode(ts + body));
}
async function reply(interaction, content, flags) {
  const url = `${API}/webhooks/${interaction.application_id}/${interaction.token}`;
  for (const [i, chunk] of chunks(content, LIMIT).entries()) {
    const payload = { content: chunk };
    if (flags && i === 0) payload.flags = flags;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}: ${await res.text()}`);
  }
}
function getMeals(interaction) {
  const name = interaction.data?.name;
  if (name === "lunch") return ["lunch"];
  if (name === "dinner") return ["dinner"];
  if (name === "food") return ["lunch", "dinner"];
  if (name === "menu") {
    const meal = interaction.data?.options?.find((x) => x.name === "meal")?.value;
    if (meal === "all") return ["lunch", "dinner"];
    if (["breakfast", "lunch", "dinner"].includes(meal)) return [meal];
  }
  return ["lunch"];
}
export async function fetchMenu(env) {
  const res = await fetch(env.SNU_FOOD_BOT_MENU_URL || MENU, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": "snu-food-discord-worker/1.0" },
  });
  if (!res.ok) throw new Error(`SNUCO returned HTTP ${res.status}`);
  return parseMenu(await res.text());
}
function parseMenu(html) {
  const table = html.match(/<div[^>]*id=["']celeb-mealtable["'][\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!table) return [];
  const rows = [];
  for (const tr of all(table, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = {};
    for (const td of all(tr[1], /<t[dh][^>]*class=["'][^"']*\b(title|breakfast|lunch|dinner)\b[^"']*["'][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      row[td[1]] = clean(td[2]);
    }
    if (row.title && row.title !== "식당") {
      rows.push({ restaurant: row.title, breakfast: row.breakfast || "", lunch: row.lunch || "", dinner: row.dinner || "" });
    }
  }
  return rows;
}
export function formatMenu(rows, meals, preferred) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const names = preferred.split(",").map((x) => x.trim()).filter(Boolean);
  rows = rows.filter((r) => names.length === 0 || names.some((n) => r.restaurant.toLowerCase().includes(n.toLowerCase()))).slice(0, 8);
  const parts = [`SNU food menu for ${today}`, "Source: SNUCO official food menu"];
  if (rows.length === 0) return [...parts, "", `No menu rows found for: ${preferred}`].join("\n");
  for (const meal of meals) {
    parts.push("", `[${LABEL[meal] || meal}]`);
    let found = false;
    for (const r of rows) {
      if (!r[meal]) continue;
      found = true;
      parts.push(`- ${r.restaurant}`, clip(r[meal]).split("\n").map((line) => `  ${line}`).join("\n"));
    }
    if (!found) parts.push("- No menu posted.");
  }
  return parts.join("\n").trim();
}
function clean(html) {
  return decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""))
    .replace(/\r/g, "\n")
    .split("\n")
    .map((x) => x.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}
function decode(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const x = e.toLowerCase();
    if (x[0] !== "#") return named[x] || m;
    const n = x[1] === "x" ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}
function clip(s, max = 7) {
  const lines = s.split("\n").filter(Boolean);
  return lines.length <= max ? lines.join("\n") : [...lines.slice(0, max), `... ${lines.length - max} more lines`].join("\n");
}
function chunks(s, limit) {
  if (s.length <= limit) return [s];
  const out = [];
  let cur = [];
  let len = 0;
  for (const line of s.split("\n")) {
    if (cur.length && len + line.length + 1 > limit) out.push(cur.join("\n")), cur = [], len = 0;
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}
function all(s, r) { return Array.from(s.matchAll(r)); }
function hex(s) { return new Uint8Array(s.trim().match(/../g).map((x) => parseInt(x, 16))); }
function json(x, status = 200) { return new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function text(x, status = 200) { return new Response(x, { status, headers: { "content-type": "text/plain; charset=utf-8" } }); }
