"""
QuMail ML Sidecar — Model Training Script

Generates synthetic QKD telemetry data and trains:
1. Isolation Forest anomaly detector
2. MLP Autoencoder anomaly detector (scikit-learn)
3. TF-IDF phishing keyword vectorizer

Run: python model_train.py
"""

import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from loguru import logger
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

# Create models directory
MODELS_DIR = Path("models")
MODELS_DIR.mkdir(exist_ok=True)

# =============================================================================
# Synthetic QKD Data Generation
# =============================================================================

def generate_synthetic_qkd_data(n_samples: int = 10000) -> pd.DataFrame:
    """Generate realistic synthetic QKD channel telemetry data."""
    rng = np.random.default_rng(42)

    records = []
    n_normal = int(n_samples * 0.85)
    n_anomalous = int(n_samples * 0.10)
    n_hardware = n_samples - n_normal - n_anomalous

    # Normal operation
    for _ in range(n_normal):
        qber = np.clip(rng.normal(0.022, 0.003), 0.005, 0.04)
        photon_loss_db = np.clip(rng.normal(3.5, 0.3), 2.0, 5.0)
        photon_detection_rate = np.clip(rng.normal(50000, 5000), 20000, 80000)
        raw_key_rate_bps = int(photon_detection_rate * 0.5)
        secret_key_rate_bps = int(raw_key_rate_bps * max(0, 1 - 2 * qber))
        records.append({
            "qber": qber,
            "photon_loss_db": photon_loss_db,
            "photon_detection_rate": photon_detection_rate,
            "raw_key_rate_bps": raw_key_rate_bps,
            "secret_key_rate_bps": secret_key_rate_bps,
            "label": "NORMAL",
        })

    # Anomalous (possible interception)
    for _ in range(n_anomalous):
        qber = np.clip(rng.normal(0.085, 0.020), 0.055, 0.14)
        photon_loss_db = np.clip(rng.normal(4.2, 0.5), 3.0, 6.5)
        photon_detection_rate = np.clip(rng.normal(35000, 8000), 5000, 55000)
        raw_key_rate_bps = int(photon_detection_rate * 0.5)
        secret_key_rate_bps = max(0, int(raw_key_rate_bps * max(0, 1 - 2 * qber)))
        records.append({
            "qber": qber,
            "photon_loss_db": photon_loss_db,
            "photon_detection_rate": photon_detection_rate,
            "raw_key_rate_bps": raw_key_rate_bps,
            "secret_key_rate_bps": secret_key_rate_bps,
            "label": "INTERCEPTION",
        })

    # Hardware degradation
    for _ in range(n_hardware):
        qber = np.clip(rng.normal(0.025, 0.005), 0.010, 0.045)
        photon_loss_db = np.clip(rng.normal(8.0, 1.5), 6.0, 12.0)
        photon_detection_rate = np.clip(rng.normal(8000, 2000), 1000, 15000)
        raw_key_rate_bps = int(photon_detection_rate * 0.5)
        secret_key_rate_bps = max(0, int(raw_key_rate_bps * max(0, 1 - 2 * qber)))
        records.append({
            "qber": qber,
            "photon_loss_db": photon_loss_db,
            "photon_detection_rate": photon_detection_rate,
            "raw_key_rate_bps": raw_key_rate_bps,
            "secret_key_rate_bps": secret_key_rate_bps,
            "label": "HARDWARE_FAULT",
        })

    df = pd.DataFrame(records)
    # Shuffle
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)
    return df

FEATURE_COLS = ["qber", "photon_loss_db", "photon_detection_rate", "raw_key_rate_bps", "secret_key_rate_bps"]

# =============================================================================
# 1. Isolation Forest
# =============================================================================

def train_isolation_forest(df: pd.DataFrame) -> None:
    X = df[FEATURE_COLS].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    iso_forest = IsolationForest(
        n_estimators=100,
        contamination=0.15,
        random_state=42,
        n_jobs=-1
    )
    iso_forest.fit(X_scaled)

    joblib.dump(scaler, MODELS_DIR / "scaler.joblib")
    joblib.dump(iso_forest, MODELS_DIR / "isolation_forest.joblib")
    logger.info("Isolation Forest & Scaler trained and saved")

# =============================================================================
# 2. Autoencoder (MLPRegressor)
# =============================================================================

def train_autoencoder(df: pd.DataFrame) -> None:
    df_normal = df[df["label"] == "NORMAL"]
    X_normal = df_normal[FEATURE_COLS].values

    scaler = joblib.load(MODELS_DIR / "scaler.joblib")
    X_scaled = scaler.transform(X_normal)

    n_features = len(FEATURE_COLS)

    autoencoder = MLPRegressor(
        hidden_layer_sizes=(16, 8, 4, 8, 16),
        activation="relu",
        solver="adam",
        max_iter=200,
        random_state=42,
        early_stopping=True,
    )
    autoencoder.fit(X_scaled, X_scaled)

    joblib.dump(autoencoder, MODELS_DIR / "autoencoder.joblib")
    logger.info("MLP Autoencoder trained and saved")

    reconstructed = autoencoder.predict(X_scaled)
    mse = np.mean((X_scaled - reconstructed) ** 2, axis=1)
    threshold = float(np.percentile(mse, 95))
    joblib.dump({"threshold": threshold, "n_features": n_features}, MODELS_DIR / "autoencoder_config.joblib")
    logger.info(f"Autoencoder anomaly threshold (95th pct): {threshold:.6f}")

# =============================================================================
# 3. TF-IDF Phishing Vectorizer
# =============================================================================

def train_tfidf_phishing() -> None:
    training_data = [
        ("URGENT: Verify your account immediately or access will be revoked", 1),
        ("Security Alert: Suspicious login attempt from unknown location", 1),
        ("Your password expires today. Click here to reset now", 1),
        ("Wire transfer confirmation required - action needed within 2 hours", 1),
        ("Unusual sign-in activity detected on your account", 1),
        ("Action Required: Update your payment information immediately", 1),
        ("IRS Notice: Tax refund available for collection", 1),
        ("Your package delivery is pending. Confirm details here", 1),
        ("Critical security patch needed for your workstation", 1),
        ("Payroll update: Confirm your direct deposit bank details", 1),
        ("Weekly team sync notes and project updates", 0),
        ("Quarterly financial report attached for review", 0),
        ("Discussion: Next sprint architecture planning", 0),
        ("Lunch meeting schedule for tomorrow", 0),
        ("Pull request review request: Add QKD telemetry endpoint", 0),
        ("Minutes from product strategy meeting", 0),
        ("Holiday calendar and office closure schedule", 0),
        ("Updated documentation for Fastify API routes", 0),
        ("Refactoring crypto service tests", 0),
        ("Reminder: All hands meeting at 3 PM today", 0),
    ]

    texts, labels = zip(*training_data)
    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), lowercase=True)),
        ("clf", LogisticRegression(random_state=42)),
    ])
    pipeline.fit(texts, labels)

    joblib.dump(pipeline, MODELS_DIR / "tfidf_phishing.joblib")
    logger.info("TF-IDF Phishing Classifier trained and saved")

if __name__ == "__main__":
    logger.info("Generating synthetic data...")
    df = generate_synthetic_qkd_data(10000)
    
    logger.info("Training models...")
    train_isolation_forest(df)
    train_autoencoder(df)
    train_tfidf_phishing()
    
    logger.success("All ML models trained and saved to models/")
