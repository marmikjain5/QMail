# QuMail: Quantum-Assisted Secure Email Platform
## Product Requirements Document (PRD) & Technical Architecture Specification

---

### Document Information
- **Project Name:** QuMail
- **Document Version:** 1.0.0
- **Status:** Draft / Ready for Implementation
- **Classification:** Engineering & Product Architecture Specification
- **Target Audience:** Engineering Leads, Cryptography Engineers, Full-Stack Developers, Security Architects

---

## 1. Executive Summary

**QuMail** is an application-level, quantum-assisted secure email platform designed as an overlay on standard email ecosystems (Google Workspace/Gmail, Microsoft 365/Outlook). QuMail guarantees message confidentiality, tamper-evidence, and digital provenance without replacing underlying email protocols (SMTP/IMAP) or proprietary provider backends.

QuMail bridges classical and quantum communication paradigms by introducing a **Quantum Key Manager (QKM)** abstraction inspired by the **ETSI GS QKD 014** key-delivery standard. Physical Quantum Key Distribution (QKD) hardware is faithfully simulated using a cryptographically secure, statistical physical-layer simulation engine. The platform provides three user-selectable security tiers:
1. **Level 1 (Standard):** Standard pass-through email using native provider transport.
2. **Level 2 (Quantum-AES):** Authenticated bulk symmetric encryption (AES-256-GCM) seeded by fresh keys derived from quantum key pools.
3. **Level 3 (Quantum-OTP):** Information-theoretic secrecy via true One-Time Pad (OTP) bitwise XOR encryption with strict consumable key management.

Large attachments are offloaded via authenticated encryption to the **InterPlanetary File System (IPFS)** through Pinata, while immutable file integrity fingerprints are anchored to an **EVM-compatible Blockchain Registry**.

---

## 2. Problem Statement & Motivation

### 2.1 The Vulnerability of Modern Email Infrastructure
- **Store-and-Forward Interception:** Modern emails are vulnerable to server-side compromise, rogue cloud operators, subpoena exposure, and cascading database leaks.
- **Harvest Now, Decrypt Later (HNDL):** Adversaries routinely intercept and archive high-value encrypted communications, anticipating the arrival of cryptanalytically relevant quantum computers (CRQCs) capable of breaking RSA and ECC public-key cryptosystems via Shor's Algorithm.
- **Provider Lock-in & Key Custody:** S/MIME and PGP suffer from severe key lifecycle friction, revocation complexities, and lack of integration with next-generation key-generation sources.

### 2.2 The QuMail Solution
QuMail decouples transport from encryption:
- Transport remains on battle-tested infrastructure (Gmail/Microsoft 365).
- Secret keys are negotiated via an out-of-band QKM channel.
- Attachments are stored as encrypted blobs on decentralized IPFS, stripping metadata and byte payloads from mail provider databases.
- Blockchain anchoring guarantees zero-tampering and historical provenance.

---

## 3. Goals & Non-Goals

### 3.1 Product Goals
- **Full Operational Prototype:** Complete functional implementation spanning OAuth login, inbox synching, compose/send, reading, attachment handling, cryptographic operations, QKD key management, IPFS pinning, and blockchain verification.
- **Provider Agnostic:** Cleanly abstracted \EmailProvider\ interface supporting Gmail API and Microsoft Graph API out of the box.
- **Strict Cryptographic Rigor:** Proper implementation of AES-256-GCM and strict OTP rules (equal key-plaintext length, absolute zero key reuse, linear key consumption tracking).
- **Vendor-Neutral QKM Abstraction:** ETSI GS QKD 014 compatible REST API allowing seamless swap from simulation to production hardware QKD appliances.
- **Defensible Security Claims:** Accurate cryptographic representations adhering to theoretical boundaries.

### 3.2 Non-Goals
- **Replacing SMTP/IMAP/Exchange:** QuMail is an overlay client, not an MTA or mail server.
- **Physical QKD Hardware Emulation:** Physical quantum optics (single-photon detectors, beam splitters, fiber birefringence) are modeled statistically at the protocol layer, not via low-level hardware physics solvers.
- **Endpoint Compromise Mitigation:** QuMail protects data-in-flight and data-at-rest within third-party providers; it does not protect against active kernel-level rootkits or compromised display hardware on client devices.

