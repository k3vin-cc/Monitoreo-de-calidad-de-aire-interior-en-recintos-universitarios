"""Migra un firmware existente del disco temporal a PostgreSQL.

Ejecutar dentro del pod API, con sus variables de conexión a la base de datos.
"""

import hashlib
import os
import sys
from pathlib import Path

import psycopg


def main() -> None:
    firmware_id, filename = sys.argv[1:3]
    content = Path(filename).read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    with psycopg.connect(
        host=os.getenv("DB_HOST", "calidad-db"),
        dbname=os.getenv("DB_NAME", "postgres"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", ""),
    ) as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT sha256,"tamanoBytes" FROM firmwares WHERE id=%s', (firmware_id,))
            row = cur.fetchone()
            if not row or row[0].strip() != digest or row[1] != len(content):
                raise SystemExit("El archivo no coincide con el registro del firmware")
            cur.execute('UPDATE firmwares SET "contenido"=%s WHERE id=%s', (content, firmware_id))
            cur.execute('SELECT octet_length("contenido") FROM firmwares WHERE id=%s', (firmware_id,))
            if cur.fetchone()[0] != len(content):
                raise SystemExit("La copia persistente tiene un tamaño incorrecto")
    print(f"Firmware persistido: {len(content)} bytes; SHA-256 {digest}")


if __name__ == "__main__":
    main()
