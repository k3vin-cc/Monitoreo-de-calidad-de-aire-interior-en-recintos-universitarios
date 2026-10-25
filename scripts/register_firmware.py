"""Register a compiled ESP32 firmware in the persistent firmware catalog."""

import hashlib
import os
import sys
from pathlib import Path

import psycopg


def main() -> None:
    version, rules_version, filename, path = sys.argv[1:5]
    status = sys.argv[5] if len(sys.argv) > 5 else "oficial"
    changelog = sys.argv[6] if len(sys.argv) > 6 else (
        "Guarda cada ventana en LittleFS antes del envío y la conserva hasta recibir PUBACK; "
        "retransmite en orden tras fallos MQTT."
    )
    if status not in {"oficial", "prueba", "obsoleta"}:
        raise SystemExit("El estado debe ser oficial, prueba u obsoleta")
    content = Path(path).read_bytes()
    if not 0 < len(content) <= 1572864 or content[0] != 0xE9:
        raise SystemExit("El archivo no es un binario ESP32 válido de hasta 1,5 MiB")
    digest = hashlib.sha256(content).hexdigest()
    stored_path = f"/data/firmwares/{version}-{digest[:12]}.bin"
    with psycopg.connect(
        host=os.getenv("DB_HOST", "calidad-db"),
        dbname=os.getenv("DB_NAME", "postgres"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", ""),
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''INSERT INTO firmwares (version,"versionReglas","nombreArchivo","rutaArchivo",
                   "tamanoBytes",sha256,"contenido",estado,changelog)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   RETURNING id,version,"tamanoBytes",sha256''',
                (version, rules_version, filename, stored_path, len(content), digest, content, status, changelog),
            )
            row = cur.fetchone()
    print(f"Registrado firmware {row[1]}: id={row[0]}, {row[2]} bytes, SHA-256 {row[3].strip()}")


if __name__ == "__main__":
    main()
