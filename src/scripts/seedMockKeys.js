import { assertCoreEnv } from "../lib/env.js";
import { ensureDefaultClients } from "../services/clientService.js";
import { seedMockKeys } from "../services/keySeederService.js";

async function main() {
  assertCoreEnv();
  await ensureDefaultClients();
  const result = await seedMockKeys();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
