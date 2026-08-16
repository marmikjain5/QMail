import os
import sys
from pathlib import Path
from loguru import logger

def ensure_models_exist():
    models_dir = Path("models")
    required_files = [
        "isolation_forest.joblib",
        "scaler.joblib",
        "autoencoder_config.joblib",
        "autoencoder.weights.h5",
        "tfidf_phishing.joblib"
    ]
    
    missing = [f for f in required_files if not (models_dir / f).exists()]
    
    if missing:
        logger.warning(f"Missing ML models: {missing}")
        logger.info("Running model_train.py to generate models...")
        
        # Run training script
        import subprocess
        result = subprocess.run([sys.executable, "model_train.py"])
        
        if result.returncode != 0:
            logger.error("Model training failed!")
            sys.exit(1)
            
        logger.success("Models generated successfully.")
    else:
        logger.info("All ML models found.")

if __name__ == "__main__":
    logger.info("Starting QuMail ML Sidecar...")
    
    # 1. Ensure models are trained
    ensure_models_exist()
    
    # 2. Start Uvicorn server
    logger.info("Starting FastAPI server on port 8001...")
    import uvicorn
    uvicorn.run("api_server:app", host="0.0.0.0", port=8001, reload=True)
