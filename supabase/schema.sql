create extension if not exists pgcrypto;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  email_address text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists provider_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  provider text not null,
  provider_account_email text,
  oauth_access_token_encrypted text,
  oauth_refresh_token_encrypted text,
  token_expiry timestamptz,
  scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider)
);

create table if not exists kme_keys (
  id uuid primary key default gen_random_uuid(),
  key_id text not null,
  pair_id text not null,
  owner_client_id uuid not null references clients(id) on delete cascade,
  peer_client_id uuid not null references clients(id) on delete cascade,
  key_material_encrypted text not null,
  key_size_bytes integer not null,
  algorithm_usage text not null check (algorithm_usage in ('AES256_GCM', 'OTP')),
  source_type text not null check (source_type in ('MOCK_PRE_SHARED', 'SIMULATED_QKD')),
  status text not null check (status in ('AVAILABLE', 'RESERVED', 'CONSUMED', 'EXPIRED', 'REJECTED')),
  reserved_for_message_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  unique (owner_client_id, key_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  sender_client_id uuid not null references clients(id) on delete cascade,
  recipient_client_id uuid not null references clients(id) on delete cascade,
  transport_provider text not null,
  transport_message_id text,
  subject_hint text,
  encryption_mode text not null check (encryption_mode in ('STANDARD', 'QUANTUM_AES', 'QUANTUM_OTP')),
  key_id text,
  nonce_b64 text,
  auth_tag_b64 text,
  ciphertext_b64 text,
  package_version text not null,
  package_json jsonb not null,
  status text not null check (status in ('DRAFT', 'ENCRYPTED', 'SENT', 'RECEIVED', 'DECRYPTED', 'FAILED')),
  sent_at timestamptz,
  received_at timestamptz,
  decrypted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  filename text not null,
  mime_type text,
  byte_size integer not null,
  ciphertext_b64 text,
  nonce_b64 text,
  auth_tag_b64 text,
  ipfs_cid text,
  content_hash text,
  storage_mode text not null default 'INLINE',
  created_at timestamptz not null default now()
);

create table if not exists key_usage_events (
  id uuid primary key default gen_random_uuid(),
  key_id text not null,
  event_type text not null,
  actor_type text not null,
  actor_id text not null,
  message_id text,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_kme_keys_owner_status on kme_keys(owner_client_id, status);
create index if not exists idx_kme_keys_key_id on kme_keys(key_id);
create index if not exists idx_messages_recipient on messages(recipient_client_id, created_at desc);
create index if not exists idx_message_attachments_message on message_attachments(message_id);
create index if not exists idx_key_usage_events_key_id on key_usage_events(key_id, created_at desc);
