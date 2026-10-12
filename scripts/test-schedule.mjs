import assert from "node:assert/strict";

import {
  lunchText as readableLunchText,
  fetchMenuRetry as readableFetchMenuRetry,
  parseMenuHtml as readableParse,
} from "../src/worker.js";
import {
  lunchText as compactLunchText,
  fetchMenuRetry as compactFetchMenuRetry,
  parseMenu as compactParse,
} from "../src/worker.compact.js";

const variants = [
  ["readable", readableLunchText],
  ["compact", compactLunchText],
];

const preferred = "302동,301동,교직원식당";

// 1) 점심 메뉴가 있는 평일 → null 아님, 메뉴 내용 포함, Slack mrkdwn(*bold*)로 변환됨
const withLunch = [
  {
    restaurant: "302동식당 (880-1939)",
    breakfast: "",
    lunch: ["유니짜장면&밥", "해물짬뽕밥", "※ 운영시간 : 11:30~13:30"].join("\n"),
    dinner: "",
  },
];
for (const [label, lunchText] of variants) {
  const out = lunchText(withLunch, preferred);
  assert.ok(out, `${label}: 점심 있는 날은 null이 아니어야 함`);
  assert.ok(out.includes("유니짜장면&밥"), `${label}: 메뉴 항목 포함`);
  assert.ok(out.includes("점심"), `${label}: '점심' 라벨 포함`);
  assert.equal(out.includes("**"), false, `${label}: **bold**가 *bold*로 변환됨`);
}

// 2) 공휴일/주말 등 메뉴가 완전히 빈 날 → null (게시 스킵)
const emptyDay = [
  { restaurant: "302동식당", breakfast: "", lunch: "", dinner: "" },
  { restaurant: "301동식당", breakfast: "", lunch: "", dinner: "" },
];
for (const [label, lunchText] of variants) {
  assert.equal(lunchText(emptyDay, preferred), null, `${label}: 빈 메뉴는 null(스킵)`);
}

// 3) 파싱 실패 등 rows 자체가 비어 있는 경우 → null
for (const [label, lunchText] of variants) {
  assert.equal(lunchText([], preferred), null, `${label}: rows 없음은 null(스킵)`);
}

// 4) 대상(preferred) 식당에는 점심이 없고 다른 식당만 있는 경우 → null
const onlyOtherRestaurant = [
  { restaurant: "220동식당", breakfast: "", lunch: "김치찌개", dinner: "" },
];
for (const [label, lunchText] of variants) {
  assert.equal(
    lunchText(onlyOtherRestaurant, preferred),
    null,
    `${label}: 대상 식당에 점심 없으면 null(스킵)`,
  );
}

// 5) 재시도: SNUCO가 한두 번 실패해도 하루치 공지를 잃지 않아야 함
const retryVariants = [
  ["readable", readableFetchMenuRetry],
  ["compact", compactFetchMenuRetry],
];
const noSleep = () => Promise.resolve();
const originalWarn = console.warn;
console.warn = () => {};
try {
  for (const [label, fetchMenuRetry] of retryVariants) {
    let calls = 0;
    const okFirst = async () => {
      calls += 1;
      return withLunch;
    };
    assert.equal(await fetchMenuRetry({}, 3, noSleep, okFirst), withLunch, `${label}: 첫 시도 성공`);
    assert.equal(calls, 1, `${label}: 성공하면 재시도하지 않음`);

    calls = 0;
    const okThird = async () => {
      calls += 1;
      if (calls < 3) throw new Error("SNUCO returned HTTP 503");
      return withLunch;
    };
    assert.equal(await fetchMenuRetry({}, 3, noSleep, okThird), withLunch, `${label}: 3번째 시도 성공`);
    assert.equal(calls, 3, `${label}: 실패하면 재시도함`);

    calls = 0;
    const alwaysFails = async () => {
      calls += 1;
      throw new Error(`boom ${calls}`);
    };
    await assert.rejects(
      () => fetchMenuRetry({}, 3, noSleep, alwaysFails),
      /boom 3/,
      `${label}: 전부 실패하면 마지막 오류를 던짐`,
    );
    assert.equal(calls, 3, `${label}: 정확히 tries 횟수만 시도함`);
  }
} finally {
  console.warn = originalWarn;
}

// 6) 마크업 변경/차단(표 자체가 없음)은 휴일로 위장되면 안 됨 → 반드시 throw
const parsers = [
  ["readable", readableParse],
  ["compact", compactParse],
];
for (const [label, parse] of parsers) {
  assert.throws(
    () => parse("<html><body>차단되었습니다</body></html>"),
    /celeb-mealtable/,
    `${label}: 표가 없으면 침묵이 아니라 오류여야 함`,
  );
}

// 7) 반대로 진짜 휴일(표는 있고 칸이 빈 날)은 조용해야 함 — 6)의 수정이 이걸 깨면 안 됨
const holidayHtml = `<div id="celeb-mealtable"><table><tbody>
  <tr><th class="title">식당</th><td class="breakfast"></td><td class="lunch"></td><td class="dinner"></td></tr>
  <tr><td class="title">302동식당</td><td class="breakfast"></td><td class="lunch"></td><td class="dinner"></td></tr>
  <tr><td class="title">301동식당</td><td class="breakfast"></td><td class="lunch"></td><td class="dinner"></td></tr>
</tbody></table></div>`;
for (const [label, parse] of parsers) {
  const holidayRows = parse(holidayHtml);
  assert.ok(holidayRows.length > 0, `${label}: 휴일에도 식당 행은 파싱됨`);
  const lunchText = label === "readable" ? readableLunchText : compactLunchText;
  assert.equal(lunchText(holidayRows, preferred), null, `${label}: 휴일은 여전히 null(침묵)`);
}

console.log("schedule tests passed");
