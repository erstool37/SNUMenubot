import assert from "node:assert/strict";

import {
  formatMenu as formatReadableMenu,
  formatTime as formatReadableTime,
  preferredRestaurantsForCommand as readablePreferredRestaurantsForCommand,
} from "../src/worker.js";
import {
  formatMenu as formatCompactMenu,
  formatTime as formatCompactTime,
  preferredRestaurantsForCommand as compactPreferredRestaurantsForCommand,
} from "../src/worker.compact.js";

const friday = new Date("2026-06-12T03:00:00.000Z");

const rows = [
  {
    restaurant: "302동식당",
    breakfast: "",
    lunch: [
      "<뷔페> 6,500원",
      "유니짜장면&밥",
      "해물짬뽕밥",
      "과일탕수육",
      "물만두",
      "단무지",
      "그린샐러드&오늘의차",
      "※ 운영시간 : 11:30~13:30",
      "※ 혼잡시간 : 11:50~12:20",
    ].join("\n"),
    dinner: [
      "<Buffet> 6,500원",
      "훈제오리볶음밥&미니핫도그",
      "찹스테이크",
      "참깨소스냉두부",
      "열무고추장무침",
      "어묵국",
      "그린샐러드&오늘의차",
      "※ 운영시간 : 17:00~18:30",
    ].join("\n"),
  },
  {
    restaurant: "301동1층 교직원전용식당",
    breakfast: "",
    lunch: [
      "<301동1층 교직원전용식당>",
      "제주식고기국수&오징어파전&야채스틱: 9,000원",
      "※ 운영시간 : 11:30~13:30",
    ].join("\n"),
    dinner: [
      "<교직원식당>",
      "교직원 저녁 메뉴: 9,000원",
      "※ 운영시간 : 17:00~18:30",
    ].join("\n"),
  },
  {
    restaurant: "301동식당",
    breakfast: "",
    lunch: [
      "<식사>",
      "하이라이스&오믈렛&감자크로켓 : 6,500원",
      "(뚝)설렁탕&메추리알장조림: 6,500원",
      "※ 운영시간 : 11:00~14:00",
    ].join("\n"),
    dinner: [
      "<식사>",
      "301동 저녁 메뉴 : 6,500원",
      "※ 운영시간 : 17:00~19:00",
    ].join("\n"),
  },
];

const expected = [
  "2026-06-12 (금) 점심",
  "",
  "**302동식당**",
  "• 유니짜장면&밥",
  "• 해물짬뽕밥",
  "• 과일탕수육",
  "• 물만두",
  "• 단무지",
  "• 그린샐러드&오늘의차",
  "",
  "**301동1층 교직원전용식당**",
  "• 제주식고기국수&오징어파전&야채스틱",
  "",
  "**301동식당**",
  "• 하이라이스&오믈렛&감자크로켓",
  "• (뚝)설렁탕&메추리알장조림",
].join("\n");

const readableOutput = formatReadableMenu(rows, {
  meals: ["lunch"],
  preferred: "302동,교직원식당,301동",
  now: friday,
});

const compactOutput = formatCompactMenu(
  rows,
  ["lunch"],
  "302동,교직원식당,301동",
  friday,
);

assert.equal(readableOutput, expected);
assert.equal(compactOutput, expected);

const expectedDinner = [
  "2026-06-12 (금) 저녁",
  "",
  "**302동식당**",
  "• 훈제오리볶음밥&미니핫도그",
  "• 찹스테이크",
  "• 참깨소스냉두부",
  "• 열무고추장무침",
  "• 어묵국",
  "• 그린샐러드&오늘의차",
].join("\n");

const readableDinnerPreferred = readablePreferredRestaurantsForCommand({
  data: { name: "dinner" },
});
const compactDinnerPreferred = compactPreferredRestaurantsForCommand({
  data: { name: "dinner" },
});

assert.equal(readableDinnerPreferred, "302동식당");
assert.equal(compactDinnerPreferred, "302동식당");
assert.equal(
  formatReadableMenu(rows, {
    meals: ["dinner"],
    preferred: readableDinnerPreferred,
    now: friday,
  }),
  expectedDinner,
);
assert.equal(
  formatCompactMenu(rows, ["dinner"], compactDinnerPreferred, friday),
  expectedDinner,
);

const expectedTime = [
  "운영시간",
  "",
  "**302동식당**",
  "• 점심 11:30~13:30",
  "• 저녁 17:00~18:30",
  "",
  "**301동1층 교직원전용식당**",
  "• 점심 11:30~13:30",
  "• 저녁 17:00~18:30",
  "",
  "**301동식당**",
  "• 점심 11:00~14:00",
  "• 저녁 17:00~19:00",
].join("\n");

const readableTime = formatReadableTime(rows, {
  preferred: "302동,교직원식당,301동",
});
const compactTime = formatCompactTime(rows, "302동,교직원식당,301동");

assert.equal(readableTime, expectedTime);
assert.equal(compactTime, expectedTime);

for (const output of [readableOutput, compactOutput, readableTime, compactTime]) {
  assert.equal(output.includes("Source"), false);
  assert.equal(output.includes("SNU food menu"), false);
  assert.equal(output.includes("뷔페"), false);
  assert.equal(output.includes("Buffet"), false);
  assert.equal(output.includes("식사"), false);
  assert.equal(output.includes("혼잡시간"), false);
  assert.equal(output.includes("9,000원"), false);
  assert.equal(output.includes("6,500원"), false);
  assert.equal(/\d{1,3}(?:,\d{3})*원/.test(output), false);
}

console.log("format tests passed");
