"""Revisa archivos preparados para Git antes de publicar; no imprime secretos."""

from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run(
    ["git", "diff", "--cached", "--diff-filter=ACMR", "--name-only", "-z"],
    cwd=ROOT,
    capture_output=True,
    check=True,
)
paths = [Path(p.decode("utf-8")) for p in result.stdout.split(b"\0") if p]
if not paths:
    print("No hay archivos preparados para publicar.")
    sys.exit(1)

denied_names = {"secrets.h", ".env"}
denied_parts = {"node_modules", "dist", "__pycache__", "certs", ".tools"}
denied_suffixes = {".key", ".pem", ".p12", ".pfx", ".bin", ".elf", ".csv", ".kubeconfig"}
patterns = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b"),  # Telegram bot token
    re.compile(r"(?i)(?:password|secret|token|api[_-]?key)\s*[:=]\s*['\"](?!\s*['\"])[^'\"]{12,}['\"]"),
    re.compile(r"(?i)(?:postgres(?:ql)?|mqtt)://[^\s/@:]+:[^\s/@]+@"),
    re.compile(r"(?i)/(?:home|Users)/[^/\s]+"),
    re.compile(r"(?i)\b[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+"),
    re.compile(r"(?i)\b[\w.+-]+@(?!example\.(?:org|com|net)\b)[\w.-]+\.[a-z]{2,}\b"),
    re.compile(r"(?<![\d.])(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])"),
]

known_values = []
local_header = ROOT / "esp32_nodo_aira" / "secrets.h"
if local_header.exists():
    for value in re.findall(r'^#define\s+\w+\s+"([^"]+)"', local_header.read_text(encoding="utf-8"), re.M):
        if len(value) >= 8 and value not in {"00:00:00:00:00:00"}:
            known_values.append(value)

issues = []
for relative in paths:
    path = ROOT / relative
    if (relative.name in denied_names or any(part in denied_parts for part in relative.parts)
            or relative.suffix.lower() in denied_suffixes):
        issues.append(f"{relative}: ruta prohibida")
        continue
    data = path.read_bytes()
    if len(data) > 5_000_000:
        issues.append(f"{relative}: archivo mayor a 5 MB; revisar manualmente")
        continue
    if b"\0" in data[:4096]:
        continue  # imagen binaria documentada; revisar contenido visual por separado
    content = data.decode("utf-8", errors="replace")
    for index, line in enumerate(content.splitlines(), 1):
        if any(pattern.search(line) for pattern in patterns) or any(value in line for value in known_values):
            issues.append(f"{relative}:{index}: posible credencial")

for issue in issues:
    print(issue)
if issues:
    print(f"Revisión fallida: {len(issues)} hallazgo(s).")
    sys.exit(1)
print(f"Revisión básica correcta: {len(paths)} archivos preparados. Revisar también diffs e imágenes manualmente.")
