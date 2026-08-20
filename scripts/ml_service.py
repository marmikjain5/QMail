import sys
import os
import json
import numpy as np
import joblib

def load_model():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, "qkd_isolation_forest.joblib")
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Trained ML model file not found at {model_path}. Please run train_qkd_ml.py first.")
    return joblib.load(model_path)

def predict_telemetry(model, telemetry):
    """
    telemetry dict: {
        'qber': float,
        'photonLossRate': float,
        'detectionRate': float,
        'keyGenerationRate': float
    }
    """
    qber = float(telemetry.get("qber", 0.0))
    loss = float(telemetry.get("photonLossRate", 0.0))
    detection = float(telemetry.get("detectionRate", 0.0))
    key_rate = float(telemetry.get("keyGenerationRate", 0.0))
    
    features = np.array([[qber, loss, detection, key_rate]])
    
    raw_pred = model.predict(features)[0]  # 1 for inlier (NORMAL), -1 for outlier (ANOMALY)
    score = float(model.decision_function(features)[0])
    
    is_anomaly = bool(raw_pred == -1)
    prediction_label = "ANOMALY" if is_anomaly else "NORMAL"
    
    return {
        "prediction": prediction_label,
        "anomalyScore": round(score, 4),
        "isAnomaly": is_anomaly
    }

def run_cli_inference(telemetry_json_str):
    try:
        model = load_model()
        telemetry = json.loads(telemetry_json_str)
        result = predict_telemetry(model, telemetry)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e), "prediction": "ANOMALY", "anomalyScore": -1.0, "isAnomaly": True}))
        sys.exit(1)

def run_http_server(port=5001):
    from http.server import HTTPServer, BaseHTTPRequestHandler
    
    model = load_model()
    print(f"[ML Service] Loaded IsolationForest model.")
    print(f"[ML Service] Starting HTTP server on http://localhost:{port}...")
    
    class PredictHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            if self.path == "/predict":
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                try:
                    telemetry = json.loads(body.decode("utf-8"))
                    res = predict_telemetry(model, telemetry)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(res).encode("utf-8"))
                except Exception as e:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()
                
        def log_message(self, format, *args):
            return

    server = HTTPServer(("0.0.0.0", port), PredictHandler)
    server.serve_forever()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--server":
            port = int(sys.argv[2]) if len(sys.argv) > 2 else 5001
            run_http_server(port)
        else:
            run_cli_inference(sys.argv[1])
    else:
        input_data = sys.stdin.read().strip()
        if input_data:
            run_cli_inference(input_data)
        else:
            print("Usage: python ml_service.py '<telemetry_json>' or python ml_service.py --server [port]")
