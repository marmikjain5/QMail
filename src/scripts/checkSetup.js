import { assertBrowserAuthEnv, assertCoreEnv } from "../lib/env.js";

try {
  assertCoreEnv();
  assertBrowserAuthEnv();
  console.log("Core environment looks valid.");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
