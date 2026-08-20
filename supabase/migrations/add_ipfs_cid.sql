-- ==============================================================================
-- QuMail Supabase Schema Migration: Add IPFS CID & Content Hash Columns
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)
-- ==============================================================================

-- 1. Add ipfs_cid and content_hash columns to message_attachments table
ALTER TABLE message_attachments 
  ADD COLUMN IF NOT EXISTS ipfs_cid text,
  ADD COLUMN IF NOT EXISTS content_hash text;

-- 2. Create index on ipfs_cid for fast lookup
CREATE INDEX IF NOT EXISTS idx_message_attachments_ipfs_cid 
  ON message_attachments(ipfs_cid);
