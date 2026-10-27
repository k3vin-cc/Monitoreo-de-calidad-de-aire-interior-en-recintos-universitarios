"""Genera el ConfigMap de inicialización de TimescaleDB desde el SQL versionado."""

from pathlib import Path
import os

import yaml

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "contenido" / "base de datos" / "schema_timescaledb.sql"
target = ROOT / "k8s" / "02-db-init.yaml"
manifest = {
    "apiVersion": "v1",
    "kind": "ConfigMap",
    "metadata": {"name": "calidad-db-init", "namespace": os.getenv("AIRA_K8S_NAMESPACE", "aira")},
    "data": {"01_schema.sql": source.read_text(encoding="utf-8")},
}
target.write_text(yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")
print("Generado", target.name)
