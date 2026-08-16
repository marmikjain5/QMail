from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from loguru import logger
import os

app = FastAPI(title="QuMail ML Sidecar", version="1.0.0")

MODELS_DIR = Path("models")

# =============================================================================
# Models Loading
# =============================================================================
isolation_forest = None
autoencoder = None
scaler = None
autoencoder_config = None
tfidf_pipeline = None

@app.on_event("startup")
async def load_models():
    global isolation_forest, autoencoder, scaler, autoencoder_config, tfidf_pipeline

    try:
        logger.info("Loading ML models...")
        isolation_forest = joblib.load(MODELS_DIR / "isolation_forest.joblib")
        scaler = joblib.load(MODELS_DIR / "scaler.joblib")
        autoencoder = joblib.load(MODELS_DIR / "autoencoder.joblib")
        autoencoder_config = joblib.load(MODELS_DIR / "autoencoder_config.joblib")
        tfidf_pipeline = joblib.load(MODELS_DIR / "tfidf_phishing.joblib")
        
        logger.success("Models loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load models: {e}. Run model_train.py first.")

# =============================================================================
# API Models
# =============================================================================

class QkdTelemetryReading(BaseModel):
    qber: float
    photon_loss_db: float
    photon_detection_rate: float
    raw_key_rate_bps: int
    secret_key_rate_bps: int
    timestamp: str

class QkdAnalyzeRequest(BaseModel):
    readings: List[QkdTelemetryReading]

class QkdAnalyzeResponse(BaseModel):
    anomalyDetected: bool
    anomalyScore: float
    classification: str
    explanation: str
    shapValues: Optional[dict] = None
    recommendedAction: str
    privacyAmplificationNeeded: bool
    privacyAmplificationRatio: Optional[float] = None

class EmailThreatRequest(BaseModel):
    subject: str
    body_plain: str
    sender_domain: str
    sender_email: str
    links: List[str] = []
    has_attachments: bool = False
    attachment_types: List[str] = []

class EmailThreatResponse(BaseModel):
    threatScore: int
    classification: str
    reasons: List[str]
    suspiciousLinks: List[str]
    recommendedAction: str

# =============================================================================
# Routes
# =============================================================================

@app.get("/health")
def health_check():
    return {"status": "ok", "models_loaded": isolation_forest is not None}

