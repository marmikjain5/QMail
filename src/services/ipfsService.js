import dotenv from "dotenv";
dotenv.config();

function getPinataConfig() {
  dotenv.config();
  const apiKey = (process.env.PINATA_API_KEY || "").trim();
  const secretKey = (process.env.PINATA_SECRET_API_KEY || "").trim();
  const jwt = (process.env.PINATA_JWT || "").trim();
  const gateway = (process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs/").trim();
  return { apiKey, secretKey, jwt, gateway };
}

/**
 * Checks if Pinata credentials are properly configured in environment.
 * @returns {boolean}
 */
export function isPinataConfigured() {
  const { apiKey, secretKey, jwt } = getPinataConfig();
  return Boolean(jwt || (apiKey && secretKey));
}

/**
 * Get HTTP headers for Pinata API requests.
 */
function getPinataHeaders() {
  const { apiKey, secretKey, jwt } = getPinataConfig();
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }
  if (apiKey && secretKey) {
    return {
      pinata_api_key: apiKey,
      pinata_secret_api_key: secretKey
    };
  }
  return {};
}

/**
 * Uploads encrypted file payload buffer to Pinata IPFS.
 *
 * @param {Object} options
 * @param {string} options.filename Name of file being pinned
 * @param {Buffer} options.buffer Encrypted file payload buffer
 * @returns {Promise<{ ipfsCid: string, pinSize: number, timestamp: string } | null>}
 */
export async function uploadToPinata({ filename, buffer }) {
  if (!isPinataConfigured()) {
    console.warn("[ipfsService] Pinata credentials not configured in .env. Skipping IPFS upload.");
    return null;
  }

  try {
    const formData = new FormData();
    const blob = new Blob([buffer], { type: "application/octet-stream" });
    formData.append("file", blob, filename);

    const pinataOptions = JSON.stringify({ cidVersion: 1 });
    formData.append("pinataOptions", pinataOptions);

    const pinataMetadata = JSON.stringify({
      name: `QuMail-Encrypted-${filename}`,
      keyvalues: {
        app: "QuMail",
        encrypted: "true"
      }
    });
    formData.append("pinataMetadata", pinataMetadata);

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: getPinataHeaders(),
      body: formData
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Pinata upload failed with status ${res.status}: ${errText}`);
    }

    const data = await res.json();
    console.log(`[ipfsService] Uploaded encrypted attachment ${filename} to Pinata IPFS. CID: ${data.IpfsHash}`);
    return {
      ipfsCid: data.IpfsHash,
      pinSize: data.PinSize,
      timestamp: data.Timestamp
    };
  } catch (err) {
    console.error("[ipfsService] Upload to Pinata error:", err.message);
    return null;
  }
}

/**
 * Fetches encrypted payload from IPFS via gateway.
 *
 * @param {string} ipfsCid
 * @returns {Promise<Buffer | null>}
 */
export async function fetchFromIpfs(ipfsCid) {
  if (!ipfsCid) return null;

  const { jwt, gateway } = getPinataConfig();
  const gateways = [
    gateway.endsWith("/") ? `${gateway}${ipfsCid}` : `${gateway}/${ipfsCid}`,
    `https://gateway.pinata.cloud/ipfs/${ipfsCid}`,
    `https://ipfs.io/ipfs/${ipfsCid}`,
    `https://cloudflare-ipfs.com/ipfs/${ipfsCid}`
  ];

  // De-duplicate gateways
  const uniqueGateways = Array.from(new Set(gateways));

  for (const gatewayUrl of uniqueGateways) {
    try {
      console.log(`[ipfsService] Fetching IPFS payload from gateway: ${gatewayUrl}`);
      const headers = {};
      if (gatewayUrl.includes("pinata.cloud") && jwt) {
        headers["Authorization"] = `Bearer ${jwt}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout per gateway

      const res = await fetch(gatewayUrl, { headers, signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        console.log(`[ipfsService] Successfully retrieved ${arrayBuf.byteLength} bytes from IPFS gateway.`);
        return Buffer.from(arrayBuf);
      }
    } catch (err) {
      console.warn(`[ipfsService] Gateway ${gatewayUrl} fetch failed:`, err.message);
    }
  }

  console.error(`[ipfsService] All IPFS gateways failed to retrieve CID: ${ipfsCid}`);
  return null;
}