---

## 4. Target Users & User Personas

| Persona | Role | Core Need | Key Value Driver |
|---|---|---|---|
| **Dr. Elena Vance** | CISO, National Defense Lab | Secure confidential IP & research summaries across defense contractors | Level 3 (Quantum-OTP) guarantees information-theoretic protection against HNDL attacks. |
| **Marcus Sterling** | Legal Counsel, M&A Advisory | Share high-stakes merger term sheets and litigation attachments securely | Decentralized IPFS storage + Blockchain proof of non-tampering and timestamped delivery. |
| **Avery Chen** | Executive Assistant | Coordinate sensitive scheduling and communication without friction | Seamless Gmail/Outlook integration with intuitive UI security-level selectors. |

---

## 5. System Architecture & Modular Monolith Design

QuMail is structured as a **Modular Monolith** with strict domain boundaries, explicit interfaces, and isolated dependency trees to allow seamless future extraction into microservices.

### Module Boundary Directory Layout
\\\
/qumail-core
├── /src
│   ├── /modules
│   │   ├── /auth             # OAuth2 token exchange & session handling
│   │   ├── /email            # Provider abstraction (Gmail, MS Graph)
│   │   ├── /crypto           # AES-256-GCM & One-Time Pad engines
│   │   ├── /qkm              # Quantum Key Manager (ETSI GS QKD 014)
│   │   ├── /qkd-sim          # Statistical physical channel simulator
│   │   ├── /attachments      # Pinata IPFS integration
│   │   ├── /blockchain       # Solidity contract & Web3 registry client
│   │   └── /ai-monitor       # QKD telemetry & email threat ML models
│   ├── /database             # PostgreSQL schemas & migrations (Prisma/Drizzle)
│   └── /api                  # Modular Express/Fastify routes & middleware
\\\

---

## 6. Security Levels & Cryptographic Specification

### 6.1 Security Level Comparison

| Attribute | Level 1: Standard | Level 2: Quantum-AES | Level 3: Quantum-OTP |
|---|---|---|---|
| **Security Classification** | Classical Transport Security (TLS) | Computational Security | Information-Theoretic Secrecy |
| **Key Generation Source** | N/A (Standard Mail) | QKM Pool (256-bit entropy) | QKM Pool (N bytes matching plaintext) |
| **Bulk Cipher** | None (Plaintext via Provider) | AES-256-GCM (AEAD) | Bitwise XOR Stream |
| **Key Lifecycle** | N/A | Single Key per Message/Session | Strict Single-Use, Consumed Byte-for-Byte |
| **Attachment Handling** | Native Mail Provider Attachment | Encrypted -> Pinata IPFS -> Blockchain | Encrypted -> Pinata IPFS -> Blockchain |
| **Failure Mode** | Fail if provider SMTP fails | Reject if QKM unavailable | Block send if key pool < N bytes |

### 6.2 Level 2: Quantum-AES Cryptographic Protocol
1. **Key Acquisition:** QuMail backend requests 256 bits of key material from the QKM for peer pair \(Sender, Recipient)\.
2. **Nonce Generation:** Secure random 96-bit (12-byte) initialization vector (IV) generated per message using \crypto.randomBytes(12)\.
3. **Payload Encryption:** \Ciphertext, AuthTag <- AES-256-GCM-Encrypt(K_QKM, IV, Plaintext, AAD)\.
4. **Output Packaging:** JSON QuMail Envelope containing ciphertext (Base64), iv (Base64), authTag (Base64), and keyId.

