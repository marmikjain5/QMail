You are the lead software architect for a project called QuMail.

I want you to PLAN and then implement a working prototype of QuMail, a quantum-secured email application. Do not blindly start coding. First inspect the requirements below, identify the services/modules required, define their responsibilities, define the API contracts and database schema, and propose the implementation order. After the plan is clear, implement it incrementally.

IMPORTANT ARCHITECTURAL CONTEXT

We do NOT have physical QKD hardware or a QKD provider.

Therefore, we will build a SOFTWARE QKD SIMULATOR based on the BB84 protocol for development/demo purposes.

The simulator must NOT simply generate random bytes and call them "quantum keys". It should model the important BB84 process:

1. Alice generates random bits.
2. Alice randomly chooses bases.
3. Alice prepares simulated quantum states.
4. States pass through a simulated quantum channel.
5. Bob randomly chooses measurement bases.
6. Basis sifting keeps only matching-basis measurements.
7. Calculate QBER.
8. Support an optional Eve intercept-resend attack.
9. Demonstrate that Eve increases QBER.
10. Perform simplified error correction.
11. Perform privacy amplification.
12. Produce final shared key material.

The simulator is a software model of the QKD layer. Clearly label it as SIMULATED QKD throughout the code/UI. Do not claim that it provides physical quantum security.

ARCHITECTURE

The system should have these conceptual layers:

1. QKD SIMULATOR
2. KME / KEY MANAGEMENT ENTITY
3. ETSI GS QKD 014 INTERFACE
4. QuMail APPLICATION
5. EMAIL PROVIDER / TRANSPORT
6. CLIENT 1 / CLIENT 2

The QKD simulator and KME should be separate services/modules from the QuMail application.

The overall architecture should be:

QKD Simulator
    ↓
shared simulated key material
    ↓
Alice KME + Bob KME
    ↓
ETSI GS QKD 014-style REST API
    ↓
QuMail application
    ↓
AES-256-GCM or OTP
    ↓
normal email infrastructure
    ↓
recipient QuMail
    ↓
recipient KME
    ↓
corresponding key
    ↓
decrypt

Do NOT build physical quantum hardware.

Do NOT build our own quantum channel hardware.

Do NOT add blockchain.

Do NOT add ChromaDB.

Do NOT add a mobile application.

Do NOT add unnecessary AI/ML components.

Do NOT add unnecessary microservices.

Keep the system understandable and hackathon-friendly.

--------------------------------------------------
1. QKD SIMULATOR
--------------------------------------------------

Create a separate qkd-simulator service/module.

Implement a simplified BB84 simulation.

It should expose an API or service interface that can generate a QKD session between two participants.

The simulation should produce:

- session ID
- Alice participant
- Bob participant
- number of simulated qubits
- Alice bits/bases internally
- Bob bases/measurements internally
- sifted key
- QBER
- Eve enabled/disabled
- error correction result
- privacy amplification result
- final shared key
- final key size
- session status

Do not expose Alice's private raw bits/bases to normal QuMail users.

The simulator should support:

EVE OFF:
low QBER → key accepted

EVE ON:
intercept-resend attack → significantly higher QBER → potentially reject the key

Use cryptographically secure randomness where appropriate, but make it clear that the physical quantum behavior is simulated mathematically.

The simulator should eventually hand the resulting shared key material to the KME layer.

--------------------------------------------------
2. KME
--------------------------------------------------

Implement a KME service/module.

There should conceptually be:

Alice KME
Bob KME

The KME is responsible for:

- storing key material
- assigning unique key IDs
- associating keys with sender/receiver
- tracking key size
- tracking creation time
- tracking expiration
- tracking status
- tracking consumption
- preventing key reuse
- allowing the correct peer to retrieve the corresponding key
- maintaining audit information

A key record should have fields conceptually like:

key_id
session_id
source_client
target_client
key_material
key_size
status
created_at
expires_at
used_at
algorithm/intended_usage

Statuses could include:

AVAILABLE
RESERVED
CONSUMED
EXPIRED
REJECTED

Never allow a CONSUMED OTP key to be reused.

For development, PostgreSQL can be used for persistent KME storage.

Do not use Supabase unless there is a concrete technical reason.

Keep raw key material isolated from ordinary QuMail application data as much as practical.

--------------------------------------------------
3. ETSI GS QKD 014
--------------------------------------------------

Implement an ETSI GS QKD 014-compatible key-delivery interface between QuMail and the KME.

The goal is to demonstrate that QuMail is an SAE/application consuming keys from a KME.

At minimum support the conceptual operations:

GET /status
POST /keys
POST /keys_with_id

If a consume operation is appropriate for the chosen ETSI version, implement it consistently with the selected API version. Do not invent random endpoint semantics.

