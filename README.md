# QuMail - Quantum-Secured Email Platform

QuMail is a functional prototype of a quantum-assisted secure email platform. It layers quantum key distribution (QKD), information-theoretic security (One-Time Pad), AES-256-GCM, and blockchain attachment registry on top of existing email infrastructure (Gmail/Microsoft).

## Architecture

*   **Frontend**: React (Vite), Zustand, Tailwind CSS, shadcn/ui, Recharts
*   **Backend**: Node.js, Fastify, Prisma, PostgreSQL
*   **ML Sidecar**: Python, FastAPI, scikit-learn, TensorFlow, SHAP
*   **Blockchain**: Hardhat (local node), Solidity (ethers.js v6)

## Quick Start (Development)

### 1. Database
```bash
docker-compose up -d
```

### 2. Blockchain Registry
```bash
cd blockchain
npm install
npm run node # Run this in a separate terminal
# In another terminal:
npm run deploy:local
```

### 3. ML Sidecar
```bash
cd ml
pip install -r requirements.txt
python startup.py
```

### 4. Backend
```bash
cd backend
npm install
npx prisma db push
npm run dev
```

### 5. Frontend
```bash
cd frontend
npm install
npm run dev
```

## Configuration

Copy `.env.example` to `.env` in the root and configure:
*   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
*   `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`
*   `PINATA_JWT`
*   `REGISTRY_CONTRACT_ADDRESS` (from the Hardhat deployment)

If credentials are omitted, the system falls back to mock implementations where applicable.