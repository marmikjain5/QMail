const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const Registry = await ethers.getContractFactory("QuMailAttachmentRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("QuMailAttachmentRegistry deployed to:", address);

  const deploymentPath = path.join(__dirname, "..", "contracts", "deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify({ contractAddress: address }, null, 2));
  console.log("Updated deployment.json with address:", address);

  return { address };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });