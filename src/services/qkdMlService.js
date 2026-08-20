import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const mlScriptPath = path.join(projectRoot, "scripts", "ml_service.py");

/**
 * Predicts whether QKD telemetry is NORMAL or ANOMALY using trained IsolationForest model.
 *
 * Strategy:
 * 1. Try HTTP call to optional persistent ML service running on port 5001.
 * 2. Fall back to spawning Python subprocess via stdin.
 * 3. If Python fails entirely, apply a conservative heuristic fallback.
 *
 * @param {object} telemetry
 * @returns {Promise<{ prediction: 'NORMAL'|'ANOMALY', anomalyScore: number, isAnomaly: boolean }>}
 */
export async function predictQkdAnomaly(telemetry) {
  const payload = {
    qber: Number(telemetry.qber || 0),
    photonLossRate: Number(telemetry.photonLossRate || 0),
    detectionRate: Number(telemetry.detectionRate || 0),
    keyGenerationRate: Number(telemetry.keyGenerationRate || 0)
  };

  // 1. Try fast HTTP service call if ml_service.py --server is running on port 5001
  try {
    const response = await fetch("http://127.0.0.1:5001/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(600)
    });
    if (response.ok) {
      const data = await response.json();
      return {
        prediction: data.prediction || "ANOMALY",
        anomalyScore: Number(data.anomalyScore || 0),
        isAnomaly: Boolean(data.isAnomaly)
      };
    }
  } catch (_httpErr) {
    // HTTP service not running - fall through to subprocess
  }

  // 2. Spawn Python subprocess, send JSON on stdin, read JSON from stdout
  return new Promise((resolve) => {
    const pythonProc = execFile(
      "python",
      [mlScriptPath],
      { cwd: projectRoot },
      (error, stdout, _stderr) => {
        if (error) {
          console.error("[qkdMlService] Python execution error:", error.message);
          // Safety heuristic fallback: flag as anomaly if telemetry is clearly abnormal
          const heuristicAnomaly = payload.qber > 0.08 || payload.photonLossRate > 0.15;
          return resolve({
            prediction: heuristicAnomaly ? "ANOMALY" : "NORMAL",
            anomalyScore: heuristicAnomaly ? -0.15 : 0.20,
            isAnomaly: heuristicAnomaly,
            fallbackUsed: true
          });
        }
        try {
          const result = JSON.parse(stdout.trim());
          return resolve({
            prediction: result.prediction || "ANOMALY",
            anomalyScore: Number(result.anomalyScore || 0),
            isAnomaly: Boolean(result.isAnomaly)
          });
        } catch (parseError) {
          console.error("[qkdMlService] Parse error:", parseError.message, stdout);
          return resolve({
            prediction: "ANOMALY",
            anomalyScore: -1.0,
            isAnomaly: true,
            fallbackUsed: true
          });
        }
      }
    );

    // Pass JSON payload into Python process stdin
    if (pythonProc.stdin) {
      pythonProc.stdin.write(JSON.stringify(payload));
      pythonProc.stdin.end();
    }
  });
}
