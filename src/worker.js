const DISCORD_API = "https://discord.com/api/v10";
const MENU_URL = "https://snuco.snu.ac.kr/foodmenu/";
const DEFAULT_RESTAURANTS = "302동,301동,교직원식당";
const DINNER_RESTAURANTS = "302동식당";
const MAX_DISCORD_MESSAGE = 1900;

const MEAL_LABELS = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response(
        `ok\npublic_key_configured=${env.DISCORD_PUBLIC_KEY ? "true" : "false"}\n`,
        {
        headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }

    if (request.method !== "POST") {
      return new Response("Discord interaction endpoint\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const body = await request.text();
    if (url.pathname === "/slack/commands") {
      return handleSlackCommand(request, body, env);
    }

    const valid = await verifyDiscordRequest(request, body, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response("invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);
    if (interaction.type === 1) {
      return jsonResponse({ type: 1 });
    }

    if (interaction.type === 2) {
      ctx.waitUntil(handleApplicationCommand(interaction, env));
      return jsonResponse({ type: 5 });
    }

    return jsonResponse({
      type: 4,
      data: { content: "Unsupported Discord interaction type.", flags: 64 },
    });
  },
};

async function handleSlackCommand(request, body, env) {
  const valid = await verifySlackRequest(request, body, env.SLACK_SIGNING_SECRET);
  if (!valid) {
    return new Response("invalid request signature", { status: 401 });
  }

  try {
    const params = new URLSearchParams(body);
    const action = slackAction(params.get("text") || "");
    const rows = await fetchMenu(env);
    const text = slackMrkdwn(formatSlackAction(rows, action, env));
    return jsonResponse({ response_type: "ephemeral", text });
  } catch (error) {
    return jsonResponse({
      response_type: "ephemeral",
      text: `메뉴를 가져오지 못했습니다: ${errorMessage(error)}`,
    });
  }
}

async function verifyDiscordRequest(request, body, publicKeyHex) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !publicKeyHex) return false;

  const data = new TextEncoder().encode(timestamp + body);
  const publicKey = await crypto.subtle.importKey(
    "raw",
    hexToBytes(publicKeyHex),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    hexToBytes(signature),
    data,
  );
}

async function verifySlackRequest(request, body, signingSecret) {
  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");
  if (!signature || !timestamp || !signingSecret) return false;

  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Date.now() / 1000 - seconds) > 60 * 5) return false;

  const expected = `v0=${await hmacSha256Hex(signingSecret, `v0:${timestamp}:${body}`)}`;
  return constantTimeEqual(expected, signature);
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

async function handleApplicationCommand(interaction, env) {
  const name = interaction.data?.name;
  try {
    if (name === "ping") {
      await sendInteractionMessage(interaction, "pong");
      return;
    }

    const rows = await fetchMenu(env);
    const preferred = preferredRestaurantsForCommand(interaction, env);
    const text = name === "time"
      ? formatTime(rows, { preferred })
      : formatMenu(rows, {
        meals: mealsForCommand(interaction),
        preferred,
      });
    await sendInteractionMessage(interaction, text);
  } catch (error) {
    await sendInteractionMessage(
      interaction,
      `Could not fetch the SNU menu: ${errorMessage(error)}`,
      64,
    );
  }
}

function mealsForCommand(interaction) {
  const name = interaction.data?.name;
  if (name === "lunch") return ["lunch"];
  if (name === "dinner") return ["dinner"];
  if (name === "food") return ["lunch", "dinner"];
  if (name === "menu") {
    const meal = interaction.data?.options?.find((option) => option.name === "meal")?.value;
    if (meal === "all") return ["lunch", "dinner"];
    if (["breakfast", "lunch", "dinner"].includes(meal)) return [meal];
  }
  return ["lunch"];
}

function slackAction(text) {
  const [action = "lunch"] = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (["lunch", "점심"].includes(action)) return "lunch";
  if (["dinner", "저녁"].includes(action)) return "dinner";
  if (["time", "hours", "hour", "시간", "운영시간"].includes(action)) return "time";
  if (["help", "도움말"].includes(action)) return "help";
  return "help";
}

function formatSlackAction(rows, action, env) {
  if (action === "help") return "사용법: /snumenu lunch | dinner | time";
  const preferred = action === "dinner"
    ? env.SNU_FOOD_BOT_DINNER_RESTAURANTS || DINNER_RESTAURANTS
    : env.SNU_FOOD_BOT_RESTAURANTS || DEFAULT_RESTAURANTS;
  if (action === "time") return formatTime(rows, { preferred });
  return formatMenu(rows, { meals: [action], preferred });
}

function slackMrkdwn(text) {
  return text.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
}

export function preferredRestaurantsForCommand(interaction, env = {}) {
  const name = interaction.data?.name;
  if (name === "dinner") {
    return env.SNU_FOOD_BOT_DINNER_RESTAURANTS || DINNER_RESTAURANTS;
  }
  return env.SNU_FOOD_BOT_RESTAURANTS || DEFAULT_RESTAURANTS;
}

async function sendInteractionMessage(interaction, text, flags) {
  const url = `${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}`;
  const chunks = splitMessage(text, MAX_DISCORD_MESSAGE);
  for (const [index, chunk] of chunks.entries()) {
    const payload = { content: chunk };
    if (flags && index === 0) payload.flags = flags;
    await postJson(url, payload);
  }
}

