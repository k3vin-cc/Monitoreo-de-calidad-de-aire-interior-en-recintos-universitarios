"""Comprueba el binario que entrega la función de descarga de la API."""

import hashlib
import sys

from main import download_firmware


def main() -> None:
    firmware_id, expected_hash = sys.argv[1:3]
    response = download_firmware(firmware_id, user={"rol": "ADMIN"})
    if response.headers.get("cache-control") != "no-store":
        raise SystemExit("La descarga no impide el almacenamiento en caché")
    digest = hashlib.sha256(response.body).hexdigest()
    if digest != expected_hash:
        raise SystemExit(f"SHA-256 inesperado: {digest}")
    print(f"Descarga verificada: {len(response.body)} bytes; SHA-256 {digest}")


if __name__ == "__main__":
    main()