### 6.3 Level 3: Quantum-OTP Cryptographic Protocol
1. **Key Availability Check:** Inquire QKM for available continuous key stream length {\text{avail}}$ between \(Sender, Recipient)\.
2. **Validation:** Ensure {\text{avail}} \ge L_{\text{plaintext}}$. If insufficient, reject operation and provide explicit UI prompt allowing switch to Level 2.
3. **Reservation & Extraction:** Reserve {\text{plaintext}}$ bytes. Extract raw key stream bytes {\text{OTP}} = [b_0, b_1, \dots, b_{n-1}]$.
4. **Encryption (Bitwise XOR):**  = P_i \oplus K_{\text{OTP}, i}$.
5. **HMAC/Integrity Generation:** Level 3 encapsulates an authenticated integrity hash: $\text{MacTag} = \text{HMAC-SHA256}(K_{\text{MAC}}, C)$.
6. **Key Destruction:** Key manager atomically marks byte slice as \CONSUMED\. Re-encryption or re-request with overlapping indices is forbidden.

---

## 7. Encrypted Message Envelope Format

\\\json
{
  "": "https://qumail.io/schemas/v1/message.json",
  "qumailVersion": "1.0.0",
  "securityLevel": 2,
  "header": {
    "messageId": "msg_9f83a21b-4d73-42e1-93c4-118e77a28b90",
    "timestamp": "2026-08-15T09:25:30.104Z",
    "sender": "elena.vance@blackmesa.gov",
    "recipient": "gordon.freeman@blackmesa.gov",
    "subjectEncrypted": true
  },
  "crypto": {
    "algorithm": "AES-256-GCM",
    "keyId": "qkey_e3b0c442-98fc-1c14-9afb-f4c8996fb924",
    "keyDomain": "qkm.local.node-alpha",
    "iv": "u8XJk+81mLa9Fv1X",
    "authTag": "c928vN+kLz0A6BfA29xKvw==",
    "keyConsumedBytes": 32
  },
  "payload": {
    "encryptedSubject": "iZ80wQ3Kk92lM...",
    "encryptedBody": "kX7a2Jm+9Lz..."
  },
  "attachments": [
    {
      "attachmentId": "att_11a8c3d4",
      "filenameEncrypted": "report_q3_telemetry.pdf.enc",
      "ipfsCID": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      "sha256Hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "sizeBytes": 4194304,
      "keyId": "qkey_f4c8996f-1c14-42e1-9afb-e3b0c44298fc",
      "blockchainTxRef": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e:14209"
    }
  ]
}
\\\

---

## 8. Quantum Key Manager (QKM) & ETSI GS QKD 014 Specification

### 8.1 ETSI GS QKD 014 REST Endpoints

#### 1. Get Key Status / Pool Metrics
- **Route:** \GET /api/v1/qkm/status?target_node={targetNodeId}\

#### 2. Request / Reserve Key Material
- **Route:** \POST /api/v1/qkm/keys/{targetNodeId}/reserve\
- **Request Body:**
\\\json
{
  "keyLengthBits": 256,
  "purpose": "QUANTUM_AES_MESSAGE",
  "timeoutSeconds": 300
}
\\\

#### 3. Retrieve Key with Key ID (Recipient Side)
- **Route:** \POST /api/v1/qkm/keys/{sourceNodeId}/get_key\
- **Request Body:**
\\\json
{
  "keyId": "qkey_e3b0c442-98fc-1c14-9afb-f4c8996fb924"
}
\\\

---

## 9. QKD Physical Layer Simulator & Channel Monitoring

### 9.1 Mathematical Model of QKD Channel
1. **Quantum Bit Error Rate (QBER):**
   QBER = \frac{e_{\text{detector}} \cdot Y_0 + e_{\text{opt}} \cdot \eta \cdot \mu}{Y_0 + \eta \cdot \mu}
2. **Secret Key Rate Extraction ({\text{secret}}$):**
   R_{\text{secret}} \ge q \cdot Q_\mu \cdot \left[ 1 - H_2(e_{\text{phase}}) - f(QBER) \cdot H_2(QBER) \right]
   If  > 11\%$ (Shor-Preskill security bound for standard BB84), {\text{secret}} = 0$, the channel halts key distribution and triggers a high-severity security alert.

---

## 10. Adaptive Privacy Amplification

When channel noise increases ( \le 11\%$), Eve may have gained partial mutual information ($).
1. **Estimate Mutual Information ($):**  \le H_2(QBER_{\text{measured}} + \Delta_{\text{conf}})$
2. **Toeplitz Hash Matrix Shrinkage:** Compress sifted key block into final key:
   K_{\text{final}} = \mathbb{T}_{N_{\text{final}} \times N_{\text{sifted}}} \cdot K_{\text{sifted}} \pmod 2
   where {\text{final}} = N_{\text{sifted}} \cdot [1 - I_E - \text{SecurityMargin}]$.

