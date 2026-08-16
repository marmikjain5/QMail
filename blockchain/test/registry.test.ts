import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { QuMailAttachmentRegistry } from '../typechain-types';

describe('QuMailAttachmentRegistry', function () {
  let registry: QuMailAttachmentRegistry;
  let deployer: ReturnType<typeof ethers.getSigner> extends Promise<infer T> ? T : never;

  // Helpers
  function makeAttachmentId(str: string): string {
    const bytes = ethers.toUtf8Bytes(str);
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));
    return ethers.hexlify(padded);
  }

  function makeSha256(str: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(str));
  }

  beforeEach(async () => {
    [deployer] = await ethers.getSigners() as any;
    const Factory = await ethers.getContractFactory('QuMailAttachmentRegistry');
    registry = (await Factory.deploy()) as QuMailAttachmentRegistry;
    await registry.waitForDeployment();
  });

  // ---------------------------------------------------------------------------
  // Registration tests
  // ---------------------------------------------------------------------------

  it('should register an attachment and emit AttachmentRegistered event', async () => {
    const attachmentId = makeAttachmentId('att_test-001');
    const ipfsCID = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
    const contentSha256 = makeSha256('e3b0c44298fc1c149afbf4c8996fb924');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_test-001'));
    const securityLevel = 2;

    await expect(
      registry.registerAttachment(
        attachmentId,
        ipfsCID,
        contentSha256,
        keyIdHash,
        securityLevel,
      ),
    )
      .to.emit(registry, 'AttachmentRegistered')
      .withArgs(
        attachmentId,
        ipfsCID,
        contentSha256,
        securityLevel,
        (timestamp: bigint) => timestamp > 0n,
        deployer.address,
      );

    expect(await registry.totalRegistered()).to.equal(1n);
  });

  it('should revert when registering the same attachment ID twice', async () => {
    const attachmentId = makeAttachmentId('att_duplicate');
    const ipfsCID = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
    const contentSha256 = makeSha256('abc123');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_dup'));
    const securityLevel = 2;

    await registry.registerAttachment(attachmentId, ipfsCID, contentSha256, keyIdHash, securityLevel);

    await expect(
      registry.registerAttachment(attachmentId, ipfsCID, contentSha256, keyIdHash, securityLevel),
    ).to.be.revertedWithCustomError(registry, 'AlreadyRegistered').withArgs(attachmentId);
  });

  it('should revert when IPFS CID is empty', async () => {
    const attachmentId = makeAttachmentId('att_empty-cid');
    const contentSha256 = makeSha256('abc123');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_test'));

    await expect(
      registry.registerAttachment(attachmentId, '', contentSha256, keyIdHash, 2),
    ).to.be.revertedWithCustomError(registry, 'InvalidIPFSCID');
  });

  it('should revert with InvalidSecurityLevel for level other than 2 or 3', async () => {
    const attachmentId = makeAttachmentId('att_bad-level');
    const ipfsCID = 'QmTest';
    const contentSha256 = makeSha256('abc123');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_test'));

    await expect(
      registry.registerAttachment(attachmentId, ipfsCID, contentSha256, keyIdHash, 1),
    ).to.be.revertedWithCustomError(registry, 'InvalidSecurityLevel').withArgs(1);
  });

  // ---------------------------------------------------------------------------
  // Verification tests
  // ---------------------------------------------------------------------------

  it('should return isValid=true when hash matches', async () => {
    const attachmentId = makeAttachmentId('att_verify-ok');
    const ipfsCID = 'QmVerifyOK';
    const contentSha256 = makeSha256('deadbeef1234567890abcdef');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_v1'));

    await registry.registerAttachment(attachmentId, ipfsCID, contentSha256, keyIdHash, 3);

    const [isValid, returnedCID, timestamp] = await registry.verifyAttachment(
      attachmentId,
      contentSha256,
    );

    expect(isValid).to.be.true;
    expect(returnedCID).to.equal(ipfsCID);
    expect(timestamp).to.be.greaterThan(0n);
  });

  it('should return isValid=false when hash is tampered (bit flip)', async () => {
    const attachmentId = makeAttachmentId('att_tamper');
    const originalHash = makeSha256('originalcontenthashabc123');
    const tamperedHash = makeSha256('tamperedcontenthashabc124'); // Different hash
    const ipfsCID = 'QmTamperTest';
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_t1'));

    await registry.registerAttachment(attachmentId, ipfsCID, originalHash, keyIdHash, 2);

    const [isValid] = await registry.verifyAttachment(attachmentId, tamperedHash);
    expect(isValid).to.be.false;
  });

  it('should return isValid=false for non-existent attachment ID', async () => {
    const nonExistentId = makeAttachmentId('att_nonexistent-xyz');
    const [isValid, cid, timestamp] = await registry.verifyAttachment(
      nonExistentId,
      makeSha256('anyhash'),
    );

    expect(isValid).to.be.false;
    expect(cid).to.equal('');
    expect(timestamp).to.equal(0n);
  });

  // ---------------------------------------------------------------------------
  // getRecord tests
  // ---------------------------------------------------------------------------

  it('should return the full record via getRecord()', async () => {
    const attachmentId = makeAttachmentId('att_getrecord');
    const ipfsCID = 'QmGetRecord123';
    const contentSha256 = makeSha256('fullrecordtestabcdef1234');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_gr1'));

    await registry.registerAttachment(attachmentId, ipfsCID, contentSha256, keyIdHash, 3);

    const record = await registry.getRecord(attachmentId);

    expect(record.ipfsCID).to.equal(ipfsCID);
    expect(record.contentSha256).to.equal(contentSha256);
    expect(record.keyIdHash).to.equal(keyIdHash);
    expect(record.securityLevel).to.equal(3);
    expect(record.registeredBy).to.equal(deployer.address);
    expect(record.timestamp).to.be.greaterThan(0n);
  });

  it('should return empty record for unregistered attachment', async () => {
    const nonExistentId = makeAttachmentId('att_empty');
    const record = await registry.getRecord(nonExistentId);
    expect(record.timestamp).to.equal(0n);
    expect(record.ipfsCID).to.equal('');
  });

  // ---------------------------------------------------------------------------
  // Gas cost test
  // ---------------------------------------------------------------------------

  it('should consume less than 200,000 gas for registration', async () => {
    const attachmentId = makeAttachmentId('att_gas-test');
    const ipfsCID = 'QmGasTestIPFSCID';
    const contentSha256 = makeSha256('gastesthash1234567890ab');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_gas'));

    const tx = await registry.registerAttachment(
      attachmentId,
      ipfsCID,
      contentSha256,
      keyIdHash,
      2,
    );
    const receipt = await tx.wait();

    console.log(`     Gas used: ${receipt?.gasUsed.toString()}`);
    expect(receipt?.gasUsed).to.be.lessThan(200_000n);
  });

  // ---------------------------------------------------------------------------
  // Tamper scenario (end-to-end integrity demonstration)
  // ---------------------------------------------------------------------------

  it('Demo: tamper scenario — register H1, verify with H2 returns false', async () => {
    const attachmentId = makeAttachmentId('att_demo-tamper');
    const originalCID = 'QmOriginalEncryptedFile';
    const originalHash = makeSha256('sha256oforiginalencryptedfile00');
    const tamperedHash = makeSha256('sha256oftamperedencryptedfile00');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_demo'));

    // Sender registers original hash
    await registry.registerAttachment(
      attachmentId,
      originalCID,
      originalHash,
      keyIdHash,
      2,
    );

    // Attacker tampers the file on IPFS and the recipient computes a different hash
    const [isValid] = await registry.verifyAttachment(attachmentId, tamperedHash);
    expect(isValid).to.be.false;

    // Recipient verifies with the original hash — passes
    const [isValidOriginal] = await registry.verifyAttachment(attachmentId, originalHash);
    expect(isValidOriginal).to.be.true;
  });

  it('should correctly track isRegistered()', async () => {
    const attachmentId = makeAttachmentId('att_is-registered');
    const ipfsCID = 'QmIsRegistered';
    const contentSha256 = makeSha256('isregisteredtest12345678');
    const keyIdHash = ethers.keccak256(ethers.toUtf8Bytes('qkey_ir'));

    expect(await registry.isRegistered(attachmentId)).to.be.false;

    await registry.registerAttachment(attachmentId, ipfsCID, contentSha256, keyIdHash, 2);

    expect(await registry.isRegistered(attachmentId)).to.be.true;
  });
});
