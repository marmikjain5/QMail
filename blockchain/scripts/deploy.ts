import { ethers } from 'hardhat';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

async function main() {
  console.log('\n🔗 Deploying QuMailAttachmentRegistry...\n');

  const [deployer] = await ethers.getSigners();
  console.log(`   Deployer:    ${deployer.address}`);
  console.log(`   Balance:     ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH\n`);

  const QuMailRegistry = await ethers.getContractFactory('QuMailAttachmentRegistry');
  const registry = await QuMailRegistry.deploy();
  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();
  const receipt = await deployTx?.wait();

  console.log(`✅ QuMailAttachmentRegistry deployed!`);
  console.log(`   Contract Address: ${contractAddress}`);
  console.log(`   Transaction Hash: ${deployTx?.hash ?? 'N/A'}`);
  console.log(`   Block Number:     ${receipt?.blockNumber ?? 'N/A'}`);
  console.log(`   Gas Used:         ${receipt?.gasUsed?.toString() ?? 'N/A'}\n`);

  // Write contract address to backend config directory
  const backendConfigDir = join(__dirname, '../../backend/src/modules/blockchain');
  const backendConfigPath = join(backendConfigDir, 'contract-address.json');

  if (!existsSync(backendConfigDir)) {
    mkdirSync(backendConfigDir, { recursive: true });
  }

  const deployInfo = {
    contractAddress,
    network: 'localhost',
    chainId: 31337,
    deployedAt: new Date().toISOString(),
    deployerAddress: deployer.address,
    transactionHash: deployTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
  };

  writeFileSync(backendConfigPath, JSON.stringify(deployInfo, null, 2));
  console.log(`📝 Contract address written to: ${backendConfigPath}`);

  // Print .env instructions
  console.log('\n🔑 Add these to your backend/.env file:');
  console.log(`   REGISTRY_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`   REGISTRY_DEPLOYER_PRIVATE_KEY=<use one of the private keys printed when you ran "npx hardhat node">\n`);

  // Verify the contract is responsive
  const totalRegistered = await registry.totalRegistered();
  console.log(`🔍 Verification: totalRegistered = ${totalRegistered} (should be 0 on fresh deploy)\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  });