Document which ETSI GS QKD 014 version/endpoint schema is being followed.

The important workflow is:

Alice QuMail
    ↓
request key for Bob
    ↓
Alice KME
    ↓
key_id + key material

Then the email/application envelope carries the key ID, NOT the raw secret key.

Bob QuMail receives the key ID.

Bob QuMail
    ↓
request key using key ID
    ↓
Bob KME
    ↓
corresponding key material

The two applications therefore obtain the corresponding shared key material from their respective KMEs.

Do NOT send the raw key through Gmail or the normal email transport.

--------------------------------------------------
4. QU MAIL KEY MANAGER
--------------------------------------------------

Inside the QuMail application, build an application-level Key Manager.

This is NOT another KME.

Its responsibility is application-side key lifecycle management.

It should:

- request keys from the KME
- store/track key IDs
- know which recipient a key belongs to
- know which message/attachment used a key
- track key consumption
- prevent accidental reuse
- request fresh keys when necessary
- handle insufficient key material
- handle expired keys
- handle failed KME requests
- associate key IDs with encrypted messages

Do not unnecessarily duplicate raw KME key storage inside the main QuMail database.

The application should primarily work with key IDs and short-lived key material in memory where possible.

--------------------------------------------------
5. ENCRYPTION
--------------------------------------------------

Support two security modes.

MODE 1:
Quantum-assisted AES

Use QKD-derived key material with AES-256-GCM.

This should be the practical/default mode for normal emails and attachments.

Support:

- text
- MIME-style email content
- attachments
- integrity/authentication

MODE 2:
Quantum Secure OTP

Use a fresh QKD-derived key for OTP/XOR encryption.

Important:

OTP requires key material at least as large as the plaintext.

Therefore:

- do NOT use OTP blindly for huge files
- calculate required key size
- check available key material
- consume the OTP key permanently after use
- never reuse an OTP key

If insufficient QKD material exists, clearly report that OTP cannot be used rather than silently reusing a key.

--------------------------------------------------
6. SECURE EMAIL PACKAGE
--------------------------------------------------

Define a QuMail secure-message format.

For example, conceptually:

message_id
sender
recipient
subject metadata
algorithm
key_id
nonce/IV where required
ciphertext
authentication tag
attachment metadata
timestamp
version

The raw QKD key must NEVER be included in this package.

The package should contain the key ID needed by the recipient to retrieve the corresponding key.

--------------------------------------------------
7. EMAIL TRANSPORT
--------------------------------------------------

The goal is NOT to replace Gmail/Outlook/Yahoo.

QuMail should encrypt the content BEFORE it reaches the normal email provider.

The email provider transports ciphertext.

Keep the email-provider integration modular.

For the first prototype, create a mail transport abstraction.

If real Gmail integration is implemented, use the appropriate official API/SMTP mechanism rather than hardcoding credentials.

The architecture should allow:

QuMail
 ↓
encrypted MIME/message
 ↓
Gmail/other provider
 ↓
recipient QuMail

The email provider should not receive the raw QKD key.

--------------------------------------------------
8. CLIENT UI FOR NOW
--------------------------------------------------

Do NOT implement login/authentication yet.

When a user opens the site, show:

CLIENT 1
CLIENT 2

The user chooses which simulated participant they are.

For example:

[ Client 1 / Alice ]
[ Client 2 / Bob ]

After selecting a client, show that client's QuMail interface.

This is ONLY a temporary development/demo identity mechanism.

Structure the code so proper authentication/login can be added later without rewriting the application.

Do not build registration, password reset, OAuth, etc. yet.

--------------------------------------------------
9. QU MAIL UI
--------------------------------------------------

The UI should allow:

- compose email
- choose recipient
- enter subject
- enter message
- attach file
- choose encryption mode:
  - Quantum-assisted AES
  - OTP
- request/allocate key
- show key ID (never show raw key)
- show available key capacity/status where appropriate
- send encrypted message
- receive encrypted message
- retrieve corresponding key
- decrypt
- display decrypted email
- show encryption metadata/status

Also create a simple developer/admin view showing the simulated QKD/KME state:

- QKD sessions
- QBER
- Eve ON/OFF
- key pool
- available keys
- consumed keys
- expired keys
- key IDs
- KME status

This is important for the hackathon demo.

--------------------------------------------------
10. DATABASE
--------------------------------------------------

Use PostgreSQL.

Design proper tables for:

- clients
- qkd_sessions
- keys / key metadata
- messages
- message_attachments
- key_usage/audit events

Do NOT create unnecessary tables.

For the prototype, KME key storage can use PostgreSQL.

Separate KME data logically from normal application data.

--------------------------------------------------
11. TECH STACK
--------------------------------------------------

