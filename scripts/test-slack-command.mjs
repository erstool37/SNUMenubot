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
        &lt;Buffet&gt; 6,500원<br>
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

globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://example.test/menu");
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};

const response = await worker.fetch(
  slackRequest("dinner"),
  {
    SLACK_SIGNING_SECRET: signingSecret,
    SNU_FOOD_BOT_MENU_URL: "https://example.test/menu",
  },
  { waitUntil: (promise) => promise },
);

assert.equal(response.status, 200);
assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");

const payload = await response.json();
assert.equal(payload.response_type, "ephemeral");
assert.equal(payload.text.includes("*302동식당*"), true);
assert.equal(payload.text.includes("훈제오리볶음밥&미니핫도그"), true);
assert.equal(payload.text.includes("*301동식당*"), false);
assert.equal(payload.text.includes("301동 저녁 메뉴"), false);
assert.equal(payload.text.includes("Source"), false);
assert.equal(payload.text.includes("Buffet"), false);
assert.equal(/\d{1,3}(?:,\d{3})*원/.test(payload.text), false);

const timeResponse = await worker.fetch(
  slackRequest("time"),
  {
    SLACK_SIGNING_SECRET: signingSecret,
    SNU_FOOD_BOT_MENU_URL: "https://example.test/menu",
  },
  { waitUntil: (promise) => promise },
);

assert.equal(timeResponse.status, 200);
const timePayload = await timeResponse.json();
assert.equal(timePayload.response_type, "ephemeral");
assert.equal(timePayload.text.includes("*302동식당*"), true);
assert.equal(timePayload.text.includes("• 점심 11:30~13:30"), true);
assert.equal(timePayload.text.includes("• 저녁 17:00~18:30"), true);

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
    response_url: "https://hooks.slack.com/commands/T123/456/abc",
    trigger_id: "123.456.abc",
  }).toString();
}
