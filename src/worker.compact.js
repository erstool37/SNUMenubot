const API = "https://discord.com/api/v10";
const MENU = "https://snuco.snu.ac.kr/foodmenu/";
const RESTAURANTS = "302동,301동,교직원식당";
const DINNER_RESTAURANTS = "302동식당";
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
    if (url.pathname === "/slack/commands") return handleSlack(req, body, env);
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
async function handleSlack(req, body, env) {
  if (!(await verifySlack(req, body, env.SLACK_SIGNING_SECRET))) return text("invalid request signature", 401);
  try {
    const rows = await fetchMenu(env);
    return json({ response_type: "ephemeral", text: slackMd(slackOut(rows, slackAction(new URLSearchParams(body).get("text") || ""), env)) });
  } catch (err) {
    return json({ response_type: "ephemeral", text: `메뉴를 가져오지 못했습니다: ${err?.message || err}` });
  }
}
async function handleCommand(interaction, env) {
  try {
    if (interaction.data?.name === "ping") return reply(interaction, "pong");
    const rows = await fetchMenu(env);
    const preferred = preferredRestaurantsForCommand(interaction, env);
    const out = interaction.data?.name === "time" ? formatTime(rows, preferred) : formatMenu(rows, getMeals(interaction), preferred);
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
async function verifySlack(req, body, secret) {
  const sig = req.headers.get("x-slack-signature");
  const ts = req.headers.get("x-slack-request-timestamp");
  const n = parseInt(ts || "", 10);
  if (!sig || !ts || !secret || !Number.isFinite(n) || Math.abs(Date.now() / 1000 - n) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${body}`));
  return eq(`v0=${bytes(new Uint8Array(digest))}`, sig);
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
function slackAction(s) {
  const x = s.trim().toLowerCase().split(/\s+/).filter(Boolean)[0] || "lunch";
  if (["lunch", "점심"].includes(x)) return "lunch";
  if (["dinner", "저녁"].includes(x)) return "dinner";
  if (["time", "hours", "hour", "시간", "운영시간"].includes(x)) return "time";
  return "help";
}
function slackOut(rows, action, env) {
  if (action === "help") return "사용법: /snumenu lunch | dinner | time";
  const preferred = action === "dinner" ? env.SNU_FOOD_BOT_DINNER_RESTAURANTS || DINNER_RESTAURANTS : env.SNU_FOOD_BOT_RESTAURANTS || RESTAURANTS;
  return action === "time" ? formatTime(rows, preferred) : formatMenu(rows, [action], preferred);
}
function slackMd(s) { return s.replace(/\*\*([^*\n]+)\*\*/g, "*$1*"); }
export function preferredRestaurantsForCommand(interaction, env = {}) {
  return interaction.data?.name === "dinner" ? env.SNU_FOOD_BOT_DINNER_RESTAURANTS || DINNER_RESTAURANTS : env.SNU_FOOD_BOT_RESTAURANTS || RESTAURANTS;
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
export function formatMenu(rows, meals, preferred, now = new Date()) {
  const today = kdate(now);
  const names = preferred.split(",").map((x) => x.trim()).filter(Boolean);
  rows = rows.filter((r) => names.length === 0 || names.some((n) => r.restaurant.toLowerCase().includes(n.toLowerCase()))).slice(0, 8);
  const parts = [meals.length === 1 ? `${today} ${LABEL[meals[0]] || meals[0]}` : today];
  if (rows.length === 0) return [...parts, "", preferred ? `메뉴를 찾지 못했습니다: ${preferred}` : "메뉴를 찾지 못했습니다."].join("\n");
  for (const meal of meals) {
    if (meals.length > 1) parts.push("", `[${LABEL[meal] || meal}]`);
    let found = false;
    for (const r of rows) {
      const menu = clip(r[meal]);
      if (!menu) continue;
      found = true;
      parts.push("", `**${r.restaurant}**`, ...menu.split("\n").map((line) => `• ${line}`));
    }
    if (!found) parts.push("", "등록된 메뉴가 없습니다.");
  }
  return parts.join("\n").trim();
}
export function formatTime(rows, preferred, max = 8) {
  rows = rows.filter((r) => !preferred || preferred.split(",").map((x) => x.trim()).filter(Boolean).some((n) => r.restaurant.toLowerCase().includes(n.toLowerCase()))).slice(0, max);
  const parts = ["운영시간"];
  let found = false;
  for (const r of rows) {
    const lines = ["breakfast", "lunch", "dinner"].map((m) => {
      const t = time(r[m]);
      return t ? `• ${LABEL[m] || m} ${t}` : "";
    }).filter(Boolean);
    if (!lines.length) continue;
    found = true;
    parts.push("", `**${r.restaurant}**`, ...lines);
  }
  if (!found) parts.push("", "등록된 운영시간이 없습니다.");
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
function kdate(d) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const wd = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(d).replace(/요일$/, "");
  return `${day} (${wd})`;
}
function clip(s = "", max = 12) {
  const lines = s.split("\n").map(line).filter(Boolean);
  return lines.length <= max ? lines.join("\n") : [...lines.slice(0, max), `외 ${lines.length - max}개`].join("\n");
}
function line(s) {
  let v = s.replace(/[ \t\u00a0]+/g, " ").trim();
  if (!v || /^※/.test(v) || /^(운영시간|혼잡시간)\s*[:：]/.test(v)) return "";
  if (/^<[^>]+>\s*(?:[:：]?\s*\d{1,3}(?:,\d{3})*원)?$/.test(v)) return "";
  v = v.replace(/\s*[:：]?\s*\d{1,3}(?:,\d{3})*원/g, "").replace(/\s*[:：]\s*$/, "").trim();
  return !v || /^<[^>]+>$/.test(v) ? "" : v;
}
function time(s = "") {
  for (const x of s.split("\n")) {
    const m = x.match(/^※?\s*운영시간\s*[:：]\s*(.+)$/);
    if (m) return m[1].replace(/[ \t\u00a0]+/g, " ").trim();
  }
  return "";
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
function bytes(b) { return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); }
function eq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function json(x, status = 200) { return new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
function text(x, status = 200) { return new Response(x, { status, headers: { "content-type": "text/plain; charset=utf-8" } }); }
