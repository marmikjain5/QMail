import os
import random
import numpy as np
from sklearn.ensemble import IsolationForest
import joblib

def generate_normal_telemetry(num_samples=3000):
    """
    Generates telemetry dataset representing healthy normal QKD simulation sessions.
    
    Features:
    0: qber (0.010 to 0.045)
    1: photonLossRate (0.015 to 0.065)
    2: detectionRate (1.0 - photonLossRate)
    3: keyGenerationRate (420.0 to 530.0 bps)
    """
    X = []
    np.random.seed(42)
    
    for _ in range(num_samples):
        # Small Gaussian variations around normal operating center
        qber = float(np.clip(np.random.normal(loc=0.025, scale=0.008), 0.005, 0.048))
        loss = float(np.clip(np.random.normal(loc=0.035, scale=0.010), 0.010, 0.068))
        detection = float(1.0 - loss)
        key_rate = float(np.clip(np.random.normal(loc=480.0, scale=25.0), 400.0, 550.0))
        
        X.append([qber, loss, detection, key_rate])
        
    return np.array(X)

def train_and_save():
    print("[ML Training] Generating normal QKD telemetry dataset...")
    X_train = generate_normal_telemetry(3000)
    
    print(f"[ML Training] Dataset generated with {len(X_train)} normal samples.")
    print(f"[ML Training] Feature statistics:")
    print(f"  QBER: min={X_train[:, 0].min():.4f}, max={X_train[:, 0].max():.4f}, mean={X_train[:, 0].mean():.4f}")
    print(f"  Loss: min={X_train[:, 1].min():.4f}, max={X_train[:, 1].max():.4f}, mean={X_train[:, 1].mean():.4f}")
    print(f"  Detection: min={X_train[:, 2].min():.4f}, max={X_train[:, 2].max():.4f}, mean={X_train[:, 2].mean():.4f}")
    print(f"  Key Rate: min={X_train[:, 3].min():.1f}, max={X_train[:, 3].max():.1f}, mean={X_train[:, 3].mean():.1f}")
    
    # Train Isolation Forest on normal telemetry
    model = IsolationForest(
        n_estimators=150,
        contamination=0.01,
        max_samples='auto',
        random_state=42
    )
    
    print("[ML Training] Training IsolationForest model...")
    model.fit(X_train)
    
    # Output path
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, "qkd_isolation_forest.joblib")
    
    joblib.dump(model, model_path)
    print(f"[ML Training] Model saved successfully to: {model_path}")
    
    # Quick sanity check predictions
    test_normal = np.array([[0.022, 0.031, 0.969, 490.0]])
    test_attack = np.array([[0.220, 0.350, 0.650, 180.0]])
    
    pred_normal = model.predict(test_normal)[0]
    score_normal = model.decision_function(test_normal)[0]
    
    pred_attack = model.predict(test_attack)[0]
    score_attack = model.decision_function(test_attack)[0]
    
    print(f"[ML Training Test] Normal sample -> Prediction: {'NORMAL' if pred_normal == 1 else 'ANOMALY'} (Score: {score_normal:.4f})")
    print(f"[ML Training Test] Attacker sample -> Prediction: {'NORMAL' if pred_attack == 1 else 'ANOMALY'} (Score: {score_attack:.4f})")

if __name__ == "__main__":
    train_and_save()
