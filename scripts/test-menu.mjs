import { fetchMenu, formatMenu } from "../src/worker.compact.js";

const env = {
  SNU_FOOD_BOT_MENU_URL: process.env.SNU_FOOD_BOT_MENU_URL,
  SNU_FOOD_BOT_RESTAURANTS:
    process.env.SNU_FOOD_BOT_RESTAURANTS || "302동,301동,교직원식당",
};

const rows = await fetchMenu(env);
console.log(`parsed_rows=${rows.length}`);
console.log(formatMenu(rows, ["lunch"], env.SNU_FOOD_BOT_RESTAURANTS));
