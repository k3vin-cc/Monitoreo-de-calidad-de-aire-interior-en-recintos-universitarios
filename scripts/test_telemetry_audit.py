"""Comprueba esquema y contrato v1.0.8 sin insertar telemetría real."""

import inspect
import re
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

import main


def run():
    now = datetime.now(timezone.utc)
    raw = {
        "nodoId": "nodo-prueba", "salaId": "sala-prueba", "horaVerificada": True,
        "timestamp": now.isoformat(), "ordenRegistro": 42,
        "ventanaId": "nodo-prueba:42", "ventanaInicio": now.isoformat(),
        "ventanaFinReal": now.isoformat(), "firmwareVersion": "v1.0.8",
        "conteosValidos": {"co2": 30}, "versionReglas": "reglas-2026.1",
        "icaiEstado": "parcial", "ictEstado": "completo", "icgEstado": "parcial",
        "mediasClasificacion": {"humedad": 59.99999619},
        "subniveles": {"humedad": 0},
        "persistencia": {"ventanaAnteriorId": "nodo-prueba:41", "confirmada": False,
                         "motivo": "anterior_incompleta"},
        "invalidaciones": {"pm25": {"sinLectura": 30}},
        "calibracion": {"compensacionTermicaFirmwareC": 0,
                        "calibracionInternaSensor": "no_leida"},
    }
    packet = main.TelemetryPacket.model_validate(raw)
    assert packet.medias_clasificacion["humedad"] == 59.99999619
    legacy = {key: value for key, value in raw.items() if key not in (
        "ventanaId", "ventanaInicio", "ventanaFinReal", "firmwareVersion",
        "mediasClasificacion", "subniveles", "persistencia", "invalidaciones", "calibracion")}
    assert main.TelemetryPacket.model_validate(legacy).firmware_version is None
    source = inspect.getsource(main.persist_packet)
    sql = re.search(r"cur.execute\('''(INSERT INTO telemetria \(.*?DO NOTHING)'''", source, re.S).group(1)
    values = (
        packet.sala_id, packet.nodo_id, packet.timestamp, Jsonb(packet.conteos_validos),
        packet.version_reglas, 0, False, None, None, None, None, None,
        None, None, "parcial", None, None, None, "completo", None,
        None, None, "parcial", None, None, None,
        packet.ventana_id, packet.ventana_inicio, packet.ventana_fin_real,
        packet.orden_registro, packet.firmware_version,
        Jsonb(packet.medias_clasificacion), Jsonb(packet.subniveles),
        Jsonb(packet.persistencia), Jsonb(packet.invalidaciones), Jsonb(packet.calibracion),
    )
    assert sql.count("%s") == len(values) == 36
    with main.db() as conn, conn.cursor() as cur:
        cur.execute("EXPLAIN " + sql, values)
        assert cur.fetchall()
    print("Contrato de auditoría y SQL: OK")


if __name__ == "__main__":
    run()
