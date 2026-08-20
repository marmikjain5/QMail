import { listKeyPool } from "../src/services/kmeService.js";

async function test() {
  try {
    const res = await listKeyPool();
    console.log("listKeyPool result:", JSON.stringify(res.summary, null, 2));
    console.log("Total keys returned:", res.keys?.length);
  } catch (err) {
    console.error("Error testing listKeyPool:", err);
  }
}

test();
