const API = "https://discord.com/api/v10";
const MENU = "https://snuco.snu.ac.kr/foodmenu/";
const RESTAURANTS = "302동,301동,교직원식당";
const DINNER_RESTAURANTS = "302동식당";
const LIMIT = 1900;
const LABEL = { breakfast: "아침", lunch: "점심", dinner: "저녁" };
const EXCLUDED = new Set(["닭가슴살큐브샐러드", "헬스팩"]);
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return text(`ok\npublic_key_configured=${env.DISCORD_PUBLIC_KEY ? "true" : "false"}\n`);
    }
    if (req.method !== "POST") return text("Discord interaction endpoint\n");
    const body = await req.text();
    if (url.pathname === "/slack/commands") return handleSlack(req, body, env, ctx);
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
async function handleSlack(req, body, env, ctx) {
  if (!(await verifySlack(req, body, env.SLACK_SIGNING_SECRET))) return text("invalid request signature", 401);
  const params = new URLSearchParams(body);
  const responseUrl = params.get("response_url");
  if (!responseUrl) {
    return json({ response_type: "ephemeral", text: "Slack response_url이 없습니다. 앱 설정을 다시 확인해 주세요." });
  }
  const delayed = defer().then(() => sendSlack(responseUrl, slackAction(params.get("text") || ""), env));
  if (ctx?.waitUntil) ctx.waitUntil(delayed);
  else delayed.catch(() => {});
  return json({ response_type: "ephemeral", text: "메뉴를 불러오는 중입니다." });
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
function defer() { return new Promise((resolve) => setTimeout(resolve, 0)); }
async function sendSlack(responseUrl, action, env) {
  let out;
  try {
    if (action === "help") out = slackOut([], action, env);
    else out = slackOut(await fetchMenu(env), action, env);
  } catch (err) {
    out = `메뉴를 가져오지 못했습니다: ${err?.message || err}`;
  }
  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", "user-agent": "snu-food-discord-worker/1.0" },
    body: JSON.stringify({ response_type: "ephemeral", text: slackMd(out) }),
  });
  if (!res.ok) throw new Error(`Slack response_url returned HTTP ${res.status}: ${await res.text()}`);
}
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
  rows = filterRows(rows, preferred).slice(0, 8);
  const parts = [meals.length === 1 ? `${today} ${LABEL[meals[0]] || meals[0]}` : today];
  if (rows.length === 0) return [...parts, "", preferred ? `메뉴를 찾지 못했습니다: ${preferred}` : "메뉴를 찾지 못했습니다."].join("\n");
  for (const meal of meals) {
    if (meals.length > 1) parts.push("", `[${LABEL[meal] || meal}]`);
    let found = false;
    for (const r of rows) {
      const menu = clip(r[meal]);
      if (!menu) continue;
      found = true;
      parts.push("", `**${dname(r.restaurant)}**`, ...menu.split("\n").map((line) => `• ${line}`));
    }
    if (!found) parts.push("", "등록된 메뉴가 없습니다.");
  }
  return parts.join("\n").trim();
}
export function formatTime(rows, preferred, max = 8) {
  rows = filterRows(rows, preferred).slice(0, max);
  const parts = ["운영시간"];
  let found = false;
  for (const r of rows) {
    const lines = ["breakfast", "lunch", "dinner"].map((m) => {
      const t = time(r[m]);
      return t ? `• ${LABEL[m] || m} ${t}` : "";
    }).filter(Boolean);
    if (!lines.length) continue;
    found = true;
    parts.push("", `**${dname(r.restaurant)}**`, ...lines);
  }
  if (!found) parts.push("", "등록된 운영시간이 없습니다.");
  return parts.join("\n").trim();
}
function filterRows(rows, preferred = "") {
  const expanded = expandRows(rows);
  const names = preferred.split(",").map((x) => x.trim()).filter(Boolean);
  return names.length ? expanded.filter((r) => names.some((n) => matchRestaurant(r.restaurant, n))) : expanded;
}
function expandRows(rows) {
  const out = [];
  for (const row of rows) {
    if (staffTitle(row.restaurant)) {
      out.push(row);
      continue;
    }
    const base = { ...row };
    const staff = new Map();
    for (const meal of ["breakfast", "lunch", "dinner"]) {
      const split = splitStaff(base[meal] || "");
      base[meal] = split.base;
      for (const section of split.staff) {
        const r = staff.get(section.restaurant) || { restaurant: section.restaurant, breakfast: "", lunch: "", dinner: "" };
        r[meal] = [r[meal], section.text].filter(Boolean).join("\n");
        staff.set(section.restaurant, r);
      }
    }
    out.push(base, ...staff.values());
  }
  return out;
}
function splitStaff(text) {
  const base = [];
  const staff = [];
  let current = null;
  for (const line of text.split("\n")) {
    const title = sectionTitle(line);
    if (title) {
      if (staffTitle(title)) {
        current = { restaurant: title, lines: [] };
        staff.push(current);
      } else {
        current = null;
        base.push(line);
      }
      continue;
    }
    if (current) current.lines.push(line);
    else base.push(line);
  }
  return {
    base: sectionText(base),
    staff: staff.map((x) => ({ restaurant: x.restaurant, text: sectionText(x.lines) })).filter((x) => x.text),
  };
}
function sectionTitle(line) {
  const m = line.trim().match(/^<([^<>]+)>$/);
  return m ? m[1].replace(/[ \t\u00a0]+/g, " ").trim() : "";
}
function staffTitle(title) {
  const k = rkey(title);
  return k.includes("교직원") && k.includes("식당");
}
function sectionText(lines) { return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(); }
function matchRestaurant(restaurant, preferred) {
  const rks = rkeys(restaurant);
  const pks = rkeys(preferred);
  for (const pk of pks) for (const rk of rks) if (rk === pk) return true;
  if (pks.some((x) => /^\d+(?:동)?(?:식당)?$/.test(x))) return false;
  for (const pk of pks) for (const rk of rks) if (rk.includes(pk)) return true;
  return false;
}
function rkeys(v) {
  const raw = rkey(v);
  if (!raw) return [];
  const keys = new Set([raw]);
  const noStaffOnly = raw.replace(/전용/g, "");
  keys.add(noStaffOnly);
  keys.add(raw.replace(/동식당/g, "식당"));
  keys.add(noStaffOnly.replace(/동식당/g, "식당"));
  if (/^\d+동$/.test(raw)) keys.add(`${raw}식당`), keys.add(raw.replace(/동$/, "식당"));
  if (/^\d+식당$/.test(raw)) keys.add(raw.replace(/식당$/, "동식당"));
  return [...keys].filter(Boolean);
}
function rkey(v) { return v.toLowerCase().replace(/\([^)]*\)/g, "").replace(/^[*]+/g, "").replace(/[ \t\u00a0]+/g, "").trim(); }
function dname(v) { return v.replace(/\s*\(\d{2,4}-\d{3,4}\)\s*$/, "").trim(); }
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
  if (EXCLUDED.has(v)) return "";
  return !v || /^<[^>]+>$/.test(v) ? "" : v;
}
function time(s = "") {
  const times = [];
  for (const x of s.split("\n")) {
    const operating = x.match(/^※?\s*운영시간\s*[:：]?\s*(.+)$/);
    if (operating) {
      times.push(operating[1].replace(/[ \t\u00a0]+/g, " ").trim());
      continue;
    }
    const staff = x.match(/^※?\s*교직원\s*이용시간\s*[:：]?\s*(.+)$/);
    if (staff) {
      times.push(`교직원 ${staff[1].replace(/[ \t\u00a0]+/g, " ").trim()}`);
      continue;
    }
    const student = x.match(/^※?\s*학생\s*및\s*대학원생\s*이용시간\s*[:：]?\s*(.+)$/);
    if (student) times.push(`학생 및 대학원생 ${student[1].replace(/[ \t\u00a0]+/g, " ").trim()}`);
  }
  return times.join(" / ");
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