Use ONE concrete stack.

Backend:

Node.js
Express.js
PostgreSQL
Redis only if there is a genuine need for queues/cache/session state

Frontend:

Use a simple web frontend suitable for the project.

Do not add React Native/Flutter/mobile.

Containerization:

Docker/Docker Compose can be added after the core functionality works.

Do not introduce Kubernetes.

Do not introduce blockchain.

Do not introduce vector databases.

Do not introduce AI.

--------------------------------------------------
12. SECURITY
--------------------------------------------------

Implement sensible prototype security:

- HTTPS/TLS-ready architecture
- no raw keys in logs
- no raw keys in email
- no raw keys exposed in frontend
- input validation
- authentication-ready architecture
- key reuse prevention
- key expiration
- secure random generation for simulation components where appropriate
- AES-GCM authenticated encryption
- clear separation between KME and QuMail

For the prototype, clearly document what is production-grade and what is simulated.

--------------------------------------------------
13. DEVELOPMENT PRIORITY
--------------------------------------------------

Build in this order:

PHASE 1
BB84 QKD simulator.

Verify:
Alice and Bob can produce the same final key.
Eve causes QBER to increase.
High QBER causes key rejection.

PHASE 2
KME.

Verify:
key IDs are generated.
key material is stored.
Alice and Bob have corresponding key material.
keys can be consumed exactly once where required.

PHASE 3
ETSI GS QKD 014-compatible API.

Verify:
QuMail can request keys.
QuMail receives key ID + key material.
Bob can retrieve corresponding key using the key ID.

PHASE 4
QuMail Key Manager.

Verify:
key lifecycle is tracked.
keys are associated with messages.
OTP keys cannot be reused.

PHASE 5
AES-256-GCM and OTP encryption.

Verify:
Alice encrypts.
Bob retrieves corresponding key.
Bob decrypts successfully.

PHASE 6
Email transport.

Verify:
ciphertext can travel through normal email infrastructure.
recipient QuMail can reconstruct/decrypt it.

PHASE 7
Frontend.

Verify:
Client 1 and Client 2 selection works.
Compose/send/receive/decrypt works.

PHASE 8
Dockerize and polish.

--------------------------------------------------
IMPORTANT
--------------------------------------------------

Before writing code, produce:

1. System architecture
2. Repository/folder structure
3. Service boundaries
4. Database schema
5. API endpoint list
6. Request/response examples
7. Key lifecycle/state machine
8. BB84 simulator design
9. QuMail secure-message format
10. Step-by-step implementation plan
11. Test strategy

Then wait for my approval before making major implementation changes.

Do not overengineer the project.

The central goal is:

"Build a software QKD/BB84 simulation → KME → ETSI QKD 014-compatible key-delivery interface → QuMail application key manager → AES/OTP encryption → existing email transport → recipient QuMail."

The physical QKD layer is simulated. Everything above that boundary should be implemented as a real working software system.
--------------------------------------------------
14. GMAIL INTEGRATION FOR CLIENT 1 AND CLIENT 2
--------------------------------------------------

For the initial prototype, there will be exactly two simulated users:

Client 1 = Alice
Client 2 = Bob

Use two separate real Gmail accounts for the email demonstration:

Client 1 → Alice's Gmail account
Client 2 → Bob's Gmail account

Use ONE Google Cloud project with the Gmail API enabled. Do NOT create separate Gmail API projects for each client.

Each Gmail account must independently authorize QuMail through OAuth 2.0.

The backend must securely store the OAuth credentials/tokens for each authorized Gmail account.

The architecture should be:

Client 1
   ↓
QuMail frontend
   ↓
Node.js backend
   ↓
Alice Gmail OAuth credentials
   ↓
Gmail API
   ↓
Bob's Gmail inbox


Client 2
   ↓
QuMail frontend
   ↓
Node.js backend
   ↓
Bob Gmail OAuth credentials
   ↓
Gmail API
   ↓
Alice's Gmail inbox

The frontend must NEVER receive or store Gmail OAuth client secrets or refresh tokens.

The backend is responsible for communicating with Gmail.

For the initial prototype, when the user visits the website, show:

[ Client 1 / Alice ]
[ Client 2 / Bob ]

Selecting Client 1 loads Alice's QuMail environment.
Selecting Client 2 loads Bob's QuMail environment.

Do NOT implement user login/registration yet.

However, design the account/provider layer so that the temporary Client 1/Client 2 selection can later be replaced with real authentication without rewriting the Gmail integration.

The system should support both directions:

Alice → Bob
Bob → Alice

Use the Gmail API to send and retrieve the encrypted QuMail messages.

The normal Gmail infrastructure should only transport the encrypted message payload. Raw QKD key material must never be sent through Gmail.