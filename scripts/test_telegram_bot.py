"""Pruebas de humo del bot, sin enviar mensajes reales a Telegram."""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import main


def run():
    sent = []

    async def fake_send(chat_id, text, buttons=None):
        sent.append((chat_id, text, buttons))

    group_start = {"message": {"chat": {"id": -100123, "type": "supergroup"},
                               "from": {"id": 44}, "text": "/start codigo"}}
    with patch.object(main, "telegram_send", fake_send), patch.object(main, "fetch_one", side_effect=AssertionError("No debe tocar la BD")):
        asyncio.run(main.telegram_handle_update(group_start))
    assert sent and "chat privado" in sent[0][1]

    sent.clear()
    with patch.object(main, "telegram_send", fake_send), patch.object(main, "telegram_user_for_chat", return_value=None):
        asyncio.run(main.telegram_handle_update({"message": {"chat": {"id": 123, "type": "private"},
                                                "from": {"id": 123}, "text": "/estado"}}))
    assert sent and "Vincula primero" in sent[0][1]

    timestamp = datetime.now(timezone.utc) - timedelta(minutes=15)
    room = {"salaNombre": "Sala 204", "pisoNombre": "Piso 2", "edificioNombre": "Mecánica",
            "sectorNombre": "Norte", "ventanaTimestamp": timestamp,
            "icgScore": None, "icgEstado": "parcial", "icaiScore": 2, "icaiEstado": "parcial",
            "ictScore": 0, "ictEstado": "completo", "co2": 1162.45, "pm25": None, "pm10": None,
            "temperatura": 23.44, "humedad": 51.52, "recomendaciones": ["Ventilar la sala."]}
    state = main.telegram_state_text(room)
    assert all(word in state for word in ("desactualizado", "ICG", "ICAI", "ICT", "CO₂", "PM₂.₅", "Ventilar"))
    alert = {"variable": "CO2", "nivel": 3, "valorMedido": 1400,
             "ventanaConfirmacion": timestamp, "resueltaEn": timestamp + timedelta(minutes=5)}
    text = main.telegram_alert_text(room, alert, {"recomendaciones": ["Abrir ventanas."]}, False)
    assert all(word in text for word in ("Malo", "Sala 204", "Mecánica", "Norte", "1.400,0 ppm", "Abrir ventanas"))
    assert "resuelta" in main.telegram_alert_text(room, alert, None, True)
    assert main.telegram_search_rooms([dict(room, salaId="sala")], "mecanica")[0]["salaId"] == "sala"
    admin = main.fetch_one('SELECT id,rol,"assignedEdificios" FROM usuarios WHERE rol=%s AND estado=%s LIMIT 1',
                           ("ADMIN", "activo"))
    if admin:
        authorized = main.telegram_authorized_rooms(admin)
        if authorized:
            current = main.telegram_room_state(authorized[0]["salaId"])
            assert current is not None
            assert "ICG" in main.telegram_state_text(current) or current["ventanaTimestamp"] is None
    column = main.fetch_one('''SELECT 1 AS ok FROM information_schema.columns
        WHERE table_name='telegram_preferencias_salas' AND column_name='pausadoHasta' ''')
    assert column and column["ok"] == 1
    print("Pruebas del bot: OK")


if __name__ == "__main__":
    run()
