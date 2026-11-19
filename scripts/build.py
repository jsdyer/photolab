"""Build the static Photo Lab workbench."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / "dist"
if target.exists():
    shutil.rmtree(target)
shutil.copytree(ROOT / "web", target)
print("Built Photo Lab.")
