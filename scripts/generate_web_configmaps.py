"""Regenera los ConfigMaps de la web desde web/dist tras npm run build."""

from base64 import b64encode
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "web" / "dist"
K8S = ROOT / "k8s"


def configmap(name):
    return {"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": name, "namespace": "aira"}, "data": {}, "binaryData": {}}


core = configmap("calidad-web-core")
assets = configmap("calidad-web-assets")
core["data"]["index.html"] = (DIST / "index.html").read_text(encoding="utf-8")
core["data"]["nginx.conf"] = (ROOT / "web" / "nginx.conf").read_text(encoding="utf-8")

for path in sorted((DIST / "assets").iterdir()):
    key = f"asset__{path.name}"
    target = core if path.suffix in {".woff", ".woff2", ".css"} else assets
    if path.suffix in {".woff", ".woff2"}:
        target["binaryData"][key] = b64encode(path.read_bytes()).decode("ascii")
    else:
        target["data"][key] = path.read_text(encoding="utf-8")

for manifest, name in [(core, "05-web-core.yaml"), (assets, "05-web-assets.yaml")]:
    if not manifest["binaryData"]:
        del manifest["binaryData"]
    (K8S / name).write_text(yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")
    print(name, len(manifest.get("data", {})), "textos,", len(manifest.get("binaryData", {})), "binarios")
