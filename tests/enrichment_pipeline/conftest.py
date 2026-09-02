from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[2] / "enrichment_pipeline"
sys.path.insert(0, str(PROJECT_ROOT))
