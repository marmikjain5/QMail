import { assertCoreEnv } from "../lib/env.js";

try {
  assertCoreEnv();
  console.log("Core environment looks valid.");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
