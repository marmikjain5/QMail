// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

contract QuMailAttachmentRegistry {

    struct AttachmentRecord {
        string ipfsCid;
        bytes32 contentHash;
        bytes32 keyIdHash;
        uint8 securityLevel;
        uint256 timestamp;
        bool exists;
    }

    mapping(bytes32 => AttachmentRecord) private attachments;

    event AttachmentRegistered(
        bytes32 indexed attachmentId,
        string ipfsCid,
        bytes32 contentHash,
        bytes32 keyIdHash,
        uint8 securityLevel,
        uint256 timestamp
    );

    function registerAttachment(
        bytes32 attachmentId,
        string calldata ipfsCid,
        bytes32 contentHash,
        bytes32 keyIdHash,
        uint8 securityLevel
    ) external {

        require(
            !attachments[attachmentId].exists,
            "Attachment already registered"
        );

        attachments[attachmentId] = AttachmentRecord({
            ipfsCid: ipfsCid,
            contentHash: contentHash,
            keyIdHash: keyIdHash,
            securityLevel: securityLevel,
            timestamp: block.timestamp,
            exists: true
        });

        emit AttachmentRegistered(
            attachmentId,
            ipfsCid,
            contentHash,
            keyIdHash,
            securityLevel,
            block.timestamp
        );
    }

    function verifyAttachment(
        bytes32 attachmentId,
        bytes32 contentHash
    )
        external
        view
        returns (
            bool valid,
            uint256 timestamp,
            uint8 securityLevel,
            string memory ipfsCid,
            bytes32 keyIdHash
        )
    {
        AttachmentRecord memory record = attachments[attachmentId];

        if (!record.exists) {
            return (false, 0, 0, "", bytes32(0));
        }

        bool hashMatches = (record.contentHash == contentHash);

        return (
            hashMatches,
            record.timestamp,
            record.securityLevel,
            record.ipfsCid,
            record.keyIdHash
        );
    }

    function getAttachment(bytes32 attachmentId)
        external
        view
        returns (
            bool exists,
            bytes32 contentHash,
            bytes32 keyIdHash,
            uint8 securityLevel,
            uint256 timestamp,
            string memory ipfsCid
        )
    {
        AttachmentRecord memory record = attachments[attachmentId];
        return (
            record.exists,
            record.contentHash,
            record.keyIdHash,
            record.securityLevel,
            record.timestamp,
            record.ipfsCid
        );
    }
}