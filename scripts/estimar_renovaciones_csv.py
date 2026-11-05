"""Estima renovaciones de aire por decaimiento de CO2 en un CSV exportado.

Uso: python scripts/estimar_renovaciones_csv.py telemetria.csv --exterior-ppm 428
Señala tramos candidatos; no demuestra ausencia de fuentes interiores ni mezcla uniforme.
"""

import argparse
import csv
import math
from datetime import datetime
from pathlib import Path


def leer_ventanas(ruta: Path, exterior: float) -> list[tuple[datetime, float]]:
    """Selecciona ventanas verificadas y con CO2 diferencial positivo."""
    ventanas = []
    with ruta.open(encoding="utf-8-sig", newline="") as archivo:
        for fila in csv.DictReader(archivo):
            if fila.get("calidadHora") not in ("", "verificada", "verificado", None):
                continue
            if not fila.get("timestamp") or not fila.get("co2"):
                continue
            texto_hora = fila["timestamp"].replace("Z", "+00:00")
            if texto_hora.endswith("+00"):
                texto_hora += ":00"
            hora = datetime.fromisoformat(texto_hora)
            diferencial = float(fila["co2"]) - exterior
            if diferencial > 0:
                ventanas.append((hora, diferencial))
    return sorted(ventanas)


def estimar(tramo: list[tuple[datetime, float]]) -> tuple[float, float]:
    """Ajusta ln(Cint-Cext) = a - ACH*t con t expresado en horas."""
    origen = tramo[0][0]
    puntos = [((hora - origen).total_seconds() / 3600, math.log(valor)) for hora, valor in tramo]
    media_x = sum(x for x, _ in puntos) / len(puntos)
    media_y = sum(y for _, y in puntos) / len(puntos)
    xx = sum((x - media_x) ** 2 for x, _ in puntos)
    pendiente = sum((x - media_x) * (y - media_y) for x, y in puntos) / xx
    residual = sum((y - (media_y + pendiente * (x - media_x))) ** 2 for x, y in puntos)
    total = sum((y - media_y) ** 2 for _, y in puntos)
    return -pendiente, 1 - residual / total if total else 0


def tramos_candidatos(ventanas: list[tuple[datetime, float]], minimo: int) -> list[list[tuple[datetime, float]]]:
    """Separa caídas consecutivas y corta ante huecos de más de una ventana."""
    candidatos = []
    tramo = []
    for punto in ventanas:
        if tramo and ((punto[0] - tramo[-1][0]).total_seconds() > 360 or punto[1] >= tramo[-1][1]):
            if len(tramo) >= minimo:
                candidatos.append(tramo)
            tramo = []
        tramo.append(punto)
    if len(tramo) >= minimo:
        candidatos.append(tramo)
    return candidatos


def main() -> None:
    """Informa estimaciones con calidad de ajuste y supuestos visibles."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--exterior-ppm", type=float, required=True, help="CO2 exterior medido para el mismo periodo")
    parser.add_argument("--min-ventanas", type=int, default=4)
    args = parser.parse_args()
    if args.exterior_ppm < 0 or args.min_ventanas < 3:
        parser.error("Se requiere CO2 exterior no negativo y al menos 3 ventanas")
    ventanas = leer_ventanas(args.csv, args.exterior_ppm)
    for tramo in tramos_candidatos(ventanas, args.min_ventanas):
        ach, r2 = estimar(tramo)
        print(f"{tramo[0][0].isoformat()} a {tramo[-1][0].isoformat()}: {ach:.2f} renovaciones/h; R²={r2:.3f}; {len(tramo)} ventanas")
    print("Estimación exploratoria: verificar ausencia de fuentes interiores, mezcla uniforme y CO2 exterior antes de interpretarla.")


if __name__ == "__main__":
    main()
