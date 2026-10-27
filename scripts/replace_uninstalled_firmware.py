"""Reemplaza un binario de prueba sólo cuando ningún nodo usa la versión."""

import hashlib
import sys
from pathlib import Path

import main


version, file_path = sys.argv[1:3]
content = Path(file_path).read_bytes()
if not 0 < len(content) <= 1572864 or content[0] != 0xE9:
    raise SystemExit("Binario ESP32 inválido o mayor a 1,5 MiB")
digest = hashlib.sha256(content).hexdigest()
with main.db() as conn, conn.cursor() as cur:
    cur.execute('SELECT id,estado FROM firmwares WHERE version=%s FOR UPDATE', (version,))
    row = cur.fetchone()
    if row is None or row["estado"] != "prueba":
        raise SystemExit("La versión no existe o ya no está en prueba")
    cur.execute('SELECT COUNT(*) AS total FROM nodos WHERE "firmwareId"=%s', (row["id"],))
    if cur.fetchone()["total"]:
        raise SystemExit("Hay nodos asociados; se requiere publicar otra versión")
    cur.execute('''UPDATE firmwares SET "contenido"=%s,sha256=%s,"tamanoBytes"=%s,
        "rutaArchivo"=%s,"nombreArchivo"=%s,changelog=%s WHERE id=%s''',
        (content, digest, len(content), f"/data/firmwares/{version}-{digest[:12]}.bin",
         f"esp32_nodo_aira-{version}.bin",
         "Auditoría por ventana: medias exactas, subniveles, secuencia, persistencia, fallos y calibración conocida",
         row["id"]))
print(f"Actualizado {version}: {len(content)} bytes, SHA-256 {digest}")