@app.post("/analyze/qkd", response_model=QkdAnalyzeResponse)
def analyze_qkd(request: QkdAnalyzeRequest):
    if isolation_forest is None or autoencoder is None:
        raise HTTPException(status_code=503, detail="Models not loaded")
        
    if not request.readings:
        return _normal_response()
        
    latest = request.readings[-1]
    
    # 1. Check critical threshold first (rule-based override)
    if latest.qber >= 0.11:
        return QkdAnalyzeResponse(
            anomalyDetected=True,
            anomalyScore=1.0,
            classification="CRITICAL",
            explanation="QBER has exceeded the theoretical maximum bound of 11% for BB84. No secure key can be extracted.",
            recommendedAction="Halt key generation immediately. Investigate link integrity.",
            privacyAmplificationNeeded=False
        )
        
    # 2. Prepare features
    feature_cols = ["qber", "photon_loss_db", "photon_detection_rate", "raw_key_rate_bps", "secret_key_rate_bps"]
    X = pd.DataFrame([r.model_dump() for r in request.readings])[feature_cols].values
    X_scaled = scaler.transform(X)
    
    # We focus on the most recent reading for classification
    x_latest = X_scaled[-1].reshape(1, -1)
    
    # 3. Isolation Forest Prediction
    # -1 for anomaly, 1 for normal
    iso_pred = isolation_forest.predict(x_latest)[0]
    iso_score = -isolation_forest.score_samples(x_latest)[0] # higher is more anomalous
    
    # 4. Autoencoder Reconstruction Error
    reconstructed = autoencoder.predict(x_latest)
    mse = float(np.mean((x_latest - reconstructed) ** 2))
    ae_threshold = autoencoder_config["threshold"]
    ae_anomaly = mse > ae_threshold
    
    is_anomaly = iso_pred == -1 or ae_anomaly
    
    if not is_anomaly:
        return _normal_response()
        
    # Feature deviation explanation
    feature_deviations = np.abs(x_latest[0])
    feature_impact_dict = {feature_cols[i]: float(feature_deviations[i]) for i in range(len(feature_cols))}
    
    # Determine specific classification based on features
    if latest.qber > 0.08:
        classification = "POSSIBLE_INTERCEPTION"
        explanation = f"ML model detected high probability of interception based on elevated QBER ({latest.qber*100:.1f}%) and corresponding metrics."
        pa_needed = True
    elif latest.qber > 0.04:
        classification = "SUSPICIOUS_NOISE"
        explanation = f"Anomalous channel noise detected (QBER {latest.qber*100:.1f}%). Likely turbulence or misalignment."
        pa_needed = True
    else:
        classification = "HARDWARE_DEGRADATION"
        explanation = f"Anomalous telemetry detected despite normal QBER. Detection rate: {latest.photon_detection_rate:.0f} cps. Possible hardware issue."
        pa_needed = False
        
    pa_ratio = max(0.0, 1.0 - (-latest.qber * np.log2(max(1e-10, latest.qber)) - (1-latest.qber) * np.log2(max(1e-10, 1-latest.qber))) * 1.5) if pa_needed else None
    
    # Normalize anomaly score (0-1)
    anomaly_score_norm = min(1.0, max(0.0, float((iso_score - 0.3) / 0.5)))
    
    return QkdAnalyzeResponse(
        anomalyDetected=True,
        anomalyScore=round(anomaly_score_norm, 4),
        classification=classification,
        explanation=explanation,
        shapValues=feature_impact_dict,
        recommendedAction="Enable privacy amplification or switch to Level 2 AES if pool depletes." if pa_needed else "Inspect fiber physical integrity.",
        privacyAmplificationNeeded=pa_needed,
        privacyAmplificationRatio=round(pa_ratio, 4) if pa_ratio else None
    )

@app.post("/analyze/email", response_model=EmailThreatResponse)
def analyze_email(request: EmailThreatRequest):
    if tfidf_pipeline is None:
        raise HTTPException(status_code=503, detail="Models not loaded")
        
    text = f"{request.subject} {request.body_plain}"
    
    # TF-IDF probability prediction
    phishing_prob = float(tfidf_pipeline.predict_proba([text])[0][1])
    threat_score = int(phishing_prob * 100)
    
    reasons = []
    suspicious_links = []
    
    # Rule-based heuristics boost
    keywords = ["urgent", "password", "verify", "account", "bank", "ssn", "login", "suspended", "immediate"]
    for kw in keywords:
        if kw in text.lower():
            threat_score += 10
            reasons.append(f"Contains high-risk urgency/phishing keyword: '{kw}'")
            
    for link in request.links:
        if "http://" in link or "bit.ly" in link or "tinyurl" in link or "login" in link:
            threat_score += 20
            suspicious_links.append(link)
            reasons.append(f"Contains unencrypted/suspicious link: {link}")
            
    threat_score = min(100, threat_score)
    
    if threat_score > 70:
        classification = "HIGH_RISK_PHISHING"
        action = "Block email and alert user. Do not click any links."
    elif threat_score > 30:
        classification = "SUSPICIOUS"
        action = "Display security warning banner to user."
    else:
        classification = "BENIGN"
        action = "Pass message through."
        
    return EmailThreatResponse(
        threatScore=threat_score,
        classification=classification,
        reasons=list(set(reasons)),
        suspiciousLinks=suspicious_links,
        recommendedAction=action
    )

def _normal_response() -> QkdAnalyzeResponse:
    return QkdAnalyzeResponse(
        anomalyDetected=False,
        anomalyScore=0.0,
        classification="HEALTHY",
        explanation="QKD channel telemetry within normal operational parameters.",
        recommendedAction="No action needed.",
        privacyAmplificationNeeded=False
    )
