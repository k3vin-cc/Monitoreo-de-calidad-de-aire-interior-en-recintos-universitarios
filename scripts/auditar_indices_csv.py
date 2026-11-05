"""Audita índices de exportaciones CSV de sala sin consultar la base de datos.

Uso: python scripts/auditar_indices_csv.py telemetria.csv
Sólo interpreta reglas-2026.1; las demás versiones se reportan como omitidas.
"""

import argparse
import csv
import json
from pathlib import Path


def nivel(valor: float, limites: tuple[float, ...]) -> int:
    """Devuelve el primer nivel cuyo límite superior supera el valor."""
    for posicion, limite in enumerate(limites):
        if valor < limite:
            return posicion
    return 4


def nivel_distancia(valor: float, minimo: float, maximo: float, paso: float) -> int:
    """Reproduce las bandas cerradas de temperatura y humedad del firmware."""
    distancia = max(minimo - valor, 0, valor - maximo)
    if distancia <= 0:
        return 0
    for resultado in (1, 2, 3):
        if distancia <= paso * resultado:
            return resultado
    return 4


def datos_de_fila(fila: dict[str, str]) -> dict[str, float | None]:
    """Lee las cinco medias sólo si alcanzaron las 24 muestras reglamentarias."""
    conteos = json.loads(fila.get("conteosValidos") or "{}")
    datos = {}
    for nombre in ("co2", "pm25", "pm10", "temperatura", "humedad"):
        texto = fila.get(nombre)
        datos[nombre] = float(texto) if texto and int(conteos.get(nombre, 0)) >= 24 else None
    return datos


def auditar_fila(fila: dict[str, str]) -> list[str]:
    """Compara subniveles y dominios con el cálculo explícito de reglas-2026.1."""
    datos = datos_de_fila(fila)
    subniveles = {
        "co2": nivel(datos["co2"], (800, 1000, 1500, 2000)) if datos["co2"] is not None else None,
        "pm25": nivel(datos["pm25"] / 15, (0.5, 1, 2, 4)) if datos["pm25"] is not None else None,
        "pm10": nivel(datos["pm10"] / 45, (0.5, 1, 2, 4)) if datos["pm10"] is not None else None,
        "temperatura": nivel_distancia(datos["temperatura"], 20, 24, 2) if datos["temperatura"] is not None else None,
        "humedad": nivel_distancia(datos["humedad"], 30, 60, 10) if datos["humedad"] is not None else None,
    }
    errores = []
    guardados = json.loads(fila.get("subniveles") or "{}")
    for clave, esperado in subniveles.items():
        if clave in guardados and guardados[clave] != esperado:
            errores.append(f"subniveles.{clave}: {guardados[clave]} != {esperado}")
    resultados = {}
    for prefijo, claves in (("icai", ("co2", "pm25", "pm10")), ("ict", ("temperatura", "humedad"))):
        disponibles = [subniveles[clave] for clave in claves if subniveles[clave] is not None]
        estado = "dato_insuficiente" if not disponibles else "completo" if len(disponibles) == len(claves) else "parcial"
        puntuacion = max(disponibles) if disponibles else None
        resultados[prefijo] = (estado, puntuacion)
        if fila.get(f"{prefijo}Estado") != estado:
            errores.append(f"{prefijo}Estado: {fila.get(f'{prefijo}Estado')} != {estado}")
        guardada = fila.get(f"{prefijo}Score")
        if (int(guardada) if guardada else None) != puntuacion:
            errores.append(f"{prefijo}Score: {guardada} != {puntuacion}")
    icai = resultados["icai"][0] == "completo"
    ict = resultados["ict"][0] == "completo"
    estado_global = "completo" if icai and ict else "parcial" if icai or ict else "dato_insuficiente"
    if fila.get("icgEstado") != estado_global:
        errores.append(f"icgEstado: {fila.get('icgEstado')} != {estado_global}")
    if estado_global == "completo":
        esperado = max(resultados["icai"][1], resultados["ict"][1])
        if fila.get("icgScore") != str(esperado):
            errores.append(f"icgScore: {fila.get('icgScore')} != {esperado}")
    return errores


def main() -> None:
    """Recorre la exportación y muestra cada discrepancia con número de fila."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    args = parser.parse_args()
    revisadas = omitidas = discrepancias = 0
    with args.csv.open(encoding="utf-8-sig", newline="") as archivo:
        for numero, fila in enumerate(csv.DictReader(archivo), start=2):
            if fila.get("versionReglas") != "reglas-2026.1":
                omitidas += 1
                continue
            revisadas += 1
            for error in auditar_fila(fila):
                discrepancias += 1
                print(f"Fila {numero}, ventana {fila.get('timestamp')}: {error}")
    print(f"Ventanas revisadas: {revisadas}; omitidas: {omitidas}; discrepancias: {discrepancias}")
    if discrepancias:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