export async function fetchMenu(env = {}) {
  const response = await fetch(env.SNU_FOOD_BOT_MENU_URL || MENU_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "snu-food-discord-worker/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`SNUCO returned HTTP ${response.status}`);
  }
  return parseMenuHtml(await response.text());
}

export function parseMenuHtml(html) {
  const table = html.match(/<div[^>]*id=["']celeb-mealtable["'][\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!table) return [];

  const rows = [];
  for (const rowMatch of matchAll(table, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const row = {};
    for (const cell of matchAll(rowHtml, /<t[dh][^>]*class=["'][^"']*\b(title|breakfast|lunch|dinner)\b[^"']*["'][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      row[cell[1]] = normalizeText(cell[2]);
    }
    if (row.title && row.title !== "식당") {
      rows.push({
        restaurant: row.title,
        breakfast: row.breakfast || "",
        lunch: row.lunch || "",
        dinner: row.dinner || "",
      });
    }
  }
  return rows;
}

export function formatMenu(rows, {
  meals,
  preferred = "",
  maxRestaurants = 8,
  now = new Date(),
}) {
  const today = formatKoreanDate(now);

  const filteredRows = preferredFilter(rows, preferred).slice(0, maxRestaurants);
  const parts = [meals.length === 1 ? `${today} ${MEAL_LABELS[meals[0]] || meals[0]}` : today];

  if (filteredRows.length === 0) {
    parts.push("", preferred ? `메뉴를 찾지 못했습니다: ${preferred}` : "메뉴를 찾지 못했습니다.");
    return parts.join("\n");
  }

  for (const meal of meals) {
    if (meals.length > 1) parts.push("", `[${MEAL_LABELS[meal] || meal}]`);
    let anyMenu = false;
    for (const row of filteredRows) {
      const value = clipMenuLines(row[meal]);
      if (!value) continue;
      anyMenu = true;
      parts.push("", `**${row.restaurant}**`);
      parts.push(...value.split("\n").map((line) => `• ${line}`));
    }
    if (!anyMenu) {
      parts.push("", "등록된 메뉴가 없습니다.");
    }
  }

  return parts.join("\n").trim();
}

export function formatTime(rows, { preferred = "", maxRestaurants = 8 } = {}) {
  const filteredRows = preferredFilter(rows, preferred).slice(0, maxRestaurants);
  const parts = ["운영시간"];
  let anyTime = false;

  for (const row of filteredRows) {
    const lines = [];
    for (const meal of ["breakfast", "lunch", "dinner"]) {
      const time = operatingTime(row[meal]);
      if (time) lines.push(`• ${MEAL_LABELS[meal] || meal} ${time}`);
    }
    if (lines.length === 0) continue;
    anyTime = true;
    parts.push("", `**${row.restaurant}**`, ...lines);
  }

  if (!anyTime) {
    parts.push("", "등록된 운영시간이 없습니다.");
  }

  return parts.join("\n").trim();
}

function preferredFilter(rows, preferred) {
  const names = preferred
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (names.length === 0) return rows;
  return rows.filter((row) =>
    names.some((name) => row.restaurant.toLowerCase().includes(name.toLowerCase())),
  );
}

function normalizeText(html) {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]*>/g, "");
  return decodeHtml(withoutTags)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function formatKoreanDate(date) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  }).format(date).replace(/요일$/, "");
  return `${day} (${weekday})`;
}

function clipMenuLines(text = "", maxLines = 12) {
  const lines = menuLines(text);
  if (lines.length <= maxLines) return lines.join("\n");
  return [...lines.slice(0, maxLines), `외 ${lines.length - maxLines}개`].join("\n");
}

function menuLines(text) {
  return text
    .split("\n")
    .map(cleanMenuLine)
    .filter(Boolean);
}

function cleanMenuLine(line) {
  let value = line.replace(/[ \t\u00a0]+/g, " ").trim();
  if (!value) return "";
  if (/^※/.test(value)) return "";
  if (/^(운영시간|혼잡시간)\s*[:：]/.test(value)) return "";
  if (/^<[^>]+>\s*(?:[:：]?\s*\d{1,3}(?:,\d{3})*원)?$/.test(value)) return "";

  value = value.replace(/\s*[:：]?\s*\d{1,3}(?:,\d{3})*원/g, "").trim();
  value = value.replace(/\s*[:：]\s*$/, "").trim();
  if (!value || /^<[^>]+>$/.test(value)) return "";
  return value;
}

function operatingTime(text = "") {
  for (const line of text.split("\n")) {
    const match = line.match(/^※?\s*운영시간\s*[:：]\s*(.+)$/);
    if (match) return match[1].replace(/[ \t\u00a0]+/g, " ").trim();
  }
  return "";
}

function decodeHtml(text) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower[0] === "#") {
      const codePoint = lower[1] === "x"
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[lower] || match;
  });
}

function splitMessage(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let current = [];
  let size = 0;
  for (const line of text.split("\n")) {
    const add = line.length + 1;
    if (current.length > 0 && size + add > limit) {
      chunks.push(current.join("\n"));
      current = [];
      size = 0;
    }
    current.push(line);
    size += add;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "user-agent": "snu-food-discord-worker/1.0",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}: ${await response.text()}`);
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function hexToBytes(hex) {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error("Invalid hex string");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function matchAll(text, regex) {
  return Array.from(text.matchAll(regex), (match) => match);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
