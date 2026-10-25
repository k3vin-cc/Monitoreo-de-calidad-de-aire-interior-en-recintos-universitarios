"""Create the first administrator without putting its password in a file or shell history."""

from __future__ import annotations

import argparse
import getpass
import os

import bcrypt
import psycopg


def main() -> None:
    parser = argparse.ArgumentParser(description="Crear el primer administrador en una base nueva")
    parser.add_argument("--name", required=True, help="Nombre visible")
    parser.add_argument("--email", required=True, help="Correo de acceso")
    args = parser.parse_args()

    name = args.name.strip()
    email = args.email.strip().lower()
    if not name or "@" not in email or len(email) > 100:
        parser.error("Indica un nombre y un correo válidos")

    password = getpass.getpass("Nueva contraseña (12 a 72 caracteres): ")
    if not 12 <= len(password) <= 128 or len(password.encode("utf-8")) > 72:
        parser.error("La contraseña debe tener 12–128 caracteres y hasta 72 bytes UTF-8")
    if password != getpass.getpass("Repite la contraseña: "):
        parser.error("Las contraseñas no coinciden")

    with psycopg.connect(
        host=os.getenv("DB_HOST", "localhost"),
        dbname=os.getenv("DB_NAME", "postgres"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", ""),
    ) as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM usuarios WHERE rol='ADMIN' AND estado='activo' LIMIT 1")
        if cur.fetchone():
            raise SystemExit("Ya existe un administrador activo; gestiona usuarios desde la web")
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")
        cur.execute(
            "INSERT INTO usuarios(nombre,email,rol,password) VALUES (%s,%s,'ADMIN',%s) RETURNING id",
            (name, email, hashed),
        )
        admin_id = cur.fetchone()[0]
    print(f"Administrador inicial creado: {email} (id {admin_id})")


if __name__ == "__main__":
    main()
