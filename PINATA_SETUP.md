# Pinata IPFS & Supabase Database Setup Guide

This guide explains how to configure Pinata IPFS credentials in your `.env` file and apply the database schema update in Supabase.

---

## 1. Apply Supabase Database Schema Update

We created a dedicated migration file for you: [`supabase/migrations/add_ipfs_cid.sql`](file:///d:/QuMail/supabase/migrations/add_ipfs_cid.sql).

### Steps to apply:
1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor** from the left navigation menu.
3. Paste the following SQL code into the editor and click **Run**:

```sql
-- Add ipfs_cid and content_hash columns to message_attachments table
ALTER TABLE message_attachments 
  ADD COLUMN IF NOT EXISTS ipfs_cid text,
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Create index on ipfs_cid for fast lookup
CREATE INDEX IF NOT EXISTS idx_message_attachments_ipfs_cid 
  ON message_attachments(ipfs_cid);
```

---

## 2. Update `.env` with Pinata Credentials

To obtain Pinata API credentials:
1. Log in or create an account at [Pinata.cloud](https://app.pinata.cloud/).
2. Go to **API Keys** in the sidebar.
3. Click **New Key**, select `pinFileToIPFS` permissions (or Admin), and copy your **JWT Token** (or API Key & Secret).
4. Open your `.env` file in the project root (`d:\QuMail\.env`).
5. Update the Pinata section with your token or keys:

### Option A: Using Pinata JWT (Recommended)
```env
# Pinata IPFS Configuration
PINATA_JWT=your_pinata_jwt_token_here
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs/
```

### Option B: Using API Key & Secret Key
```env
# Pinata IPFS Configuration
PINATA_API_KEY=your_pinata_api_key
PINATA_SECRET_API_KEY=your_pinata_secret_key
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs/
```

---

## 3. How the Encrypted IPFS Attachment Flow Works

1. **Encryption Before Upload**: When an attachment is sent in QuMail, the file is encrypted locally using AES-256-GCM and QKM/quantum keys.
2. **Pinata Upload**: The encrypted payload bundle `{ ciphertext_b64, nonce_b64, auth_tag_b64, content_hash }` is uploaded to Pinata IPFS via REST API.
3. **Database Storage**: The returned IPFS CID (`Qm...` or `bafy...`) and SHA-256 content hash are stored in Supabase under `message_attachments`.
4. **Blockchain Anchoring**: The CID and SHA-256 content hash are registered on the Hardhat `QuMailAttachmentRegistry` smart contract.
5. **Decryption & Retrieval**: When the recipient clicks **Download**, QuMail retrieves the encrypted bundle from the Pinata IPFS gateway, validates the SHA-256 content hash, and decrypts the file using the QKM key.
6. **Graceful Fallback**: If Pinata credentials are missing or offline, QuMail gracefully stores/retrieves the encrypted payload inline from the database so messaging never fails.
