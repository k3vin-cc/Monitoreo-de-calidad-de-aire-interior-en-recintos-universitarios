"""Genera el ConfigMap del API desde fuentes versionadas, sin credenciales."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / "k8s" / "04-api-code.yaml"
manifest = {
    "apiVersion": "v1",
    "kind": "ConfigMap",
    "metadata": {"name": "calidad-api-code", "namespace": "aira"},
    "data": {
        "main.py": (ROOT / "api" / "main.py").read_text(encoding="utf-8"),
        "requirements.txt": (ROOT / "api" / "requirements.txt").read_text(encoding="utf-8"),
    },
}
manifest_path.write_text(yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")
print("Generado", manifest_path.name)
