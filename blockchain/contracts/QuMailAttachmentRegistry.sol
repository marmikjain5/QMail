// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title QuMailAttachmentRegistry
 * @author QuMail
 * @notice Immutable on-chain registry for QuMail encrypted attachment provenance.
 *
 * @dev This contract stores cryptographic fingerprints and IPFS Content Identifiers
 *      for attachments encrypted and sent via the QuMail platform. It serves as an
 *      integrity anchor: recipients can verify that the downloaded IPFS content
 *      matches what was registered at send time.
 *
 *      IMPORTANT: This contract does NOT store:
 *        - Plaintext file contents
 *        - Encryption keys or key material
 *        - Email bodies
 *        - Personally identifiable information beyond the sender address
 *
 *      The keyIdHash field stores keccak256(keyId) — the key ID is hashed
 *      before storage so it cannot be used to reconstruct the original identifier
 *      from on-chain data without prior knowledge.
 *
 *      Access control:
 *        The prototype uses open registration (any address can register).
 *        In production, this should be restricted to authorized QuMail relay
 *        addresses using a role-based access control pattern (e.g., OpenZeppelin
 *        AccessControl) or a mapping of allowed registrar addresses.
 */
contract QuMailAttachmentRegistry {

    // =========================================================================
    // Structs
    // =========================================================================

    struct AttachmentRecord {
        /// @notice IPFS Content Identifier of the encrypted file
        string ipfsCID;
        /// @notice SHA-256 hash of the encrypted file content (as bytes32)
        bytes32 contentSha256;
        /// @notice keccak256 hash of the QKM key ID used for encryption
        bytes32 keyIdHash;
        /// @notice Security level: 2 = Quantum-AES, 3 = Quantum-OTP
        uint8 securityLevel;
        /// @notice Unix timestamp of registration
        uint256 timestamp;
        /// @notice Ethereum address that registered this record
        address registeredBy;
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice Mapping from attachment ID (bytes32) to its record
    mapping(bytes32 => AttachmentRecord) private _registry;

    /// @notice Total number of registered attachments
    uint256 public totalRegistered;

    // =========================================================================
    // Events
    // =========================================================================

    /**
     * @notice Emitted when a new attachment record is registered.
     * @param attachmentId  Unique identifier for this attachment (bytes32)
     * @param ipfsCID       IPFS Content Identifier of the encrypted blob
     * @param contentSha256 SHA-256 hash of the encrypted content
     * @param securityLevel 2 = Quantum-AES, 3 = Quantum-OTP
     * @param timestamp     Block timestamp of registration
     * @param registeredBy  Address of the caller who registered this record
     */
    event AttachmentRegistered(
        bytes32 indexed attachmentId,
        string ipfsCID,
        bytes32 contentSha256,
        uint8 securityLevel,
        uint256 timestamp,
        address indexed registeredBy
    );

    // =========================================================================
    // Errors
    // =========================================================================

    /// @notice Thrown when an attachment with this ID is already registered
    error AlreadyRegistered(bytes32 attachmentId);

    /// @notice Thrown when an empty IPFS CID is provided
    error InvalidIPFSCID();

    /// @notice Thrown when an invalid security level is provided
    error InvalidSecurityLevel(uint8 securityLevel);

    // =========================================================================
    // Write Functions
    // =========================================================================

    /**
     * @notice Register an encrypted attachment's cryptographic fingerprint.
     *
     * @dev Each attachmentId can only be registered once. This ensures the
     *      immutability of the integrity record — once registered, the CID
     *      and content hash are permanently anchored on-chain.
     *
     *      NOTE (Prototype): Open to any caller. In production, add:
     *        require(authorizedRegistrars[msg.sender], "Not authorized");
     *
     * @param _attachmentId  Unique attachment ID (bytes32, derived from UUID)
     * @param _ipfsCID       IPFS CID of the encrypted attachment blob
     * @param _contentSha256 SHA-256 hash of the encrypted content (bytes32)
     * @param _keyIdHash     keccak256 hash of the QKM key ID
     * @param _securityLevel Security level (2 = Quantum-AES, 3 = Quantum-OTP)
     */
    function registerAttachment(
        bytes32 _attachmentId,
        string calldata _ipfsCID,
        bytes32 _contentSha256,
        bytes32 _keyIdHash,
        uint8 _securityLevel
    ) external {
        if (_registry[_attachmentId].timestamp != 0) {
            revert AlreadyRegistered(_attachmentId);
        }
        if (bytes(_ipfsCID).length == 0) {
            revert InvalidIPFSCID();
        }
        if (_securityLevel != 2 && _securityLevel != 3) {
            revert InvalidSecurityLevel(_securityLevel);
        }

        _registry[_attachmentId] = AttachmentRecord({
            ipfsCID: _ipfsCID,
            contentSha256: _contentSha256,
            keyIdHash: _keyIdHash,
            securityLevel: _securityLevel,
            timestamp: block.timestamp,
            registeredBy: msg.sender
        });

        totalRegistered++;

        emit AttachmentRegistered(
            _attachmentId,
            _ipfsCID,
            _contentSha256,
            _securityLevel,
            block.timestamp,
            msg.sender
        );
    }

    // =========================================================================
    // Read Functions
    // =========================================================================

    /**
     * @notice Verify that a downloaded attachment's SHA-256 hash matches the registered record.
     *
     * @param _attachmentId  The attachment ID to look up
     * @param _contentSha256 The SHA-256 hash to verify against the stored record
     *
     * @return isValid    True if hashes match and the record exists
     * @return ipfsCID    The registered IPFS CID (for cross-validation)
     * @return timestamp  Registration timestamp (0 if not found)
     */
    function verifyAttachment(
        bytes32 _attachmentId,
        bytes32 _contentSha256
    ) external view returns (
        bool isValid,
        string memory ipfsCID,
        uint256 timestamp
    ) {
        AttachmentRecord storage record = _registry[_attachmentId];

        if (record.timestamp == 0) {
            return (false, "", 0);
        }

        return (
            record.contentSha256 == _contentSha256,
            record.ipfsCID,
            record.timestamp
        );
    }

    /**
     * @notice Retrieve the full attachment record.
     *
     * @param _attachmentId The attachment ID to retrieve
     * @return record The full AttachmentRecord struct (timestamp == 0 if not found)
     */
    function getRecord(
        bytes32 _attachmentId
    ) external view returns (AttachmentRecord memory record) {
        return _registry[_attachmentId];
    }

    /**
     * @notice Check whether a given attachment ID has been registered.
     *
     * @param _attachmentId The attachment ID to check
     * @return True if the record exists
     */
    function isRegistered(bytes32 _attachmentId) external view returns (bool) {
        return _registry[_attachmentId].timestamp != 0;
    }
}
