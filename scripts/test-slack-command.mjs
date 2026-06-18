import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import worker from "../src/worker.compact.js";

const html = `
<div id="celeb-mealtable">
  <tbody>
    <tr>
      <td class="title">302동식당</td>
      <td class="breakfast"></td>
      <td class="lunch">
        &lt;뷔페&gt; 6,500원<br>
        유니짜장면&amp;밥<br>
        ※ 운영시간 : 11:30~13:30
      </td>
      <td class="dinner">
        &lt; Buffet &gt; 6,500won<br>
        훈제오리볶음밥&amp;미니핫도그<br>
        찹스테이크<br>
        ※ 운영시간 : 17:00~18:30
      </td>
    </tr>
    <tr>
      <td class="title">301동식당</td>
      <td class="breakfast"></td>
      <td class="lunch">
        &lt;식사&gt;<br>
        하이라이스&amp;오믈렛&amp;감자크로켓 : 6,500원<br>
        ※ 운영시간 : 11:00~14:00
      </td>
      <td class="dinner">
        &lt;식사&gt;<br>
        301동 저녁 메뉴 : 6,500원<br>
        ※ 운영시간 : 17:00~19:00
      </td>
    </tr>
  </tbody>
</div>`;

const signingSecret = "test-slack-signing-secret";
const responseUrl = "https://hooks.slack.com/commands/T123/456/abc";
const slackPosts = [];
let menuFetches = 0;

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href === "https://example.test/menu") {
    menuFetches += 1;
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (href === responseUrl) {
    slackPosts.push({
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return new Response("ok", { status: 200 });
  }

  throw new Error(`unexpected fetch URL: ${href}`);
};

const waitUntilPromises = [];
const response = await worker.fetch(
  slackRequest("dinner"),
  {
    SLACK_SIGNING_SECRET: signingSecret,
    SNU_FOOD_BOT_MENU_URL: "https://example.test/menu",
  },
  { waitUntil: (promise) => waitUntilPromises.push(promise) },
);

assert.equal(response.status, 200);
assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");

const payload = await response.json();
assert.equal(payload.response_type, "ephemeral");
assert.equal(payload.text, "메뉴를 불러오는 중입니다.");
assert.equal(menuFetches, 0);
assert.equal(waitUntilPromises.length, 1);

await Promise.all(waitUntilPromises);
assert.equal(menuFetches, 1);
assert.equal(slackPosts.length, 1);
assert.equal(slackPosts[0].method, "POST");
assert.equal(slackPosts[0].body.response_type, "in_channel");
assert.equal(slackPosts[0].body.text.includes("*302동식당*"), true);
assert.equal(slackPosts[0].body.text.includes("훈제오리볶음밥&미니핫도그"), true);
assert.equal(slackPosts[0].body.text.includes("*301동식당*"), false);
assert.equal(slackPosts[0].body.text.includes("301동 저녁 메뉴"), false);
assert.equal(slackPosts[0].body.text.includes("Source"), false);
assert.equal(slackPosts[0].body.text.includes("Buffet"), false);
assert.equal(/\d{1,3}(?:,\d{3})*원/.test(slackPosts[0].body.text), false);

waitUntilPromises.length = 0;
slackPosts.length = 0;
const timeResponse = await worker.fetch(
  slackRequest("time"),
  {
    SLACK_SIGNING_SECRET: signingSecret,
    SNU_FOOD_BOT_MENU_URL: "https://example.test/menu",
  },
  { waitUntil: (promise) => waitUntilPromises.push(promise) },
);

assert.equal(timeResponse.status, 200);
const timePayload = await timeResponse.json();
assert.equal(timePayload.response_type, "ephemeral");
assert.equal(timePayload.text, "메뉴를 불러오는 중입니다.");
assert.equal(waitUntilPromises.length, 1);
await Promise.all(waitUntilPromises);
assert.equal(slackPosts.length, 1);
assert.equal(slackPosts[0].body.response_type, "in_channel");
assert.equal(slackPosts[0].body.text.includes("*302동식당*"), true);
assert.equal(slackPosts[0].body.text.includes("• 점심 11:30~13:30"), true);
assert.equal(slackPosts[0].body.text.includes("• 저녁 17:00~18:30"), true);

waitUntilPromises.length = 0;
const badResponse = await worker.fetch(
  new Request("https://snu-food-discord-bot.example.workers.dev/slack/commands", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
      "x-slack-signature": "v0=bad",
    },
    body: slackBody("lunch"),
  }),
  {
    SLACK_SIGNING_SECRET: signingSecret,
    SNU_FOOD_BOT_MENU_URL: "https://example.test/menu",
  },
  { waitUntil: (promise) => promise },
);

assert.equal(badResponse.status, 401);
assert.equal(waitUntilPromises.length, 0);

console.log("slack command tests passed");

function slackRequest(text) {
  const body = slackBody(text);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;

  return new Request("https://snu-food-discord-bot.example.workers.dev/slack/commands", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
}

function slackBody(text) {
  return new URLSearchParams({
    token: "deprecated-token",
    team_id: "T123",
    team_domain: "company",
    channel_id: "C123",
    channel_name: "important-channel",
    user_id: "U123",
    user_name: "jongwon",
    command: "/snumenu",
    text,
    response_url: responseUrl,
    trigger_id: "123.456.abc",
  }).toString();
}
