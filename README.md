# QuMail

QuMail is a quantum-ready secure email prototype that focuses on the application layer first:

- temporary key source: `100` mock pre-shared key pairs
- stable KME boundary: Supabase-backed key pool and audit log
- ETSI-style app contract: reserve key, retrieve key by `key_id`, inspect pool status
- security levels: Standard, Quantum-AES, Quantum-OTP
- transport: internal demo inbox now, Gmail API when OAuth is configured

## Current scope

This implementation follows the spirit of `prd.md` and `PRD2.md`, while making the practical build decision you requested:

- skip the QKD simulator for now
- keep the KME and app layers QKD-ready
- use Supabase for KME persistence
- avoid blockchain, AI/ML, and overengineered infrastructure in this first working build

## Setup

1. Copy `.env.example` to `.env`
2. Fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_MASTER_KEY` as a 64-char hex string
   - Gmail OAuth values if you want real Gmail transport
3. Apply `supabase/schema.sql` to your Supabase Postgres database
4. Install dependencies:

```bash
npm install
```

5. Start the app:

```bash
npm run dev
```

6. Open `http://localhost:3000`
7. Click `Bootstrap demo data` to create Alice, Bob, and the initial key pool

## Core API

- `POST /api/v1/admin/bootstrap`
- `GET /api/v1/clients`
- `GET /api/v1/qkm/status`
- `GET /api/v1/admin/key-pool`
- `POST /api/v1/qkm/keys/reserve`
- `POST /api/v1/qkm/keys/get_key`
- `POST /api/v1/qumail/messages/send`
- `GET /api/v1/qumail/messages/:clientCode`
- `POST /api/v1/qumail/messages/decrypt`
- `GET /api/v1/providers/gmail/auth-url/:clientCode`
- `GET /api/v1/providers/gmail/oauth/callback`
- `GET /api/v1/providers/gmail/status`

## Notes

- Raw KME key material is never returned to the frontend.
- Gmail carries only the encrypted QuMail envelope.
- OTP mode is intentionally limited to message-body encryption in this prototype.
- The future QKD simulator only needs to replace the key seeding source, not the app-layer flow.
