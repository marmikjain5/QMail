import dotenv from "dotenv";
dotenv.config();

import { isPinataConfigured, uploadToPinata } from "../src/services/ipfsService.js";

async function test() {
  console.log("Checking Pinata configuration...");
  console.log("isPinataConfigured():", isPinataConfigured());
  console.log("PINATA_JWT length:", (process.env.PINATA_JWT || "").length);
  console.log("PINATA_API_KEY length:", (process.env.PINATA_API_KEY || "").length);

  const testBuffer = Buffer.from("Hello QuMail Pinata IPFS Test " + Date.now());
  console.log("Testing upload to Pinata...");
  const res = await uploadToPinata({
    filename: `test-qumail-${Date.now()}.txt`,
    buffer: testBuffer
  });

  console.log("Upload result:", res);
}

test().catch(err => console.error("Test error:", err));