---

## 11. AI / ML Monitoring & Threat Architecture

1. **QKD Optical Anomaly Classifier:** Isolation Forest + 1D Autoencoder detecting anomalies across QBER, photon loss, and count rates.
2. **Explainable AI (XAI) Engine:** SHAP feature importance explaining cause of optical variations.
3. **Key Consumption Forecaster:** Rolling consumption estimation and pre-emptive Level 2 fallback warnings.
4. **Email Threat & Phishing Detection Engine:** Header analysis, SPF/DKIM validation, and link risk scoring.

---

## 12. Attachment Handling & Pinata IPFS Integration

- **Upload Flow:** Encrypt file locally $\to$ Compute SHA-256 $\to$ Upload to Pinata IPFS via API $\to$ Anchor (CID, SHA256_Hash, KeyID) to Blockchain $\to$ Embed reference in QuMail email.
- **Download Flow:** Retrieve CID & Hash $\to$ Verify with Blockchain Registry $\to$ Fetch from IPFS Gateway $\to$ Validate SHA-256 $\to$ Decrypt using QKM Key.

---

## 13. Blockchain Attachment Registry (EVM Architecture)

- **Smart Contract:** \QuMailAttachmentRegistry.sol\
- **Functions:**
  - \egisterAttachment(bytes32 attachmentId, string ipfsCID, bytes32 contentSha256, bytes32 keyIdHash, uint8 securityLevel)\
  - \erifyAttachment(bytes32 attachmentId, bytes32 contentSha256)\

---

## 14. Email Provider Abstraction & OAuth Integration

- **Providers:** \GmailProvider\ (Google OAuth2 + Gmail API) and \MicrosoftProvider\ (MSAL + Microsoft Graph API).
- **Core Interface:** \IEmailProvider\ exposing \uthenticate\, \listMessages\, \getMessage\, \sendMessage\, and \saveDraft\.

---

## 15. Key Lifecycle State Machine

- **States:** \AVAILABLE\ $\to$ \RESERVED\ $\to$ \CONSUMED\ (plus \EXPIRED\ and \INVALID\).
- **Invariants:** Atomic reservation via DB row locking, strict zeroing of key buffers in memory, and absolute prevention of OTP key reuse.

---

## 16. Database Schema (PostgreSQL Model)

- **Core Tables:** \users\, \connected_accounts\, \quantum_keys\, \message_security_metadata\, \ttachments\, \qkd_telemetry_logs\.

---

## 17. User Interface Specification

- Modern responsive web client with:
  - Multi-account OAuth connection
  - Tri-level security selector in Compose
  - Real-time QKD optical link status widget
  - One-click blockchain integrity verifier badge
  - AI Threat & Anomaly diagnostic modal

---

## 18. Failure Modes & Graceful Degradation

- Strict **No Silent Downgrade Rule**.
- Explicit user confirmations for any fallback.
- Fail-secure error handling across QKM, IPFS, Blockchain, and Decryption pipelines.

---

## 19. Comprehensive Demo Scenarios (20 Verification Points)

Covers all 20 end-to-end verification points: OAuth connection, inbox sync, Level 1 standard send, Level 2 Quantum-AES send/decrypt, Level 3 Quantum-OTP send/decrypt, Pinata IPFS encrypted upload/retrieval, Blockchain hash registration/verification, QKD key lifecycle, OTP non-reuse enforcement, key pool exhaustion handling, optical disturbance simulation, ML anomaly detection, adaptive privacy amplification, and AEAD tampering detection.

---

## 20. Evolution Roadmap

- **Phase 1:** Working Prototype (Current Scope).
- **Phase 2:** Hardware QKD Migration (Plug-in ETSI GS QKD 014 physical appliances).
- **Phase 3:** Hybrid Post-Quantum Cryptography (ML-KEM/Kyber-1024 and ML-DSA/Dilithium).

