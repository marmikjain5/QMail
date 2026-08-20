import { simulateBb84KeyPool } from "../src/services/keySeederService.js";
import { getSupabase } from "../src/lib/supabase.js";
import dotenv from "dotenv";

dotenv.config();

async function runTests() {
  console.log("==========================================");
  console.log("TEST 1: Running NORMAL BB84 Simulation...");
  console.log("==========================================");
  
  const normalResult = await simulateBb84KeyPool({ force: true, mode: "NORMAL" });
  console.log("Normal Result Status:", normalResult.status);
  console.log("Approved:", normalResult.qkdApproved);
  console.log("Reason:", normalResult.reason);
  console.log("Telemetry:", normalResult.telemetry);
  console.log("ML Result:", normalResult.mlResult);

  const supabase = getSupabase();
  let { count: countAfterNormal } = await supabase.from("kme_keys").select("id", { count: "exact", head: true });
  console.log("Key count in DB after NORMAL simulation:", countAfterNormal);

  console.log("\n==========================================");
  console.log("TEST 2: Running ATTACKER BB84 Simulation...");
  console.log("==========================================");

  const attackerResult = await simulateBb84KeyPool({ force: false, mode: "ATTACKER" });
  console.log("Attacker Result Status:", attackerResult.status);
  console.log("Approved:", attackerResult.qkdApproved);
  console.log("Reason:", attackerResult.reason);
  console.log("Telemetry:", attackerResult.telemetry);
  console.log("ML Result:", attackerResult.mlResult);

  let { count: countAfterAttacker } = await supabase.from("kme_keys").select("id", { count: "exact", head: true });
  console.log("Key count in DB after ATTACKER simulation:", countAfterAttacker);
  
  if (countAfterAttacker === countAfterNormal) {
    console.log("\n✅ VERIFICATION SUCCESS: Keys were NOT added during aborted attacker session!");
  } else {
    console.error("\n❌ VERIFICATION FAILURE: Keys were incorrectly inserted into DB during aborted session.");
  }
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
