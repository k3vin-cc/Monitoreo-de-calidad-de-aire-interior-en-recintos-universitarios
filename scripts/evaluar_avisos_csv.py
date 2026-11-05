"""Compara avisos confirmados con una bitácora CSV de eventos observados.

Uso: python scripts/evaluar_avisos_csv.py avisos.csv eventos.csv --tolerancia-min 15
Avisos: salaId,variable,confirmadaEn. Eventos: salaId,variable,inicio,fin.
Cada evento y cada aviso se emparejan como máximo una vez por sala y variable.
Si un episodio anotado produce dos avisos, el segundo cuenta como falso positivo.
"""

import argparse
import csv
from datetime import datetime, timedelta
from pathlib import Path


def leer_csv(ruta: Path, campos: tuple[str, ...]) -> list[dict]:
    """Lee el archivo y exige explícitamente las columnas esperadas."""
    with ruta.open(encoding="utf-8-sig", newline="") as archivo:
        lector = csv.DictReader(archivo)
        if not set(campos).issubset(lector.fieldnames or []):
            raise ValueError(f"{ruta}: faltan columnas {set(campos) - set(lector.fieldnames or [])}")
        return list(lector)


def fecha(texto: str) -> datetime:
    """Interpreta un instante ISO 8601 con zona horaria obligatoria."""
    texto = texto.replace("Z", "+00:00")
    if texto.endswith("+00"):
        texto += ":00"
    valor = datetime.fromisoformat(texto)
    if valor.utcoffset() is None:
        raise ValueError(f"Falta zona horaria en {texto}")
    return valor


def evaluar(avisos: list[dict], eventos: list[dict], tolerancia: timedelta) -> tuple[int, int, int, list[float]]:
    """Empareja cronológicamente un aviso con el primer evento compatible libre."""
    eventos_ordenados = sorted(eventos, key=lambda fila: fecha(fila["inicio"]))
    avisos_ordenados = sorted(avisos, key=lambda fila: fecha(fila["confirmadaEn"]))
    usados = set()
    latencias = []
    falsos_positivos = 0
    for aviso in avisos_ordenados:
        instante = fecha(aviso["confirmadaEn"])
        candidato = None
        for indice, evento in enumerate(eventos_ordenados):
            if indice in usados or evento["salaId"] != aviso["salaId"] or evento["variable"] != aviso["variable"]:
                continue
            inicio, fin = fecha(evento["inicio"]), fecha(evento["fin"])
            if inicio - tolerancia <= instante <= fin + tolerancia:
                candidato = indice
                break
        if candidato is None:
            falsos_positivos += 1
        else:
            usados.add(candidato)
            latencias.append((instante - fecha(eventos_ordenados[candidato]["inicio"])).total_seconds() / 60)
    return len(usados), falsos_positivos, len(eventos) - len(usados), latencias


def main() -> None:
    """Presenta precisión, sensibilidad y latencia de los emparejamientos."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("avisos", type=Path)
    parser.add_argument("eventos", type=Path)
    parser.add_argument("--tolerancia-min", type=float, default=15)
    args = parser.parse_args()
    if args.tolerancia_min < 0:
        parser.error("La tolerancia debe ser no negativa")
    avisos = leer_csv(args.avisos, ("salaId", "variable", "confirmadaEn"))
    eventos = leer_csv(args.eventos, ("salaId", "variable", "inicio", "fin"))
    verdaderos, falsos, omitidos, latencias = evaluar(avisos, eventos, timedelta(minutes=args.tolerancia_min))
    precision = verdaderos / (verdaderos + falsos) if verdaderos + falsos else None
    sensibilidad = verdaderos / (verdaderos + omitidos) if verdaderos + omitidos else None
    print(f"VP={verdaderos}; FP={falsos}; FN={omitidos}")
    print(f"Precisión: {precision:.3f}" if precision is not None else "Precisión: no definida")
    print(f"Sensibilidad: {sensibilidad:.3f}" if sensibilidad is not None else "Sensibilidad: no definida")
    print(f"Latencia media: {sum(latencias) / len(latencias):.1f} min" if latencias else "Latencia: sin emparejamientos")
    print("El resultado depende de la calidad de la bitácora y del criterio de tolerancia declarado.")


if __name__ == "__main__":
    main()
