"""API and MQTT ingestion service for the indoor air-quality platform."""
from __future__ import annotations

import asyncio
import csv
import difflib
import hashlib
import io
import json
import logging
import os
import re
import secrets
import threading
import unicodedata
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import bcrypt
import jwt
import paho.mqtt.client as mqtt
import psycopg
from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("calidad-api")
DB_HOST = os.getenv("DB_HOST", "calidad-db")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
JWT_SECRET = os.getenv("JWT_SECRET_KEY", "")
MQTT_HOST = os.getenv("MQTT_HOST", "calidad-mqtt")
MQTT_USER = os.getenv("MQTT_USERNAME", "api")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
PUBLIC_WEB_URL = os.getenv("PUBLIC_WEB_URL", "").rstrip("/")
FIRMWARE_DIR = Path(os.getenv("FIRMWARE_DIR", "/data/firmwares"))
ACCESS_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "30"))
REFRESH_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "7"))
SESSION_IDLE_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "30"))
if not JWT_SECRET:
    log.warning("JWT_SECRET_KEY no está configurada; los endpoints de autenticación rechazarán solicitudes")


def db():
    return psycopg.connect(host=DB_HOST, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD, connect_timeout=5, row_factory=dict_row)


def fetch_one(sql: str, params: tuple = ()):
    with db() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def fetch_all(sql: str, params: tuple = ()):
    with db() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def execute(sql: str, params: tuple = ()):
    with db() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


class LoginIn(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=256)


class RefreshIn(BaseModel):
    refreshToken: str | None = None


class TelemetryPacket(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    nodo_id: str = Field(alias="nodoId", min_length=1, max_length=36)
    sala_id: str | None = Field(default=None, alias="salaId", max_length=36)
    hora_verificada: bool = Field(alias="horaVerificada")
    timestamp: datetime | None = None
    orden_registro: int | None = Field(default=None, alias="ordenRegistro", ge=0)
    ventana_id: str | None = Field(default=None, alias="ventanaId", max_length=80)
    ventana_inicio: datetime | None = Field(default=None, alias="ventanaInicio")
    ventana_fin_real: datetime | None = Field(default=None, alias="ventanaFinReal")
    firmware_version: str | None = Field(default=None, alias="firmwareVersion", max_length=20)
    medias_clasificacion: dict[str, float | None] | None = Field(default=None, alias="mediasClasificacion")
    subniveles: dict[str, int | None] | None = None
    persistencia: dict[str, Any] | None = None
    invalidaciones: dict[str, Any] | None = None
    calibracion: dict[str, Any] | None = None
    conteos_validos: dict[str, int] = Field(default_factory=dict, alias="conteosValidos")
    version_reglas: str = Field(default="desconocida", alias="versionReglas", max_length=20)
    ventanas_descartadas: int = Field(default=0, alias="ventanasDescartadas", ge=0)
    es_retransmision: bool = Field(default=False, alias="esRetransmision")
    co2: float | None = Field(default=None, ge=0, le=40000)
    pm25: float | None = Field(default=None, ge=0)
    pm10: float | None = Field(default=None, ge=0)
    temperatura: float | None = Field(default=None, ge=-20, le=60)
    humedad: float | None = Field(default=None, ge=0, le=100)
    icai_score: int | None = Field(default=None, alias="icaiScore", ge=0, le=4)
    icai_categoria: str | None = Field(default=None, alias="icaiCategoria")
    icai_estado: Literal["completo", "parcial", "dato_insuficiente"] = Field(alias="icaiEstado")
    causas_icai: list[str] | None = Field(default=None, alias="causasICAI")
    ict_score: int | None = Field(default=None, alias="ictScore", ge=0, le=4)
    ict_categoria: str | None = Field(default=None, alias="ictCategoria")
    ict_estado: Literal["completo", "parcial", "dato_insuficiente"] = Field(alias="ictEstado")
    causas_ict: list[str] | None = Field(default=None, alias="causasICT")
    icg_score: int | None = Field(default=None, alias="icgScore", ge=0, le=4)
    icg_categoria: str | None = Field(default=None, alias="icgCategoria")
    icg_estado: Literal["completo", "parcial", "dato_insuficiente"] = Field(alias="icgEstado")
    causas_icg: list[str] | None = Field(default=None, alias="causasICG")
    celda_matriz: str | None = Field(default=None, alias="celdaMatriz", max_length=5)
    recomendaciones: list[str] | None = None

    @field_validator("timestamp", "ventana_inicio", "ventana_fin_real")
    @classmethod
    def timestamp_is_aware(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("timestamp debe incluir zona horaria")
        return value


class UserIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=100)
    telefono: str | None = Field(default=None, max_length=20)
    rol: Literal["ADMIN", "ANALISTA", "VIEWER", "GUEST"]
    password: str = Field(min_length=12, max_length=128)
    edificios: list[str] = Field(default_factory=list)


class UserPatch(BaseModel):
    nombre: str | None = Field(default=None, max_length=100)
    telefono: str | None = Field(default=None, max_length=20)
    rol: Literal["ADMIN", "ANALISTA", "VIEWER", "GUEST"] | None = None
    estado: Literal["activo", "inactivo"] | None = None
    password: str | None = Field(default=None, min_length=12, max_length=128)
    edificios: list[str] | None = None


class FirmwarePatch(BaseModel):
    estado: Literal["oficial", "prueba", "obsoleta"] | None = None
    changelog: str | None = None


class NodeIn(BaseModel):
    id: str | None = Field(default=None, min_length=1, max_length=36)
    nombre: str = Field(min_length=1, max_length=100)
    salaId: str | None = None
    firmware: str = Field(default="v1.0.0", max_length=20)

    @field_validator("nombre")
    @classmethod
    def normalize_node_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre del nodo no puede quedar vacío")
        return value


class SectorIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    descripcion: str | None = None


class SectorPatch(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    descripcion: str | None = None


class BuildingIn(BaseModel):
    sectorId: str = Field(min_length=1, max_length=36)
    nombre: str = Field(min_length=1, max_length=100)
    direccion: str | None = Field(default=None, max_length=200)


class BuildingPatch(BaseModel):
    sectorId: str | None = Field(default=None, min_length=1, max_length=36)
    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    direccion: str | None = Field(default=None, max_length=200)


class FloorIn(BaseModel):
    edificioId: str = Field(min_length=1, max_length=36)
    nombre: str = Field(min_length=1, max_length=50)
    nivel: int


class FloorPatch(BaseModel):
    edificioId: str | None = Field(default=None, min_length=1, max_length=36)
    nombre: str | None = Field(default=None, min_length=1, max_length=50)
    nivel: int | None = None


class RoomIn(BaseModel):
    pisoId: str = Field(min_length=1, max_length=36)
    nombre: str = Field(min_length=1, max_length=100)
    capacidadOcupantes: int = Field(gt=0)


class RoomPatch(BaseModel):
    pisoId: str | None = Field(default=None, min_length=1, max_length=36)
    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    capacidadOcupantes: int | None = Field(default=None, gt=0)


class NodePatch(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    salaId: str | None = None
    macAddress: str | None = Field(default=None, max_length=17)
    wifiSsid: str | None = Field(default=None, max_length=50)

    @field_validator("nombre")
    @classmethod
    def normalize_node_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("El nombre del nodo no puede quedar vacío")
        return value


class FirmwareAssignIn(BaseModel):
    firmwareId: str = Field(min_length=1, max_length=36)
    wifiSsid: str | None = Field(default=None, max_length=50)
    macAddress: str | None = Field(default=None, max_length=17)


class Hub:
    def __init__(self):
        self.connections: dict[WebSocket, tuple[UUID | None, datetime | None]] = {}
        self.lock = asyncio.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, ws: WebSocket, session_id: UUID | None, expires_at: datetime | None = None):
        await ws.accept()
        async with self.lock:
            self.connections[ws] = (session_id, expires_at)

    async def disconnect(self, ws: WebSocket):
        async with self.lock:
            self.connections.pop(ws, None)

    async def broadcast(self, event: dict[str, Any]):
        async with self.lock:
            peers = list(self.connections.items())
        room_id = event.get("salaId")
        event_type = event.get("tipo")
        if not room_id or event_type not in ("ventana", "alerta"):
            return
        session_ids = [session_id for _, (session_id, _) in peers if session_id is not None]
        active_sessions = {}
        if session_ids:
            rows = fetch_all('''SELECT s.id AS "sessionId",u.rol,u."assignedEdificios",ed.id AS "edificioId"
                FROM sesiones_usuario s JOIN usuarios u ON u.id=s."usuarioId"
                JOIN salas r ON r.id=%s JOIN pisos p ON p.id=r."pisoId"
                JOIN edificios ed ON ed.id=p."edificioId"
                WHERE s.id=ANY(%s) AND s.revocada=FALSE AND s."expiraEn">NOW()
                AND s."ultimaActividadEn">NOW()-(%s * INTERVAL '1 minute') AND u.estado='activo' ''',
                (room_id, session_ids, SESSION_IDLE_MINUTES))
            active_sessions = {row["sessionId"]: row for row in rows}
        now = datetime.now(timezone.utc)
        for ws, (session_id, expires_at) in peers:
            if expires_at is None or expires_at <= now:
                await self.disconnect(ws)
                try:
                    await ws.close(code=4401)
                except Exception:
                    pass
                continue
            if session_id is None:
                if event_type == "ventana":
                    try:
                        await ws.send_json(event)
                    except Exception:
                        await self.disconnect(ws)
                continue
            user = active_sessions.get(session_id)
            if not user:
                await self.disconnect(ws)
                try:
                    await ws.close(code=4401)
                except Exception:
                    pass
                continue
            allowed_buildings = user["assignedEdificios"] or []
            room_allowed = user["rol"] == "ADMIN" or user["edificioId"] in allowed_buildings
            event_allowed = event_type == "ventana" or user["rol"] in ("ADMIN", "ANALISTA")
            if not room_allowed or not event_allowed:
                continue
            try:
                await ws.send_json(event)
            except Exception:
                await self.disconnect(ws)

    def publish_from_thread(self, event: dict[str, Any]):
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(event), self.loop)


hub = Hub()
mqtt_client: mqtt.Client | None = None
telegram_task: asyncio.Task | None = None
MQTT_DYNSEC_TOPIC = "$CONTROL/dynamic-security/v1"
MQTT_DYNSEC_RESPONSE_TOPIC = f"{MQTT_DYNSEC_TOPIC}/response"
MQTT_NODE_ROLE_PREFIX = "aira-nodo-"
mqtt_dynsec_lock = threading.Lock()
mqtt_dynsec_response_event = threading.Event()
mqtt_dynsec_response: dict[str, Any] | None = None


def persist_packet(raw: dict[str, Any]):
    packet = TelemetryPacket.model_validate(raw)
    if packet.ventana_id and packet.orden_registro is not None and packet.ventana_id != f"{packet.nodo_id}:{packet.orden_registro}":
        raise ValueError("ventanaId no coincide con nodoId y ordenRegistro")
    if packet.ventana_inicio and packet.ventana_fin_real and packet.ventana_inicio > packet.ventana_fin_real:
        raise ValueError("ventanaInicio posterior a ventanaFinReal")
    if packet.subniveles and any(level is not None and not 0 <= level <= 4 for level in packet.subniveles.values()):
        raise ValueError("subnivel fuera de 0..4")
    with db() as conn, conn.cursor() as cur:
        # Lock the node until telemetry commits so retirement cannot race a packet
        # that passed validation just before the node was retired.
        cur.execute('SELECT id, "salaId", "retiradoEn" FROM nodos WHERE id=%s FOR UPDATE', (packet.nodo_id,))
        node = cur.fetchone()
        if not node:
            raise ValueError("nodo no registrado")
        if node["retiradoEn"]:
            raise ValueError("nodo retirado; su historial se conserva, pero no acepta telemetría nueva")
        sala_id = packet.sala_id or node["salaId"]
        if not sala_id:
            raise ValueError("nodo sin sala asignada")
        if node["salaId"] and packet.sala_id and packet.sala_id != node["salaId"]:
            raise ValueError("salaId no coincide con la asignación vigente del nodo")
        cur.execute('SELECT "retiradoEn" FROM salas WHERE id=%s', (sala_id,))
        room = cur.fetchone()
        if not room or room["retiradoEn"]:
            raise ValueError("la sala no existe o fue retirada; telemetría descartada")
        if packet.hora_verificada:
            if packet.timestamp is None:
                raise ValueError("timestamp requerido cuando horaVerificada=true")
            cur.execute('''INSERT INTO telemetria (
                "salaId","nodoId","timestamp","conteosValidos","versionReglas","ventanasDescartadas","esRetransmision",
                co2,pm25,pm10,temperatura,humedad,"icaiScore","icaiCategoria","icaiEstado","causasICAI",
                "ictScore","ictCategoria","ictEstado","causasICT","icgScore","icgCategoria","icgEstado",
                "causasICG","celdaMatriz",recomendaciones,
                "ventanaId","ventanaInicio","ventanaFinReal","ordenRegistro","firmwareVersion",
                "mediasClasificacion",subniveles,persistencia,invalidaciones,calibracion)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                        %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT ("salaId","timestamp") DO NOTHING''', (
                sala_id, packet.nodo_id, packet.timestamp, Jsonb(packet.conteos_validos), packet.version_reglas,
                packet.ventanas_descartadas, packet.es_retransmision, packet.co2, packet.pm25, packet.pm10,
                packet.temperatura, packet.humedad, packet.icai_score, packet.icai_categoria, packet.icai_estado,
                packet.causas_icai, packet.ict_score, packet.ict_categoria, packet.ict_estado, packet.causas_ict,
                packet.icg_score, packet.icg_categoria, packet.icg_estado, packet.causas_icg, packet.celda_matriz, packet.recomendaciones,
                packet.ventana_id, packet.ventana_inicio, packet.ventana_fin_real, packet.orden_registro, packet.firmware_version,
                Jsonb(packet.medias_clasificacion) if packet.medias_clasificacion is not None else None,
                Jsonb(packet.subniveles) if packet.subniveles is not None else None,
                Jsonb(packet.persistencia) if packet.persistencia is not None else None,
                Jsonb(packet.invalidaciones) if packet.invalidaciones is not None else None,
                Jsonb(packet.calibracion) if packet.calibracion is not None else None))
            inserted = cur.rowcount == 1
            if inserted:
                alerts = cur.execute('''SELECT id,variable,nivel,"valorMedido" FROM alertas
                    WHERE "salaId"=%s AND "ventanaConfirmacion"=%s AND estado='activa' ''', (sala_id, packet.timestamp)).fetchall()
                resolved = cur.execute('''SELECT DISTINCT ON (variable) id FROM alertas
                    WHERE "salaId"=%s AND "resueltaEn"=%s AND estado='resuelta'
                    ORDER BY variable,"ventanaConfirmacion" DESC''', (sala_id, packet.timestamp)).fetchall()
                conn.commit()
                hub.publish_from_thread({"tipo": "ventana", "salaId": sala_id, "nodoId": packet.nodo_id,
                    "timestamp": packet.timestamp.isoformat(), "icgEstado": packet.icg_estado, "icgScore": packet.icg_score})
                for alert in alerts:
                    hub.publish_from_thread({"tipo": "alerta", **alert, "salaId": sala_id,
                        "ventanaConfirmacion": packet.timestamp.isoformat()})
                if alerts and TELEGRAM_BOT_TOKEN:
                    asyncio.run_coroutine_threadsafe(telegram_alerts(sala_id, alerts), hub.loop)
                # Las resoluciones de Telegram esperan una segunda ventana de recuperación.
                # El sondeo del bot también las retoma después de reinicios.
            return {"tabla": "telemetria", "insertada": inserted}
        if packet.orden_registro is None:
            raise ValueError("ordenRegistro requerido cuando horaVerificada=false")
        cur.execute('''INSERT INTO telemetria_tiempo_incierto
            ("nodoId","salaId","ordenRegistro","ventanasDescartadas","paqueteOriginal")
            VALUES (%s,%s,%s,%s,%s) ON CONFLICT ("nodoId","ordenRegistro","recibidoEn") DO NOTHING''',
            (packet.nodo_id, sala_id, packet.orden_registro, packet.ventanas_descartadas, Jsonb(raw)))
        return {"tabla": "telemetria_tiempo_incierto", "insertada": cur.rowcount == 1}


def mqtt_on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        client.subscribe("telemetria/+/datos", qos=1)
        client.subscribe(MQTT_DYNSEC_RESPONSE_TOPIC, qos=1)
        log.info("Suscrito a telemetria/+/datos")
    else:
        log.error("Conexión MQTT rechazada: %s", reason_code)


def mqtt_on_message(client, userdata, message):
    global mqtt_dynsec_response
    if message.topic == MQTT_DYNSEC_RESPONSE_TOPIC:
        try:
            mqtt_dynsec_response = json.loads(message.payload.decode("utf-8"))
            mqtt_dynsec_response_event.set()
        except (UnicodeDecodeError, json.JSONDecodeError):
            log.error("Respuesta inválida del control de seguridad MQTT")
        return
    try:
        raw = json.loads(message.payload.decode("utf-8"))
        persist_packet(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError, psycopg.Error) as exc:
        log.warning("Paquete MQTT descartado en %s: %s", message.topic, exc)


def mqtt_dynsec_command(command: dict[str, Any]) -> dict[str, Any]:
    """Run one authenticated Mosquitto Dynamic Security command and await its reply."""
    global mqtt_dynsec_response
    client = mqtt_client
    if not client:
        raise RuntimeError("El cliente MQTT de la API no está iniciado")
    deadline = datetime.now(timezone.utc).timestamp() + 10
    while not client.is_connected() and datetime.now(timezone.utc).timestamp() < deadline:
        threading.Event().wait(0.1)
    if not client.is_connected():
        raise RuntimeError("La API todavía no se conecta al broker MQTT")

    with mqtt_dynsec_lock:
        mqtt_dynsec_response = None
        mqtt_dynsec_response_event.clear()
        info = client.publish(MQTT_DYNSEC_TOPIC, json.dumps({"commands": [command]}), qos=1)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"No se pudo enviar el comando al broker MQTT (código {info.rc})")
        if not mqtt_dynsec_response_event.wait(5):
            raise RuntimeError("El broker MQTT no respondió al comando de aprovisionamiento")
        response = mqtt_dynsec_response
        mqtt_dynsec_response = None

    responses = (response or {}).get("responses") or []
    if not responses:
        raise RuntimeError("El broker MQTT devolvió una respuesta vacía al aprovisionamiento")
    result = responses[0]
    if result.get("error"):
        raise RuntimeError(f"Broker MQTT: {result['error']}")
    return result


def provision_mqtt_client(node_id: str, password: str, force_update: bool = False):
    """Ensure this ESP32 has a broker account limited to its own telemetry topic."""
    role_name = f"{MQTT_NODE_ROLE_PREFIX}{node_id}"
    try:
        mqtt_dynsec_command({"command": "getRole", "rolename": role_name})
    except RuntimeError as exc:
        if "not found" not in str(exc).lower():
            raise
        mqtt_dynsec_command({"command": "createRole", "rolename": role_name, "acls": [
            {"acltype": "publishClientSend", "topic": f"telemetria/{node_id}/datos", "allow": True, "priority": 1}
        ]})

    try:
        client = mqtt_dynsec_command({"command": "getClient", "username": node_id})
        assigned_roles = client.get("roles") or []
        desired_roles = [{"rolename": role_name, "priority": 1}]
        if force_update or assigned_roles != desired_roles:
            update = {"command": "modifyClient", "username": node_id,
                      "clientid": node_id, "roles": desired_roles}
            if force_update:
                update["password"] = password
            mqtt_dynsec_command(update)
    except RuntimeError as exc:
        if "not found" not in str(exc).lower():
            raise
        mqtt_dynsec_command({"command": "createClient", "username": node_id, "password": password,
                             "clientid": node_id,
                             "roles": [{"rolename": role_name, "priority": 1}]})


def telegram_api(method: str, fields: dict[str, Any], file: tuple[str, bytes, str] | None = None):
    """Call the Telegram Bot API without logging the token or message contents."""
    if not TELEGRAM_BOT_TOKEN:
        return None
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/{method}"
    if file is None:
        request = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method="POST")
    else:
        boundary = "----calidad" + secrets.token_hex(12)
        pieces = []
        for key, value in fields.items():
            pieces.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode())
        filename, content, content_type = file
        pieces.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode() + content + b"\r\n")
        pieces.append(f"--{boundary}--\r\n".encode())
        request = urllib.request.Request(url, data=b"".join(pieces), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urllib.request.urlopen(request, timeout=35) as response:
        result = json.loads(response.read())
    if not result.get("ok"):
        raise RuntimeError("Telegram rechazó la operación")
    return result.get("result")


def telegram_user_for_chat(chat_id: int):
    return fetch_one('''SELECT u.id,u.nombre,u.rol,u.estado,u."assignedEdificios",tv."avisosActivos"
        FROM telegram_vinculos tv JOIN usuarios u ON u.id=tv."usuarioId"
        WHERE tv."chatId"=%s AND tv."chatId">0 AND tv."chatVinculado"=TRUE AND u.estado='activo' ''', (chat_id,))


def telegram_room_still_allowed(chat_id: int, user_id: str, room_id: str, require_alerts: bool = False):
    alert_filter = ' AND tv."avisosActivos"=TRUE' if require_alerts else ""
    return fetch_one(f'''SELECT u.id FROM telegram_vinculos tv JOIN usuarios u ON u.id=tv."usuarioId"
        JOIN telegram_preferencias_salas pref ON pref."usuarioId"=u.id
        JOIN salas r ON r.id=pref."salaId" JOIN pisos p ON p.id=r."pisoId" JOIN edificios ed ON ed.id=p."edificioId"
        WHERE tv."chatId"=%s AND tv."chatId">0 AND tv."chatVinculado"=TRUE AND u.id=%s AND u.estado='activo'
        AND pref."salaId"=%s AND (u.rol='ADMIN' OR ed.id=ANY(u."assignedEdificios")){alert_filter}''', (chat_id,user_id,room_id)) is not None


try:
    TELEGRAM_TIMEZONE = ZoneInfo("America/Santiago")
except ZoneInfoNotFoundError:
    TELEGRAM_TIMEZONE = timezone.utc

TELEGRAM_PAGE_SIZE = 7
telegram_search_modes: dict[int, str] = {}
TELEGRAM_LEVELS = {"s": "Sectores", "b": "Edificios", "f": "Pisos", "r": "Salas"}
TELEGRAM_SEVERITY = {0: "Óptimo", 1: "Precaución", 2: "Deficiente", 3: "Malo", 4: "Crítico"}
TELEGRAM_VARIABLES = {
    "CO2": ("CO₂", "ppm"), "PM25": ("PM₂.₅", "µg/m³"), "PM10": ("PM₁₀", "µg/m³"),
    "TEMPERATURA": ("Temperatura", "°C"), "HUMEDAD": ("Humedad", "%"),
}


def telegram_keyboard(rows: list[list[tuple[str, str]]]) -> str:
    return json.dumps({"inline_keyboard": [[{"text": label, "url" if data.startswith("https://") else "callback_data": data}
                                           for label, data in row] for row in rows]}, ensure_ascii=False)


async def telegram_send(chat_id: int, message: str, buttons: list[list[tuple[str, str]]] | None = None):
    fields: dict[str, Any] = {"chat_id": chat_id, "text": message}
    if buttons:
        fields["reply_markup"] = telegram_keyboard(buttons)
    return await asyncio.to_thread(telegram_api, "sendMessage", fields)


def telegram_time(value: datetime | None) -> str:
    if value is None:
        return "sin fecha verificada"
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(TELEGRAM_TIMEZONE).strftime("%d/%m/%Y %H:%M") + (" h (Chile)" if TELEGRAM_TIMEZONE != timezone.utc else " UTC")


def telegram_measurement(value: float | None, unit: str) -> str:
    if value is None:
        return "sin dato"
    shown = f"{value:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{shown} {unit}"


def telegram_location(room: dict[str, Any]) -> str:
    return f"{room['salaNombre']} · {room['pisoNombre']} · {room['edificioNombre']} · {room['sectorNombre']}"


def telegram_authorized_rooms(user: dict[str, Any]) -> list[dict[str, Any]]:
    return fetch_all('''SELECT sec.id AS "sectorId",sec.nombre AS "sectorNombre",
        ed.id AS "edificioId",ed.nombre AS "edificioNombre",p.id AS "pisoId",p.nombre AS "pisoNombre",
        s.id AS "salaId",s.nombre AS "salaNombre"
        FROM salas s JOIN pisos p ON p.id=s."pisoId" JOIN edificios ed ON ed.id=p."edificioId"
        JOIN sectores sec ON sec.id=ed."sectorId"
        WHERE s."retiradoEn" IS NULL AND p."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL
        AND sec."retiradoEn" IS NULL AND (%s::text='ADMIN' OR ed.id=ANY(%s::text[]))
        ORDER BY sec.nombre,ed.nombre,p.nivel,s.nombre''', (user["rol"], user["assignedEdificios"] or []))


def telegram_room_state(room_id: str) -> dict[str, Any] | None:
    return fetch_one('SELECT * FROM vw_estado_actual_salas WHERE "salaId"=%s', (room_id,))


def telegram_index(label: str, score: int | None, state: str | None) -> str:
    if score is None or state == "dato_insuficiente":
        return f"{label}: sin datos suficientes"
    category = TELEGRAM_SEVERITY.get(score, "Sin categoría")
    suffix = " · parcial" if state == "parcial" else ""
    return f"{label}: {score}/4 · {category}{suffix}"


def telegram_state_text(room: dict[str, Any]) -> str:
    title = f"📍 {telegram_location(room)}"
    timestamp = room.get("ventanaTimestamp")
    if timestamp is None:
        return title + "\nAún no hay una ventana con hora verificada para esta sala."
    if isinstance(timestamp, str):
        timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    age_minutes = max(0, int((datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)).total_seconds() / 60))
    age_text = f"⚠️ Dato de hace {age_minutes} min; puede estar desactualizado.\n" if age_minutes > 10 else ""
    lines = [title, f"Ventana: {telegram_time(timestamp)}", age_text.rstrip(),
             telegram_index("ICG · estado general", room.get("icgScore"), room.get("icgEstado")),
             telegram_index("ICAI · aire", room.get("icaiScore"), room.get("icaiEstado")),
             telegram_index("ICT · confort", room.get("ictScore"), room.get("ictEstado")),
             "", "Mediciones de la ventana:",
             f"CO₂: {telegram_measurement(room.get('co2'), 'ppm')}",
             f"PM₂.₅: {telegram_measurement(room.get('pm25'), 'µg/m³')}",
             f"PM₁₀: {telegram_measurement(room.get('pm10'), 'µg/m³')}",
             f"Temperatura: {telegram_measurement(room.get('temperatura'), '°C')}",
             f"Humedad: {telegram_measurement(room.get('humedad'), '%')}"]
    causes = room.get("causasICG") or []
    if causes:
        lines.append("Causas: " + ", ".join(causes))
    recommendations = room.get("recomendaciones") or []
    if recommendations and recommendations[0]:
        lines.append("Recomendación: " + recommendations[0])
    active = fetch_all('''SELECT variable,nivel FROM alertas WHERE "salaId"=%s AND estado='activa'
        ORDER BY nivel DESC,variable''', (room["salaId"],))
    lines.append("Condiciones que requieren atención: " + (", ".join(f"{item['variable']} (nivel {item['nivel']})" for item in active) if active else "ninguna en la última ventana"))
    pending = fetch_all('''SELECT a.variable,a."resueltaEn" FROM alertas a
        WHERE a."salaId"=%s AND a.estado='resuelta'
          AND NOT EXISTS (SELECT 1 FROM telemetria t WHERE t."salaId"=a."salaId"
            AND t."timestamp"=a."resueltaEn"+INTERVAL '5 minutes')
          AND NOT EXISTS (SELECT 1 FROM alertas newer WHERE newer."salaId"=a."salaId"
            AND newer.variable=a.variable AND newer."ventanaConfirmacion">a."resueltaEn")
        ORDER BY a."resueltaEn" DESC LIMIT 5''', (room["salaId"],))
    if pending:
        lines.append("Mejoría pendiente de confirmar: " + ", ".join(item["variable"] for item in pending) + ". Falta la siguiente medición válida.")
    return "\n".join(lines)


def telegram_search_key(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in value if not unicodedata.combining(char))


def telegram_search_rooms(rooms: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
    needle = telegram_search_key(query.strip())
    if not needle:
        return []
    scored = []
    for room in rooms:
        name = telegram_search_key(room["salaNombre"])
        path = telegram_search_key(telegram_location(room))
        score = (2 if needle in name else 1 if needle in path else 0) + difflib.SequenceMatcher(None, needle, name).ratio()
        if score >= 0.53:
            scored.append((score, room))
    return [room for _, room in sorted(scored, key=lambda item: (-item[0], item[1]["salaNombre"]))[:TELEGRAM_PAGE_SIZE]]


def telegram_list_items(rooms: list[dict[str, Any]], level: str, parent: str) -> list[tuple[str, str]]:
    key = {"s": ("sectorId", "sectorNombre", None), "b": ("edificioId", "edificioNombre", "sectorId"),
           "f": ("pisoId", "pisoNombre", "edificioId"), "r": ("salaId", "salaNombre", "pisoId")}[level]
    found: dict[str, str] = {}
    for room in rooms:
        if key[2] is None or room[key[2]] == parent:
            found[room[key[0]]] = room[key[1]]
    return sorted(((name, item_id) for item_id, name in found.items()), key=lambda item: telegram_search_key(item[0]))


def telegram_back_button(rooms: list[dict[str, Any]], mode: str, level: str, parent: str) -> tuple[str, str]:
    if level == "s":
        return ("‹ Menú", "m") if mode == "v" else ("‹ Mis avisos", "p")
    previous = {"b": "s", "f": "b", "r": "f"}[level]
    previous_parent = "0"
    for room in rooms:
        if (level == "b" and room["sectorId"] == parent) or (level == "f" and room["edificioId"] == parent) or (level == "r" and room["pisoId"] == parent):
            previous_parent = {"b": "0", "f": room["sectorId"], "r": room["edificioId"]}[level]
            break
    return ("‹ Volver", f"l|{mode}|{previous}|{previous_parent}|0")


async def telegram_show_list(chat_id: int, user: dict[str, Any], mode: str, level: str, parent: str, page: int):
    rooms = telegram_authorized_rooms(user)
    items = telegram_list_items(rooms, level, parent)
    if not items:
        await telegram_send(chat_id, "No hay lugares autorizados en este nivel.", [[telegram_back_button(rooms, mode, level, parent)]])
        return
    total_pages = (len(items) + TELEGRAM_PAGE_SIZE - 1) // TELEGRAM_PAGE_SIZE
    page = max(0, min(page, total_pages - 1))
    visible = items[page * TELEGRAM_PAGE_SIZE:(page + 1) * TELEGRAM_PAGE_SIZE]
    next_level = {"s": "b", "b": "f", "f": "r"}.get(level)
    buttons = [[(name, f"l|{mode}|{next_level}|{item_id}|0" if next_level else f"{'d' if mode == 'v' else 'a'}|{item_id}")] for name, item_id in visible]
    pager = []
    if page:
        pager.append(("‹ Anterior", f"l|{mode}|{level}|{parent}|{page-1}"))
    if page + 1 < total_pages:
        pager.append(("Siguiente ›", f"l|{mode}|{level}|{parent}|{page+1}"))
    if pager:
        buttons.append(pager)
    buttons.append([("🔎 Buscar sala", f"f|{mode}"), telegram_back_button(rooms, mode, level, parent)])
    await telegram_send(chat_id, f"{TELEGRAM_LEVELS[level]} ({page+1}/{total_pages}). Elige una opción:", buttons)


async def telegram_show_state(chat_id: int, user: dict[str, Any], room_id: str):
    rooms = telegram_authorized_rooms(user)
    room = next((item for item in rooms if item["salaId"] == room_id), None)
    if room is None:
        await telegram_send(chat_id, "Ya no tienes permiso para consultar esa sala.")
        return
    state = telegram_room_state(room_id)
    if state is None:
        await telegram_send(chat_id, "La sala ya no está disponible.")
        return
    actions = [("Actualizar", f"d|{room_id}")]
    if PUBLIC_WEB_URL:
        actions.append(("Ver en la web", f"{PUBLIC_WEB_URL}/salas/{urllib.parse.quote(room_id, safe='')}"))
    await telegram_send(chat_id, telegram_state_text(state),
                        [actions, [("‹ Volver a salas", f"l|v|r|{room['pisoId']}|0"), ("Menú", "m")]])


async def telegram_show_menu(chat_id: int, user: dict[str, Any]):
    await telegram_send(chat_id, f"Hola, {user['nombre']}. ¿Qué quieres consultar?",
                        [[("📍 Ver estado de una sala", "l|v|s|0|0")],
                         [("🔎 Buscar sala", "f|v"), ("🔔 Mis avisos", "p")],
                         [("Ayuda", "h")]])


async def telegram_show_preferences(chat_id: int, user: dict[str, Any]):
    prefs = fetch_all('''SELECT pref."salaId",pref."pausadoHasta" FROM telegram_preferencias_salas pref
        WHERE pref."usuarioId"=%s''', (user["id"],))
    active_count = sum(1 for pref in prefs if not pref["pausadoHasta"] or pref["pausadoHasta"] <= datetime.now(timezone.utc))
    status = "activados" if user["avisosActivos"] else "desactivados"
    await telegram_send(chat_id, f"🔔 Mis avisos\nAvisos globales: {status}.\nSalas suscritas: {len(prefs)} ({active_count} sin pausa).\nConsultar una sala no la suscribe automáticamente.",
                        [[("Activar avisos" if not user["avisosActivos"] else "Desactivar avisos", "g")],
                         [("Elegir salas", "l|p|s|0|0")],
                         [("Ver salas suscritas", "p|list|0"), ("Buscar sala", "f|p")],
                         [("‹ Menú", "m")]])


async def telegram_show_subscriptions(chat_id: int, user: dict[str, Any], page: int):
    allowed = {room["salaId"]: room for room in telegram_authorized_rooms(user)}
    prefs = fetch_all('SELECT "salaId","pausadoHasta" FROM telegram_preferencias_salas WHERE "usuarioId"=%s ORDER BY "salaId"', (user["id"],))
    visible_prefs = [pref for pref in prefs if pref["salaId"] in allowed]
    if not visible_prefs:
        await telegram_send(chat_id, "Aún no tienes salas suscritas dentro de tus permisos actuales.", [[("Elegir salas", "l|p|s|0|0"), ("‹ Mis avisos", "p")]])
        return
    total_pages = (len(visible_prefs) + TELEGRAM_PAGE_SIZE - 1) // TELEGRAM_PAGE_SIZE
    page = max(0, min(page, total_pages - 1))
    buttons = []
    now = datetime.now(timezone.utc)
    for pref in visible_prefs[page * TELEGRAM_PAGE_SIZE:(page + 1) * TELEGRAM_PAGE_SIZE]:
        room = allowed[pref["salaId"]]
        paused = pref["pausadoHasta"] and pref["pausadoHasta"] > now
        buttons.append([(("⏸ " if paused else "🔔 ") + room["salaNombre"] + " · " + room["edificioNombre"], f"a|{room['salaId']}")])
    pager = []
    if page:
        pager.append(("‹ Anterior", f"p|list|{page-1}"))
    if page + 1 < total_pages:
        pager.append(("Siguiente ›", f"p|list|{page+1}"))
    if pager:
        buttons.append(pager)
    buttons.append([("‹ Mis avisos", "p")])
    await telegram_send(chat_id, f"Salas suscritas ({page+1}/{total_pages}):", buttons)


async def telegram_show_preference_room(chat_id: int, user: dict[str, Any], room_id: str):
    room = next((item for item in telegram_authorized_rooms(user) if item["salaId"] == room_id), None)
    if room is None:
        await telegram_send(chat_id, "Ya no tienes permiso para configurar esa sala.")
        return
    pref = fetch_one('SELECT "pausadoHasta" FROM telegram_preferencias_salas WHERE "usuarioId"=%s AND "salaId"=%s', (user["id"], room_id))
    paused = bool(pref and pref["pausadoHasta"] and pref["pausadoHasta"] > datetime.now(timezone.utc))
    status = "sin suscripción" if pref is None else "pausada hasta " + telegram_time(pref["pausadoHasta"]) if paused else "suscrita"
    buttons = [[("Dejar de recibir avisos", f"t|{room_id}") if pref else ("Recibir avisos de esta sala", f"t|{room_id}")]]
    if pref:
        buttons.append([("Reanudar avisos", f"r|{room_id}")] if paused else [("Pausar avisos", f"q|{room_id}")])
    buttons.append([("Ver estado", f"d|{room_id}"), ("‹ Mis avisos", "p")])
    await telegram_send(chat_id, f"🔔 {telegram_location(room)}\nEstado de la suscripción: {status}.", buttons)


def telegram_toggle_subscription(user: dict[str, Any], room_id: str) -> bool:
    if not any(room["salaId"] == room_id for room in telegram_authorized_rooms(user)):
        return False
    with db() as conn, conn.cursor() as cur:
        cur.execute('SELECT 1 FROM telegram_preferencias_salas WHERE "usuarioId"=%s AND "salaId"=%s', (user["id"], room_id))
        if cur.fetchone():
            cur.execute('DELETE FROM telegram_preferencias_salas WHERE "usuarioId"=%s AND "salaId"=%s', (user["id"], room_id))
        else:
            cur.execute('INSERT INTO telegram_preferencias_salas ("usuarioId","salaId") VALUES (%s,%s) ON CONFLICT DO NOTHING', (user["id"], room_id))
    return True


async def telegram_show_pause_options(chat_id: int, user: dict[str, Any], room_id: str):
    if not any(room["salaId"] == room_id for room in telegram_authorized_rooms(user)):
        await telegram_send(chat_id, "Ya no tienes permiso para configurar esa sala.")
        return
    pref = fetch_one('SELECT 1 FROM telegram_preferencias_salas WHERE "usuarioId"=%s AND "salaId"=%s', (user["id"], room_id))
    if not pref:
        await telegram_send(chat_id, "Primero suscríbete a los avisos de esta sala.")
        return
    await telegram_send(chat_id, "¿Cuánto tiempo quieres pausar los avisos de esta sala? La medición seguirá disponible en la web y en Ver estado.",
                        [[("1 hora", f"c|{room_id}|1"), ("24 horas", f"c|{room_id}|24")], [("Cancelar", f"a|{room_id}")]])


async def telegram_confirm_pause(chat_id: int, user: dict[str, Any], room_id: str, hours: int):
    if hours not in (1, 24) or not any(room["salaId"] == room_id for room in telegram_authorized_rooms(user)):
        await telegram_send(chat_id, "La opción ya no está disponible.")
        return
    await telegram_send(chat_id, f"Confirma la pausa de {hours} {'hora' if hours == 1 else 'horas'} para esta sala.",
                        [[("Confirmar pausa", f"u|{room_id}|{hours}"), ("Cancelar", f"a|{room_id}")]])


async def telegram_handle_callback(callback: dict[str, Any]):
    message = callback.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    callback_id = callback.get("id")
    if callback_id:
        await asyncio.to_thread(telegram_api, "answerCallbackQuery", {"callback_query_id": callback_id})
    if chat.get("type") != "private" or not chat_id or (callback.get("from") or {}).get("id") != chat_id:
        return
    user = telegram_user_for_chat(chat_id)
    if not user:
        await telegram_send(chat_id, "Tu cuenta no está vinculada o ya no está activa. Vincúlala desde la página web.")
        return
    data = callback.get("data") or ""
    parts = data.split("|")
    action = parts[0]
    if action == "m":
        await telegram_show_menu(chat_id, user)
    elif action == "h":
        await telegram_send(chat_id, "Usa Ver estado para elegir o buscar una sala autorizada. Mis avisos controla las suscripciones; consultar una sala no activa notificaciones.", [[("Menú", "m")]])
    elif action == "p" and len(parts) == 1:
        await telegram_show_preferences(chat_id, user)
    elif action == "p" and len(parts) == 3 and parts[1] == "list" and parts[2].isdigit():
        await telegram_show_subscriptions(chat_id, user, int(parts[2]))
    elif action == "l" and len(parts) == 5 and parts[1] in ("v", "p") and parts[2] in TELEGRAM_LEVELS and parts[4].isdigit():
        await telegram_show_list(chat_id, user, parts[1], parts[2], parts[3], int(parts[4]))
    elif action == "d" and len(parts) == 2:
        await telegram_show_state(chat_id, user, parts[1])
    elif action == "a" and len(parts) == 2:
        await telegram_show_preference_room(chat_id, user, parts[1])
    elif action == "f" and len(parts) == 2 and parts[1] in ("v", "p"):
        telegram_search_modes[chat_id] = parts[1]
        await telegram_send(chat_id, "Escribe parte del nombre de la sala, edificio o sector. Mostraré solo resultados autorizados.")
    elif action == "g":
        execute('UPDATE telegram_vinculos SET "avisosActivos"=NOT "avisosActivos","updatedAt"=NOW() WHERE "usuarioId"=%s AND "chatId"=%s AND "chatVinculado"=TRUE', (user["id"], chat_id))
        await telegram_show_preferences(chat_id, telegram_user_for_chat(chat_id))
    elif action == "t" and len(parts) == 2:
        if telegram_toggle_subscription(user, parts[1]):
            await telegram_show_preference_room(chat_id, user, parts[1])
        else:
            await telegram_send(chat_id, "Ya no tienes permiso para configurar esa sala.")
    elif action == "q" and len(parts) == 2:
        await telegram_show_pause_options(chat_id, user, parts[1])
    elif action == "c" and len(parts) == 3 and parts[2] in ("1", "24"):
        await telegram_confirm_pause(chat_id, user, parts[1], int(parts[2]))
    elif action in ("u", "r") and len(parts) in (2, 3):
        room_id = parts[1]
        if not any(room["salaId"] == room_id for room in telegram_authorized_rooms(user)):
            await telegram_send(chat_id, "Ya no tienes permiso para configurar esa sala.")
            return
        if action == "u" and len(parts) == 3 and parts[2] in ("1", "24"):
            execute('UPDATE telegram_preferencias_salas SET "pausadoHasta"=NOW()+(%s * INTERVAL \'1 hour\') WHERE "usuarioId"=%s AND "salaId"=%s',
                    (int(parts[2]), user["id"], room_id))
        elif action == "r" and len(parts) == 2:
            execute('UPDATE telegram_preferencias_salas SET "pausadoHasta"=NULL WHERE "usuarioId"=%s AND "salaId"=%s', (user["id"], room_id))
        await telegram_show_preference_room(chat_id, user, room_id)
    else:
        await telegram_send(chat_id, "Esa opción ya no está disponible. Abre el menú para elegir de nuevo.", [[("Menú", "m")]])


async def telegram_show_search_results(chat_id: int, user: dict[str, Any], query: str, mode: str):
    matches = telegram_search_rooms(telegram_authorized_rooms(user), query)
    if not matches:
        await telegram_send(chat_id, "No encontré una sala autorizada con ese nombre. Prueba con otra palabra.", [[("Buscar de nuevo", f"f|{mode}"), ("Menú", "m")]])
        return
    buttons = [[(telegram_location(room), f"{'d' if mode == 'v' else 'a'}|{room['salaId']}")] for room in matches]
    buttons.append([("Buscar de nuevo", f"f|{mode}"), ("Menú", "m")])
    await telegram_send(chat_id, f"Resultados para «{query[:60]}»:", buttons)


async def telegram_handle_update(update: dict[str, Any]):
    if update.get("callback_query"):
        await telegram_handle_callback(update["callback_query"])
        return
    message = update.get("message")
    if not message or not message.get("text"):
        return
    chat = message.get("chat", {})
    chat_id = chat.get("id")
    text = message["text"].strip()
    if not chat_id:
        return
    if chat.get("type") != "private" or (message.get("from") or {}).get("id") != chat_id:
        if text.split()[0].split("@")[0] == "/start":
            await telegram_send(chat_id, "Por privacidad, vincula tu cuenta hablando conmigo en un chat privado.")
        return
    command = text.split()[0].split("@")[0]
    if command == "/start":
        parts = text.split(maxsplit=1)
        if len(parts) == 2:
            result = fetch_one('''UPDATE telegram_vinculos SET "chatId"=%s,"telegramUsername"=%s,
                "chatVinculado"=TRUE,"codigoTemporal"=NULL,"codigoExpiraEn"=NULL,
                "vinculadoEn"=NOW(),"updatedAt"=NOW() WHERE "codigoTemporal"=%s AND "codigoExpiraEn">NOW()
                AND EXISTS (SELECT 1 FROM usuarios u WHERE u.id="usuarioId" AND u.estado='activo' AND u.rol<>'GUEST')
                RETURNING "usuarioId"''', (chat_id,(message.get("from") or {}).get("username"),parts[1]))
            if result:
                await telegram_send(chat_id, "Cuenta vinculada. Puedes consultar tus salas ahora; los avisos quedan desactivados hasta que los actives en Mis avisos.")
                await telegram_show_menu(chat_id, telegram_user_for_chat(chat_id))
            else:
                await telegram_send(chat_id, "Código inválido o vencido; genera uno nuevo desde tu perfil.")
        else:
            user = telegram_user_for_chat(chat_id)
            if user:
                await telegram_show_menu(chat_id, user)
            else:
                await telegram_send(chat_id, "Vincula primero tu cuenta desde la plataforma web y envíame /start seguido del código temporal.")
        return
    user = telegram_user_for_chat(chat_id)
    if not user:
        await telegram_send(chat_id, "Vincula primero tu cuenta desde la plataforma web.")
        return
    if command == "/estado":
        parts = text.split(maxsplit=1)
        if len(parts) == 2:
            await telegram_show_state(chat_id, user, parts[1])
        else:
            await telegram_show_list(chat_id, user, "v", "s", "0", 0)
        return
    if command == "/avisos":
        await telegram_show_preferences(chat_id, user)
        return
    if command == "/buscar":
        parts = text.split(maxsplit=1)
        if len(parts) == 2:
            await telegram_show_search_results(chat_id, user, parts[1], "v")
        else:
            telegram_search_modes[chat_id] = "v"
            await telegram_send(chat_id, "Escribe parte del nombre de la sala, edificio o sector.")
        return
    if command == "/ayuda":
        await telegram_send(chat_id, "Usa /estado para consultar lugares autorizados, /buscar para hallar una sala y /avisos para controlar tus suscripciones. Consultar no activa avisos.", [[("Menú", "m")]])
        return
    parts = text.split()
    if command == "/exportacion":
        if user["rol"] not in ("ADMIN","ANALISTA"):
            telegram_api("sendMessage", {"chat_id":chat_id,"text":"La exportación requiere rol ADMIN o ANALISTA."})
            return
        if len(parts) < 2:
            telegram_api("sendMessage", {"chat_id":chat_id,"text":"Uso: /exportacion <salaId> [csv|json]"})
            return
        room_id = parts[1]
        fmt = parts[2].lower() if len(parts)>2 else "csv"
        if fmt not in ("csv","json"):
            telegram_api("sendMessage", {"chat_id":chat_id,"text":"Formato permitido: csv o json."})
            return
        try:
            ensure_room_access(user,room_id)
        except HTTPException:
            telegram_api("sendMessage", {"chat_id":chat_id,"text":"No tienes permiso para exportar esa sala."})
            return
        rows = fetch_all('SELECT * FROM telemetria WHERE "salaId"=%s ORDER BY "timestamp" DESC LIMIT 1000',(room_id,))
        current = telegram_user_for_chat(chat_id)
        try:
            if not current or current["id"] != user["id"]:
                raise HTTPException(403)
            ensure_room_access(current, room_id)
        except HTTPException:
            await telegram_send(chat_id, "El permiso de la sala cambió; vuelve a intentarlo.")
            return
        if fmt == "json":
            content=json.dumps(rows,default=str,ensure_ascii=False).encode()
            content_type="application/json"
        else:
            out=io.StringIO()
            if rows:
                writer=csv.DictWriter(out,fieldnames=list(rows[0].keys()))
                writer.writeheader()
                for row in rows:
                    values = {key: json.dumps(value, default=str, ensure_ascii=False) if isinstance(value, (dict, list)) else value for key, value in row.items()}
                    writer.writerow({key: csv_safe_text(value) if isinstance(value, str) else value for key, value in values.items()})
            content=out.getvalue().encode()
            content_type="text/csv"
        telegram_api("sendDocument", {"chat_id":chat_id,"caption":f"Telemetría {room_id} ({fmt.upper()})"}, (f"telemetria-{room_id}.{fmt}",content,content_type))
        return
    if not text.startswith("/"):
        await telegram_show_search_results(chat_id, user, text, telegram_search_modes.pop(chat_id, "v"))
    else:
        await telegram_send(chat_id, "No reconozco ese comando. Usa /ayuda para ver las opciones.")


def telegram_alert_text(room: dict[str, Any], alert: dict[str, Any], reading: dict[str, Any] | None, resolved: bool, next_reading: dict[str, Any] | None = None) -> str:
    raw_variable = str(alert["variable"]).upper().replace(".", "").replace("_", "")
    variable, unit = TELEGRAM_VARIABLES.get(raw_variable, (str(alert["variable"]), ""))
    level = int(alert["nivel"] or 0)
    severity = TELEGRAM_SEVERITY.get(level, "sin categoría")
    when = alert.get("resueltaEn") if resolved else alert.get("ventanaConfirmacion")
    lines = [f"{'✅ La condición dejó de aparecer en dos mediciones consecutivas' if resolved else '🔴 Se detectó una condición que requiere atención'} · Nivel {level} ({severity})",
             f"📍 {telegram_location(room)}"]
    if resolved:
        current = (reading or {}).get({"CO2":"co2","PM25":"pm25","PM10":"pm10","TEMPERATURA":"temperatura","HUMEDAD":"humedad"}.get(raw_variable, ""))
        next_value = (next_reading or {}).get({"CO2":"co2","PM25":"pm25","PM10":"pm10","TEMPERATURA":"temperatura","HUMEDAD":"humedad"}.get(raw_variable, ""))
        lines.extend([f"{variable} cuando se detectó: {telegram_measurement(alert.get('valorMedido'), unit)} · {telegram_time(alert.get('ventanaConfirmacion'))}",
                      f"Primera medición con mejoría: {telegram_measurement(current, unit)} · {telegram_time(when)}",
                      f"Segunda medición con mejoría: {telegram_measurement(next_value, unit)} · {telegram_time((next_reading or {}).get('timestamp'))}",
                      "Continúa observando el espacio."])
        if current is None:
            lines.append("La causa dejó de aparecer en el índice, pero no hay lectura válida de esta variable.")
    else:
        lines.extend([f"{variable}: {telegram_measurement(alert.get('valorMedido'), unit)}", f"Ventana: {telegram_time(when)}"])
        lines.append("La condición apareció en dos mediciones consecutivas.")
        previous = fetch_one('''SELECT 1 FROM alertas WHERE "salaId"=%s AND variable=%s
            AND estado='resuelta' AND "resueltaEn"<%s AND "resueltaEn">=%s-INTERVAL '20 minutes'
            LIMIT 1''', (room["salaId"], alert["variable"], when, when)) if room.get("salaId") else None
        if previous:
            lines.append("La condición volvió a aparecer; la mejoría anterior no se mantuvo.")
        recommendations = (reading or {}).get("recomendaciones") or []
        if recommendations and recommendations[0]:
            lines.append(f"Recomendación: {recommendations[0]}")
    received = (reading or {}).get("recibidoEn")
    if received:
        lines.append(f"Recibida: {telegram_time(received)}")
        window = when if isinstance(when, datetime) else datetime.fromisoformat(str(when).replace("Z", "+00:00"))
        if window.tzinfo is None:
            window = window.replace(tzinfo=timezone.utc)
        lag = (received - window).total_seconds()
        if lag < -60:
            lines.append("⚠️ Hora de ventana posterior a su recepción; revisar reloj del nodo.")
        elif lag > 600 or (reading or {}).get("esRetransmision"):
            lines.append("⚠️ Dato recibido con retraso.")
    return "\n".join(lines)


async def telegram_alerts(room_id: str, alerts: list[dict[str, Any]], resolved: bool = False):
    room = fetch_one('''SELECT s.id AS "salaId",s.nombre AS "salaNombre",p.nombre AS "pisoNombre",ed.nombre AS "edificioNombre",
        sec.nombre AS "sectorNombre" FROM salas s JOIN pisos p ON p.id=s."pisoId"
        JOIN edificios ed ON ed.id=p."edificioId" JOIN sectores sec ON sec.id=ed."sectorId" WHERE s.id=%s''', (room_id,))
    if room is None:
        return
    messages = []
    alert_ids = []
    for alert_ref in alerts:
        alert = fetch_one('''SELECT id,variable,nivel,"valorMedido","ventanaConfirmacion","resueltaEn",estado
            FROM alertas WHERE id=%s AND "salaId"=%s''', (alert_ref["id"], room_id))
        if not alert or alert["estado"] != ("resuelta" if resolved else "activa"):
            continue
        reading = fetch_one('''SELECT co2,pm25,pm10,temperatura,humedad,recomendaciones,"esRetransmision","recibidoEn"
            FROM telemetria WHERE "salaId"=%s AND "timestamp"=%s''',
            (room_id, alert["resueltaEn"] if resolved else alert["ventanaConfirmacion"]))
        next_reading = fetch_one('''SELECT "timestamp",co2,pm25,pm10,temperatura,humedad FROM telemetria
            WHERE "salaId"=%s AND "timestamp"=%s''', (room_id, alert["resueltaEn"]+timedelta(minutes=5))) if resolved else None
        messages.append(telegram_alert_text(room, alert, reading, resolved, next_reading))
        alert_ids.append(alert["id"])
    if not messages:
        return
    recipients = fetch_all('''SELECT tv."chatId",u.id AS "usuarioId" FROM telegram_vinculos tv
            JOIN usuarios u ON u.id=tv."usuarioId" JOIN telegram_preferencias_salas pref ON pref."usuarioId"=u.id
            JOIN salas s ON s.id=pref."salaId" JOIN pisos p ON p.id=s."pisoId"
            JOIN edificios ed ON ed.id=p."edificioId"
            WHERE pref."salaId"=%s AND tv."chatId">0 AND tv."chatVinculado"=TRUE AND tv."avisosActivos"=TRUE
            AND (pref."pausadoHasta" IS NULL OR pref."pausadoHasta"<=NOW())
            AND u.estado='activo' AND (u.rol='ADMIN' OR ed.id=ANY(u."assignedEdificios"))''', (room_id,))
    actions = [("Gestionar avisos", f"a|{room_id}")]
    if PUBLIC_WEB_URL:
        actions.insert(0, ("Ver sala", f"{PUBLIC_WEB_URL}/salas/{urllib.parse.quote(room_id, safe='')}"))
    buttons = [actions]
    for recipient in recipients:
        kind = "resuelta" if resolved else "confirmada"
        pending = fetch_all('''SELECT id FROM alertas WHERE id=ANY(%s::text[])
            AND NOT EXISTS (SELECT 1 FROM telegram_avisos_enviados sent
                WHERE sent."alertaId"=alertas.id AND sent."chatId"=%s AND sent.tipo=%s)''',
            (alert_ids, recipient["chatId"], kind))
        pending_ids = {item["id"] for item in pending}
        if not pending_ids:
            continue
        allowed = fetch_one('''SELECT 1 FROM telegram_vinculos tv JOIN usuarios u ON u.id=tv."usuarioId"
                JOIN telegram_preferencias_salas pref ON pref."usuarioId"=u.id AND pref."salaId"=%s
                JOIN salas s ON s.id=pref."salaId" JOIN pisos p ON p.id=s."pisoId"
                JOIN edificios ed ON ed.id=p."edificioId"
                WHERE tv."chatId"=%s AND tv."chatId">0 AND u.id=%s AND tv."chatVinculado"=TRUE
                AND tv."avisosActivos"=TRUE AND (pref."pausadoHasta" IS NULL OR pref."pausadoHasta"<=NOW())
                AND u.estado='activo' AND (u.rol='ADMIN' OR ed.id=ANY(u."assignedEdificios"))''',
                (room_id, recipient["chatId"], recipient["usuarioId"]))
        if allowed:
            try:
                selected = [part for part, alert_id in zip(messages, alert_ids) if alert_id in pending_ids]
                selected_message = (f"📌 {len(selected)} avisos en la misma sala y ventana\n\n" if len(selected)>1 else "") + "\n\n".join(selected)
                await telegram_send(recipient["chatId"], selected_message, buttons)
                for alert_id in pending_ids:
                    execute('''INSERT INTO telegram_avisos_enviados ("alertaId","chatId",tipo)
                        VALUES (%s,%s,%s) ON CONFLICT DO NOTHING''', (alert_id, recipient["chatId"], kind))
            except Exception as exc:
                log.warning("No se pudo enviar aviso de Telegram (%s)", type(exc).__name__)


async def telegram_confirmed_resolutions():
    rows = fetch_all('''SELECT a.id,a."salaId",a."resueltaEn" FROM alertas a
        CROSS JOIN telegram_aviso_control control
        JOIN telemetria next_window ON next_window."salaId"=a."salaId"
            AND next_window."timestamp"=a."resueltaEn"+INTERVAL '5 minutes'
        WHERE control.id=1 AND a.estado='resuelta' AND a."timestamp">=control."desdeEn"
          AND a."resueltaEn"<=NOW() AND next_window."icgEstado"='completo'
          AND (next_window."icgScore"<3 OR NOT (a.variable=ANY(COALESCE(next_window."causasICG", '{}'::TEXT[]))))
          AND NOT EXISTS (SELECT 1 FROM alertas newer WHERE newer."salaId"=a."salaId"
              AND newer.variable=a.variable AND newer."ventanaConfirmacion">a."resueltaEn"
              AND newer."ventanaConfirmacion"<=next_window."timestamp")
          AND EXISTS (SELECT 1 FROM telegram_vinculos tv JOIN telegram_preferencias_salas pref
              ON pref."usuarioId"=tv."usuarioId" AND pref."salaId"=a."salaId"
              WHERE tv."chatVinculado"=TRUE AND tv."avisosActivos"=TRUE
                AND (pref."pausadoHasta" IS NULL OR pref."pausadoHasta"<=NOW())
                AND NOT EXISTS (SELECT 1 FROM telegram_avisos_enviados sent
                    WHERE sent."alertaId"=a.id AND sent."chatId"=tv."chatId" AND sent.tipo='resuelta'))
        ORDER BY a."resueltaEn" LIMIT 100''')
    grouped = {}
    for row in rows:
        grouped.setdefault((row["salaId"], row["resueltaEn"]), []).append(row)
    for (room_id, _), refs in grouped.items():
        await telegram_alerts(room_id, refs, resolved=True)


async def telegram_pending_improvements():
    rows = fetch_all('''SELECT a.id,a.variable,a."valorMedido",a."salaId",a."resueltaEn",
            t.co2,t.pm25,t.pm10,t.temperatura,t.humedad,t."recibidoEn",
            s.nombre AS "salaNombre",p.nombre AS "pisoNombre",ed.nombre AS "edificioNombre",sec.nombre AS "sectorNombre"
        FROM alertas a CROSS JOIN telegram_aviso_control control
        JOIN telemetria t ON t."salaId"=a."salaId" AND t."timestamp"=a."resueltaEn"
        JOIN salas s ON s.id=a."salaId" JOIN pisos p ON p.id=s."pisoId"
        JOIN edificios ed ON ed.id=p."edificioId" JOIN sectores sec ON sec.id=ed."sectorId"
        WHERE control.id=1 AND a.estado='resuelta' AND a."timestamp">=control."desdeEn"
          AND a."resueltaEn"<=NOW() AND t."recibidoEn">NOW()-INTERVAL '10 minutes'
          AND NOT EXISTS (SELECT 1 FROM telemetria next_window WHERE next_window."salaId"=a."salaId"
              AND next_window."timestamp"=a."resueltaEn"+INTERVAL '5 minutes')
          AND NOT EXISTS (SELECT 1 FROM alertas newer WHERE newer."salaId"=a."salaId"
              AND newer.variable=a.variable AND newer."ventanaConfirmacion">a."resueltaEn")
        ORDER BY a."resueltaEn" DESC LIMIT 100''')
    for row in rows:
        recipients = fetch_all('''SELECT tv."chatId" FROM telegram_vinculos tv
            JOIN usuarios u ON u.id=tv."usuarioId"
            JOIN telegram_preferencias_salas pref ON pref."usuarioId"=u.id AND pref."salaId"=%s
            JOIN salas s ON s.id=pref."salaId" JOIN pisos p ON p.id=s."pisoId"
            WHERE tv."chatVinculado"=TRUE AND tv."chatId">0 AND tv."avisosActivos"=TRUE
              AND (pref."pausadoHasta" IS NULL OR pref."pausadoHasta"<=NOW())
              AND u.estado='activo' AND (u.rol='ADMIN' OR p."edificioId"=ANY(u."assignedEdificios"))
              AND NOT EXISTS (SELECT 1 FROM telegram_avisos_enviados sent WHERE sent."alertaId"=%s
                  AND sent."chatId"=tv."chatId" AND sent.tipo='mejoria')''', (row["salaId"], row["id"]))
        key = str(row["variable"]).upper().replace(".", "").replace("_", "")
        variable, unit = TELEGRAM_VARIABLES.get(key, (row["variable"], ""))
        value = row.get({"CO2":"co2","PM25":"pm25","PM10":"pm10","TEMPERATURA":"temperatura","HUMEDAD":"humedad"}.get(key, ""))
        message = (f"🟡 La última medición mejoró; falta otra para confirmarlo.\n📍 {telegram_location(row)}\n"
                   f"{variable}: {telegram_measurement(value, unit)}\n"
                   f"Medida: {telegram_time(row['resueltaEn'])}\nRecibida: {telegram_time(row['recibidoEn'])}\n"
                   "Continúa observando el espacio.")
        for recipient in recipients:
            try:
                await telegram_send(recipient["chatId"], message)
                execute('''INSERT INTO telegram_avisos_enviados ("alertaId","chatId",tipo)
                    VALUES (%s,%s,'mejoria') ON CONFLICT DO NOTHING''', (row["id"], recipient["chatId"]))
            except Exception as exc:
                log.warning("No se pudo enviar aviso de mejoría (%s)", type(exc).__name__)


async def telegram_polling():
    offset = 0
    while True:
        try:
            await telegram_pending_improvements()
            await telegram_confirmed_resolutions()
            result = await asyncio.to_thread(telegram_api,"getUpdates",{"offset":offset,"timeout":20,"allowed_updates":"[\"message\",\"callback_query\"]"})
            for update in result or []:
                offset=max(offset,int(update["update_id"])+1)
                await telegram_handle_update(update)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("Bot de Telegram no disponible (%s)", type(exc).__name__)
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mqtt_client, telegram_task
    hub.loop = asyncio.get_running_loop()
    FIRMWARE_DIR.mkdir(parents=True, exist_ok=True)
    if MQTT_PASSWORD:
        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"calidad-api-{secrets.token_hex(4)}")
        mqtt_client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
        mqtt_client.on_connect = mqtt_on_connect
        mqtt_client.on_message = mqtt_on_message
        mqtt_client.reconnect_delay_set(1, 30)
        try:
            mqtt_client.connect_async(MQTT_HOST, 1883, keepalive=30)
            mqtt_client.loop_start()
        except Exception:
            log.exception("No se pudo iniciar el cliente MQTT")
    else:
        log.warning("MQTT_PASSWORD no configurada; ingesta MQTT desactivada")
    if TELEGRAM_BOT_TOKEN:
        telegram_task = asyncio.create_task(telegram_polling())
    else:
        log.info("Bot de Telegram desactivado: TELEGRAM_BOT_TOKEN está vacío")
    yield
    if telegram_task:
        telegram_task.cancel()
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


app = FastAPI(title="Calidad del Aire API", version="1.0.0", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","), allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def verify_same_origin_mutations(request: Request, call_next):
    """
    Nombre   : verify_same_origin_mutations
    Razón    : Rechaza escrituras iniciadas desde otro origen para reducir CSRF.
    Entradas : Petición HTTP y respuesta producida por FastAPI.
    Salida   : Respuesta normal o rechazo 403 por origen inválido.
    Efectos  : Añade no-store a respuestas de autenticación y aprovisionamiento.
    """
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        source = request.headers.get("origin") or request.headers.get("referer", "")
        parsed = urllib.parse.urlsplit(source)
        host = request.headers.get("host", "").lower()
        scheme = request.headers.get("x-forwarded-proto", request.url.scheme).split(",", 1)[0].strip().lower()
        if not parsed.netloc or parsed.netloc.lower() != host or parsed.scheme.lower() != scheme:
            return JSONResponse(status_code=403, content={"detail": "Origen no autorizado"})
    response = await call_next(request)
    if request.url.path.startswith("/auth/") or request.url.path.endswith("/aprovisionamiento"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    return response


def make_access(session_id: str, user: dict):
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": user["id"], "sid": session_id, "rol": user["rol"], "iat": now,
                       "exp": now + timedelta(minutes=ACCESS_MINUTES)}, JWT_SECRET, algorithm="HS256")


def session_from_token(token: str):
    if not JWT_SECRET:
        raise HTTPException(503, "Autenticación no configurada")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesión inválida o vencida")
    if payload.get("guest") is True and payload.get("sub") == "guest" and payload.get("sid") == "guest" and payload.get("rol") == "GUEST":
        expires = payload.get("exp")
        if not isinstance(expires, (int, float)):
            raise HTTPException(401, "Sesión de invitado inválida")
        return {"id": "guest", "nombre": "Invitado", "email": None, "telefono": None, "rol": "GUEST",
                "estado": "activo", "assignedEdificios": [], "sessionId": None,
                "tokenExpiresAt": datetime.fromtimestamp(expires, timezone.utc), "guestSession": True}
    row = fetch_one('''SELECT u.id,u.nombre,u.email,u.telefono,u.rol,u.estado,u."assignedEdificios",s.id AS "sessionId"
        FROM sesiones_usuario s JOIN usuarios u ON u.id=s."usuarioId"
        WHERE s.id=%s AND s."usuarioId"=%s AND s.revocada=FALSE AND s."expiraEn">NOW() AND u.estado='activo' ''',
        (payload.get("sid"), payload.get("sub")))
    if not row:
        raise HTTPException(401, "Sesión revocada o cuenta inactiva")
    execute('UPDATE sesiones_usuario SET "ultimaActividadEn"=NOW() WHERE id=%s', (row["sessionId"],))
    row["tokenExpiresAt"] = datetime.fromtimestamp(payload["exp"], timezone.utc)
    return row


def current_user(request: Request):
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(401, "Autenticación requerida")
    return session_from_token(token)


def allow_roles(*roles: str):
    def dependency(user=Depends(current_user)):
        if user["rol"] not in roles:
            raise HTTPException(403, "Permiso insuficiente")
        return user
    return dependency


@app.get("/auth/sesion")
def auth_session(user=Depends(current_user)):
    """
    Nombre   : auth_session
    Razón    : Restaura la interfaz desde la cookie sin exponer el JWT a JavaScript.
    Entradas : Cookie de acceso validada por current_user.
    Salida   : Datos de sesión mínimos necesarios para representar el rol.
    Efectos  : Ninguno; solo consulta y actualiza la actividad de la sesión.
    """
    return {key: user.get(key) for key in ("id", "nombre", "email", "telefono", "rol", "assignedEdificios")}


def allowed_buildings(user):
    return None if user["rol"] in ("ADMIN", "GUEST") else (user["assignedEdificios"] or [])


def without_restricted_history(rows, user):
    if user["rol"] not in ("GUEST", "VIEWER"):
        return rows
    hidden = {"telemetriaTotal", "telemetriaInciertaTotal", "alertasTotal"}
    return [{key: value for key, value in row.items() if key not in hidden} for row in rows]


def ensure_room_access(user, sala_id: str):
    row = fetch_one('''SELECT ed.id AS "edificioId" FROM salas s JOIN pisos p ON p.id=s."pisoId"
        JOIN edificios ed ON ed.id=p."edificioId" WHERE s.id=%s''', (sala_id,))
    if not row:
        raise HTTPException(404, "Sala no encontrada")
    allowed = allowed_buildings(user)
    if allowed is not None and row["edificioId"] not in allowed:
        raise HTTPException(403, "Sala fuera de su ámbito autorizado")


def jsonable(row):
    if row is None:
        return None
    return {k: (v.isoformat() if isinstance(v, datetime) else str(v) if isinstance(v, UUID) else v) for k, v in row.items()}


def scoped_sql(alias: str, user) -> tuple[str, tuple]:
    allowed = allowed_buildings(user)
    if allowed is None:
        return "", ()
    return f' AND {alias}."edificioId" = ANY(%s)', (allowed,)


def location_history_counts(cur, entity: str, entity_id: str):
    scope = {
        "sector": 'ed."sectorId"=%s',
        "building": 'ed.id=%s',
        "floor": 'p.id=%s',
        "room": 'r.id=%s',
    }[entity]
    joins = '''JOIN salas r ON r.id=ref."salaId" JOIN pisos p ON p.id=r."pisoId"
        JOIN edificios ed ON ed.id=p."edificioId" JOIN sectores sec ON sec.id=ed."sectorId"'''
    cur.execute(f'''SELECT
        (SELECT COUNT(*) FROM telemetria ref {joins} WHERE {scope}) AS telemetria,
        (SELECT COUNT(*) FROM telemetria_tiempo_incierto ref {joins} WHERE {scope}) AS telemetriaIncierta,
        (SELECT COUNT(*) FROM alertas ref {joins} WHERE {scope}) AS alertas,
        (SELECT COUNT(*) FROM nodos n JOIN salas r ON r.id=n."salaId" JOIN pisos p ON p.id=r."pisoId"
            JOIN edificios ed ON ed.id=p."edificioId" WHERE {scope.replace('r.', 'r.').replace('ed.', 'ed.').replace('p.', 'p.')}) AS nodos''',
        (entity_id, entity_id, entity_id, entity_id))
    return cur.fetchone()


def location_descendant_counts(cur, entity: str, entity_id: str):
    if entity == "sector":
        cur.execute('''SELECT
            (SELECT COUNT(*) FROM edificios WHERE "sectorId"=%s AND "retiradoEn" IS NULL) AS edificios,
            (SELECT COUNT(*) FROM pisos p JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=%s AND p."retiradoEn" IS NULL) AS pisos,
            (SELECT COUNT(*) FROM salas r JOIN pisos p ON p.id=r."pisoId" JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=%s AND r."retiradoEn" IS NULL) AS salas''', (entity_id, entity_id, entity_id))
    elif entity == "building":
        cur.execute('''SELECT
            (SELECT COUNT(*) FROM pisos WHERE "edificioId"=%s AND "retiradoEn" IS NULL) AS pisos,
            (SELECT COUNT(*) FROM salas r JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=%s AND r."retiradoEn" IS NULL) AS salas''', (entity_id, entity_id))
    elif entity == "floor":
        cur.execute('SELECT COUNT(*) AS salas FROM salas WHERE "pisoId"=%s AND "retiradoEn" IS NULL', (entity_id,))
    else:
        cur.execute('SELECT 0 AS salas')
    return cur.fetchone()


def retire_location(entity: str, entity_id: str, user, borrar_historial: bool = False):
    tables = {"sector": "sectores", "building": "edificios", "floor": "pisos", "room": "salas"}
    table = tables[entity]
    location_sql = {
        "sector": '''SELECT id,nombre,descripcion,"retiradoEn",NULL::text AS "sectorNombre",NULL::text AS "edificioNombre",
            NULL::text AS "pisoNombre",NULL::text AS "salaNombre" FROM sectores WHERE id=%s FOR UPDATE''',
        "building": '''SELECT ed.id,ed.nombre,ed."retiradoEn",NULL::text AS descripcion,sec.nombre AS "sectorNombre",
            ed.nombre AS "edificioNombre",NULL::text AS "pisoNombre",NULL::text AS "salaNombre"
            FROM edificios ed JOIN sectores sec ON sec.id=ed."sectorId" WHERE ed.id=%s FOR UPDATE OF ed''',
        "floor": '''SELECT p.id,p.nombre,p."retiradoEn",NULL::text AS descripcion,sec.nombre AS "sectorNombre",
            ed.nombre AS "edificioNombre",p.nombre AS "pisoNombre",NULL::text AS "salaNombre"
            FROM pisos p JOIN edificios ed ON ed.id=p."edificioId" JOIN sectores sec ON sec.id=ed."sectorId"
            WHERE p.id=%s FOR UPDATE OF p''',
        "room": '''SELECT r.id,r.nombre,r."retiradoEn",NULL::text AS descripcion,sec.nombre AS "sectorNombre",
            ed.nombre AS "edificioNombre",p.nombre AS "pisoNombre",r.nombre AS "salaNombre"
            FROM salas r JOIN pisos p ON p.id=r."pisoId" JOIN edificios ed ON ed.id=p."edificioId"
            JOIN sectores sec ON sec.id=ed."sectorId" WHERE r.id=%s FOR UPDATE OF r''',
    }[entity]
    with db() as conn, conn.cursor() as cur:
        cur.execute(location_sql, (entity_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, f"{entity.title()} no encontrado")
        if row.get("retiradoEn"):
            return {"id": entity_id, "tipo": entity, "yaRetirado": True}
        history = location_history_counts(cur, entity, entity_id)
        descendants = location_descendant_counts(cur, entity, entity_id)
        context = {"tipo": entity, "id": entity_id, "nombre": row["nombre"],
                   "sector": row["sectorNombre"], "edificio": row["edificioNombre"],
                   "piso": row["pisoNombre"], "sala": row["salaNombre"],
                   "retiradoPor": user["id"], "historial": history, "descendientes": descendants}

        scope_rooms = {
            "sector": 'JOIN pisos p ON p.id=r."pisoId" JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=%s',
            "building": 'JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=%s',
            "floor": 'WHERE r."pisoId"=%s',
            "room": 'WHERE r.id=%s',
        }[entity]
        if borrar_historial:
            cur.execute(f'''SELECT r.id FROM salas r {scope_rooms}''', (entity_id,))
            room_ids = [item["id"] for item in cur.fetchall()]
            if room_ids:
                cur.execute('DELETE FROM alertas WHERE "salaId"=ANY(%s)', (room_ids,))
                cur.execute('DELETE FROM telemetria_tiempo_incierto WHERE "salaId"=ANY(%s)', (room_ids,))
                cur.execute('DELETE FROM telemetria WHERE "salaId"=ANY(%s)', (room_ids,))
        cur.execute(f'''UPDATE nodos n SET "salaId"=NULL,"updatedAt"=NOW()
            WHERE n."retiradoEn" IS NULL AND n."salaId" IN
                (SELECT r.id FROM salas r {scope_rooms})''', (entity_id,))
        unassigned_nodes = cur.rowcount

        if entity == "sector":
            cur.execute('''UPDATE salas r SET "retiradoEn"=NOW(),"retiroContexto"=%s
                FROM pisos p JOIN edificios ed ON ed.id=p."edificioId"
                WHERE r."pisoId"=p.id AND ed."sectorId"=%s AND r."retiradoEn" IS NULL''', (Jsonb(context), entity_id))
            cur.execute('''UPDATE pisos p SET "retiradoEn"=NOW(),"retiroContexto"=%s
                FROM edificios ed WHERE ed.id=p."edificioId" AND ed."sectorId"=%s AND p."retiradoEn" IS NULL''', (Jsonb(context), entity_id))
            cur.execute('UPDATE edificios SET "retiradoEn"=NOW(),"retiroContexto"=%s WHERE "sectorId"=%s AND "retiradoEn" IS NULL', (Jsonb(context), entity_id))
        elif entity == "building":
            cur.execute('''UPDATE salas r SET "retiradoEn"=NOW(),"retiroContexto"=%s
                FROM pisos p WHERE r."pisoId"=p.id AND p."edificioId"=%s AND r."retiradoEn" IS NULL''', (Jsonb(context), entity_id))
            cur.execute('UPDATE pisos SET "retiradoEn"=NOW(),"retiroContexto"=%s WHERE "edificioId"=%s AND "retiradoEn" IS NULL', (Jsonb(context), entity_id))
        elif entity == "floor":
            cur.execute('UPDATE salas SET "retiradoEn"=NOW(),"retiroContexto"=%s WHERE "pisoId"=%s AND "retiradoEn" IS NULL', (Jsonb(context), entity_id))

        cur.execute(f'''UPDATE {table} SET "retiradoEn"=NOW(),"retiroContexto"=%s
            WHERE id=%s AND "retiradoEn" IS NULL RETURNING "retiradoEn"''', (Jsonb(context), entity_id))
        retired = cur.fetchone()
        if not retired:
            raise HTTPException(409, "La ubicación ya fue retirada; actualiza la lista")
    return {"id": entity_id, "tipo": entity, "retiradoEn": retired["retiradoEn"],
            "ubicacion": context, "descendientes": descendants, "historial": history,
            "historialEliminado": borrar_historial, "nodosDesasignados": unassigned_nodes}


@app.get("/healthz")
def healthz():
    try:
        fetch_one("SELECT 1 AS ok")
        return {"status": "ok"}
    except psycopg.Error:
        raise HTTPException(503, "Servicio no disponible")


@app.post("/auth/login")
def login(body: LoginIn, response: Response):
    row = fetch_one('SELECT id,nombre,email,telefono,rol,estado,password,"assignedEdificios" FROM usuarios WHERE lower(email)=lower(%s)', (body.email.strip(),))
    if not row or row["estado"] != "activo" or not bcrypt.checkpw(body.password.encode(), row["password"].encode()):
        raise HTTPException(401, "Credenciales inválidas")
    if row["rol"] == "GUEST":
        raise HTTPException(403, "El acceso de invitado no usa credenciales. Selecciona «Ingresar como invitado».")
    refresh = secrets.token_urlsafe(48)
    with db() as conn, conn.cursor() as cur:
        cur.execute('INSERT INTO sesiones_usuario ("usuarioId","refreshTokenHash","expiraEn") VALUES (%s,%s,%s) RETURNING id',
                    (row["id"], hashlib.sha256(refresh.encode()).hexdigest(), datetime.now(timezone.utc)+timedelta(days=REFRESH_DAYS)))
        session_id = str(cur.fetchone()["id"])
    access = make_access(session_id, row)
    response.set_cookie("access_token", access, httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower()=="true", samesite="lax", max_age=ACCESS_MINUTES*60)
    response.set_cookie("refresh_token", refresh, httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower()=="true", samesite="lax", max_age=REFRESH_DAYS*86400, path="/auth")
    return {"tokenType": "cookie", "expiresIn": ACCESS_MINUTES*60,
            "usuario": {k: row[k] for k in ("id", "nombre", "email", "telefono", "rol", "assignedEdificios")}}


@app.post("/auth/invitado")
def guest_login(response: Response):
    if not JWT_SECRET:
        raise HTTPException(503, "Autenticación no configurada")
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=8)
    access = jwt.encode({"sub": "guest", "sid": "guest", "rol": "GUEST", "guest": True,
                         "iat": now, "exp": expires}, JWT_SECRET, algorithm="HS256")
    response.set_cookie("access_token", access, httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower()=="true", samesite="lax", max_age=8*60*60)
    response.delete_cookie("refresh_token", path="/auth")
    return {"tokenType": "cookie", "expiresIn": 8*60*60,
            "usuario": {"id": "guest", "nombre": "Invitado", "email": None, "telefono": None,
                        "rol": "GUEST", "assignedEdificios": []}}


@app.post("/auth/renovar")
def refresh_session(request: Request, response: Response):
    refresh = request.cookies.get("refresh_token")
    if not refresh:
        raise HTTPException(401, "Refresh token requerido")
    token_hash = hashlib.sha256(refresh.encode()).hexdigest()
    row = fetch_one('''SELECT s.id AS "sessionId",u.id,u.nombre,u.email,u.telefono,u.rol,u.estado,u."assignedEdificios"
        FROM sesiones_usuario s JOIN usuarios u ON u.id=s."usuarioId"
        WHERE s."refreshTokenHash"=%s AND s.revocada=FALSE AND s."expiraEn">NOW()
          AND s."ultimaActividadEn">NOW()-(%s * INTERVAL '1 minute') AND u.estado='activo' ''', (token_hash, SESSION_IDLE_MINUTES))
    if not row:
        execute('UPDATE sesiones_usuario SET revocada=TRUE WHERE "refreshTokenHash"=%s AND revocada=FALSE', (token_hash,))
        raise HTTPException(401, "Refresh token inválido")
    new_refresh = secrets.token_urlsafe(48)
    with db() as conn, conn.cursor() as cur:
        cur.execute('''UPDATE sesiones_usuario SET "refreshTokenHash"=%s,"expiraEn"=%s,"ultimaActividadEn"=NOW()
            WHERE id=%s AND "refreshTokenHash"=%s AND revocada=FALSE RETURNING id''',
                    (hashlib.sha256(new_refresh.encode()).hexdigest(), datetime.now(timezone.utc)+timedelta(days=REFRESH_DAYS), row["sessionId"], token_hash))
        if not cur.fetchone():
            raise HTTPException(401, "Refresh token ya utilizado")
    access = make_access(str(row["sessionId"]), row)
    response.set_cookie("access_token", access, httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower()=="true", samesite="lax", max_age=ACCESS_MINUTES*60)
    response.set_cookie("refresh_token", new_refresh, httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower()=="true", samesite="lax", max_age=REFRESH_DAYS*86400, path="/auth")
    return {"tokenType": "cookie", "expiresIn": ACCESS_MINUTES*60}


@app.post("/auth/logout")
def logout(response: Response, user=Depends(current_user)):
    if user["sessionId"]:
        execute("UPDATE sesiones_usuario SET revocada=TRUE WHERE id=%s", (user["sessionId"],))
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token", path="/auth")
    return {"ok": True}


@app.get("/perfil")
def get_profile(user=Depends(allow_roles("ADMIN", "ANALISTA", "VIEWER"))):
    return {k: user[k] for k in ("id", "nombre", "email", "telefono", "rol", "assignedEdificios")}


@app.patch("/perfil")
def update_profile(body: dict[str, Any], user=Depends(current_user)):
    if user["rol"] == "GUEST":
        raise HTTPException(403, "El acceso de invitado es de solo lectura")
    allowed = {k: v for k, v in body.items() if k in ("nombre", "telefono")}
    if "password" in body:
        password = body["password"]
        if not isinstance(password, str) or len(password) < 12 or len(password) > 128:
            raise HTTPException(422, "La contraseña debe tener entre 12 y 128 caracteres")
        current_password = body.get("currentPassword")
        row = fetch_one("SELECT password FROM usuarios WHERE id=%s", (user["id"],))
        if not isinstance(current_password, str) or not row or not bcrypt.checkpw(current_password.encode(), row["password"].encode()):
            raise HTTPException(403, "La contraseña actual es incorrecta")
        allowed["password"] = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    if not allowed:
        raise HTTPException(400, "No hay campos de perfil válidos")
    assignments = ",".join(f'"{k}"=%s' for k in allowed)
    execute(f'UPDATE usuarios SET {assignments},"updatedAt"=NOW() WHERE id=%s', (*allowed.values(), user["id"]))
    return fetch_one('SELECT id,nombre,email,telefono,rol,"assignedEdificios" FROM usuarios WHERE id=%s', (user["id"],))


@app.get("/espacios/resumen")
def spaces_summary(user=Depends(allow_roles("ADMIN"))):
    """
    Nombre   : spaces_summary
    Razón    : Carga en una sola consulta las listas usadas al abrir Espacios.
    Entradas : Usuario autenticado; solo se admite el rol ADMIN.
    Salida   : Objeto con sectores, edificios, pisos y salas activos.
    Efectos  : Ninguno; consulta PostgreSQL sin conteos históricos.
    """
    return fetch_one('''SELECT
        (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.nombre), '[]'::jsonb) FROM (
            SELECT se.id,se.nombre,se.descripcion,
                (SELECT COUNT(*) FROM edificios ed WHERE ed."sectorId"=se.id AND ed."retiradoEn" IS NULL) AS "edificiosActivos",
                (SELECT COUNT(*) FROM pisos p JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=se.id AND ed."retiradoEn" IS NULL AND p."retiradoEn" IS NULL) AS "pisosActivos",
                (SELECT COUNT(*) FROM salas r JOIN pisos p ON p.id=r."pisoId" JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=se.id AND r."retiradoEn" IS NULL) AS "salasActivas",
                (SELECT COUNT(*) FROM nodos n JOIN salas r ON r.id=n."salaId" JOIN pisos p ON p.id=r."pisoId" JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=se.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
            FROM sectores se WHERE se."retiradoEn" IS NULL
        ) x) AS sectores,
        (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.nombre), '[]'::jsonb) FROM (
            SELECT ed.id,ed."sectorId",ed.nombre,ed.direccion,
                (SELECT COUNT(*) FROM pisos p WHERE p."edificioId"=ed.id AND p."retiradoEn" IS NULL) AS "pisosActivos",
                (SELECT COUNT(*) FROM salas r JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=ed.id AND r."retiradoEn" IS NULL) AS "salasActivas",
                (SELECT COUNT(*) FROM nodos n JOIN salas r ON r.id=n."salaId" JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=ed.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
            FROM edificios ed JOIN sectores se ON se.id=ed."sectorId" WHERE ed."retiradoEn" IS NULL AND se."retiradoEn" IS NULL
        ) x) AS edificios,
        (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x."edificioId",x.nivel), '[]'::jsonb) FROM (
            SELECT p.id,p."edificioId",p.nombre,p.nivel,
                (SELECT COUNT(*) FROM salas r WHERE r."pisoId"=p.id AND r."retiradoEn" IS NULL) AS "salasActivas",
                (SELECT COUNT(*) FROM nodos n JOIN salas r ON r.id=n."salaId" WHERE r."pisoId"=p.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
            FROM pisos p JOIN edificios ed ON ed.id=p."edificioId" JOIN sectores se ON se.id=ed."sectorId"
            WHERE p."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL AND se."retiradoEn" IS NULL
        ) x) AS pisos,
        (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.nombre), '[]'::jsonb) FROM (
            SELECT s.id,s."pisoId",p."edificioId",ed."sectorId",s.nombre,s."capacidadOcupantes",
                sec.nombre AS "sectorNombre",ed.nombre AS "edificioNombre",p.nombre AS "pisoNombre",
                (SELECT COUNT(*) FROM nodos n WHERE n."salaId"=s.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
            FROM salas s JOIN pisos p ON p.id=s."pisoId" JOIN edificios ed ON ed.id=p."edificioId"
            JOIN sectores sec ON sec.id=ed."sectorId"
            WHERE s."retiradoEn" IS NULL AND p."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL
        ) x) AS salas''')


@app.get("/sectores")
def sectores(incluirConteosHistorial: bool = True, user=Depends(allow_roles("ADMIN", "ANALISTA", "VIEWER", "GUEST"))):
    if user["rol"] == "ADMIN":
        rows = fetch_all('''SELECT se.id,se.nombre,se.descripcion,
            (SELECT COUNT(*) FROM edificios ed WHERE ed."sectorId"=se.id AND ed."retiradoEn" IS NULL) AS "edificiosActivos",
            (SELECT COUNT(*) FROM pisos p JOIN edificios ed ON ed.id=p."edificioId"
                WHERE ed."sectorId"=se.id AND ed."retiradoEn" IS NULL AND p."retiradoEn" IS NULL) AS "pisosActivos",
            (SELECT COUNT(*) FROM salas r JOIN pisos p ON p.id=r."pisoId" JOIN edificios ed ON ed.id=p."edificioId"
                WHERE ed."sectorId"=se.id AND r."retiradoEn" IS NULL) AS "salasActivas",
            CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria t JOIN salas r ON r.id=t."salaId" JOIN pisos p ON p.id=r."pisoId"
                JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=se.id) ELSE NULL::bigint END AS "telemetriaTotal",
            CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria_tiempo_incierto ti JOIN salas r ON r.id=ti."salaId" JOIN pisos p ON p.id=r."pisoId"
                JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=se.id) ELSE NULL::bigint END AS "telemetriaInciertaTotal",
            CASE WHEN %s THEN (SELECT COUNT(*) FROM alertas a JOIN salas r ON r.id=a."salaId" JOIN pisos p ON p.id=r."pisoId"
                JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=se.id) ELSE NULL::bigint END AS "alertasTotal",
            (SELECT COUNT(*) FROM nodos n JOIN salas r ON r.id=n."salaId" JOIN pisos p ON p.id=r."pisoId"
                JOIN edificios ed ON ed.id=p."edificioId" WHERE ed."sectorId"=se.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
            FROM sectores se WHERE se."retiradoEn" IS NULL ORDER BY se.nombre''',
            (incluirConteosHistorial, incluirConteosHistorial, incluirConteosHistorial))
        return without_restricted_history(rows, user)
    suffix, params = scoped_sql("ed", user)
    return fetch_all('''SELECT DISTINCT se.id,se.nombre,se.descripcion FROM sectores se
        JOIN edificios ed ON ed."sectorId"=se.id JOIN pisos p ON p."edificioId"=ed.id
        JOIN salas s ON s."pisoId"=p.id WHERE se."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL
        AND p."retiradoEn" IS NULL AND s."retiradoEn" IS NULL'''+suffix+" ORDER BY se.nombre", params)


@app.get("/campus")
def campus(user=Depends(current_user)):
    allowed = allowed_buildings(user)
    suffix = ' AND ed.id=ANY(%s)' if allowed is not None else ''
    params = (allowed,) if allowed is not None else ()
    with db() as conn, conn.cursor() as cur:
        def read(sql, args):
            cur.execute(sql, args)
            return cur.fetchall()
        sectors = read('''SELECT DISTINCT se.id,se.nombre,se.descripcion FROM sectores se
        LEFT JOIN edificios ed ON ed."sectorId"=se.id AND ed."retiradoEn" IS NULL
        WHERE se."retiradoEn" IS NULL'''+suffix+" ORDER BY se.nombre", params)
        buildings = read('''SELECT ed.id,ed."sectorId",ed.nombre,ed.direccion FROM edificios ed
        JOIN sectores se ON se.id=ed."sectorId" WHERE ed."retiradoEn" IS NULL AND se."retiradoEn" IS NULL'''+suffix+" ORDER BY ed.nombre", params)
        floors = read('''SELECT p.id,p."edificioId",p.nombre,p.nivel FROM pisos p
        JOIN edificios ed ON ed.id=p."edificioId" JOIN sectores se ON se.id=ed."sectorId"
        WHERE p."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL AND se."retiradoEn" IS NULL'''+suffix+" ORDER BY ed.nombre,p.nivel", params)
        rooms = read('''SELECT s.id,s."pisoId",p."edificioId",ed."sectorId",s.nombre,
        sec.nombre AS "sectorNombre",ed.nombre AS "edificioNombre",p.nombre AS "pisoNombre"
        FROM salas s JOIN pisos p ON p.id=s."pisoId" JOIN edificios ed ON ed.id=p."edificioId"
        JOIN sectores sec ON sec.id=ed."sectorId" WHERE s."retiradoEn" IS NULL
        AND p."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL'''+suffix+" ORDER BY s.nombre", params)
        states = read('''SELECT v.* FROM vw_estado_actual_salas v JOIN pisos p ON p.id=v."pisoId"
        WHERE TRUE'''+suffix.replace('ed.id','p."edificioId"')+' ORDER BY v."salaNombre"', params)
        return {"sectors": sectors, "buildings": buildings, "floors": floors, "rooms": rooms, "states": states}


@app.post("/sectores", status_code=201)
def create_sector(body: SectorIn, user=Depends(allow_roles("ADMIN"))):
    try:
        return fetch_one("INSERT INTO sectores(nombre,descripcion) VALUES (%s,%s) RETURNING id,nombre,descripcion", (body.nombre, body.descripcion))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Ya existe un sector con ese nombre")


@app.patch("/sectores/{sectorId}")
def update_sector(sectorId: str, body: SectorPatch, user=Depends(allow_roles("ADMIN"))):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "No hay cambios para guardar")
    assignments = ",".join(f'"{key}"=%s' for key in fields)
    try:
        row = fetch_one(f'UPDATE sectores SET {assignments} WHERE id=%s AND "retiradoEn" IS NULL RETURNING id,nombre,descripcion', (*fields.values(), sectorId))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Ya existe un sector con ese nombre")
    if not row: raise HTTPException(404, "Sector no encontrado")
    return row


@app.delete("/sectores/{sectorId}")
def delete_sector(sectorId: str, body: dict[str, bool] = Body(default={}), user=Depends(allow_roles("ADMIN"))):
    return retire_location("sector", sectorId, user, bool(body.get("borrarHistorial")))


@app.get("/edificios")
def edificios(sectorId: str | None = None, incluirConteosHistorial: bool = True, user=Depends(allow_roles("ADMIN", "ANALISTA", "VIEWER", "GUEST"))):
    suffix, params = scoped_sql("ed", user)
    where = ' WHERE ed."retiradoEn" IS NULL AND se."retiradoEn" IS NULL AND (%s::text IS NULL OR ed."sectorId"=%s::text)'+suffix
    rows = fetch_all('''SELECT ed.id,ed."sectorId",ed.nombre,ed.direccion,
        (SELECT COUNT(*) FROM pisos p WHERE p."edificioId"=ed.id AND p."retiradoEn" IS NULL) AS "pisosActivos",
        (SELECT COUNT(*) FROM salas r JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=ed.id AND r."retiradoEn" IS NULL) AS "salasActivas",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria t JOIN salas r ON r.id=t."salaId" JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=ed.id) ELSE NULL::bigint END AS "telemetriaTotal",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria_tiempo_incierto ti JOIN salas r ON r.id=ti."salaId" JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=ed.id) ELSE NULL::bigint END AS "telemetriaInciertaTotal",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM alertas a JOIN salas r ON r.id=a."salaId" JOIN pisos p ON p.id=r."pisoId" WHERE p."edificioId"=ed.id) ELSE NULL::bigint END AS "alertasTotal"
        ,(SELECT COUNT(*) FROM nodos n JOIN salas r ON r.id=n."salaId" JOIN pisos p ON p.id=r."pisoId"
            WHERE p."edificioId"=ed.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
        FROM edificios ed JOIN sectores se ON se.id=ed."sectorId"'''+where+' ORDER BY ed.nombre',
        (incluirConteosHistorial, incluirConteosHistorial, incluirConteosHistorial, sectorId, sectorId, *params))
    return without_restricted_history(rows, user)


@app.post("/edificios", status_code=201)
def create_building(body: BuildingIn, user=Depends(allow_roles("ADMIN"))):
    try:
        if not fetch_one('SELECT id FROM sectores WHERE id=%s AND "retiradoEn" IS NULL', (body.sectorId,)):
            raise HTTPException(404, "Sector no encontrado o retirado")
        return fetch_one('INSERT INTO edificios("sectorId",nombre,direccion) VALUES (%s,%s,%s) RETURNING id,"sectorId",nombre,direccion', (body.sectorId, body.nombre, body.direccion))
    except HTTPException:
        raise
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(404, "Sector no encontrado")
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Ya existe un edificio con ese nombre en el sector")


@app.patch("/edificios/{edificioId}")
def update_building(edificioId: str, body: BuildingPatch, user=Depends(allow_roles("ADMIN"))):
    fields = body.model_dump(exclude_unset=True)
    if not fields: raise HTTPException(400, "No hay cambios para guardar")
    assignments = ",".join(f'"{key}"=%s' for key in fields)
    try:
        if "sectorId" in fields and fields["sectorId"] is not None and not fetch_one('SELECT id FROM sectores WHERE id=%s AND "retiradoEn" IS NULL', (fields["sectorId"],)):
            raise HTTPException(404, "Sector no encontrado o retirado")
        row = fetch_one(f'UPDATE edificios SET {assignments} WHERE id=%s AND "retiradoEn" IS NULL RETURNING id,"sectorId",nombre,direccion', (*fields.values(), edificioId))
    except HTTPException:
        raise
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(404, "Sector no encontrado")
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Ya existe un edificio con ese nombre en el sector")
    if not row: raise HTTPException(404, "Edificio no encontrado")
    return row


@app.delete("/edificios/{edificioId}")
def delete_building(edificioId: str, body: dict[str, bool] = Body(default={}), user=Depends(allow_roles("ADMIN"))):
    return retire_location("building", edificioId, user, bool(body.get("borrarHistorial")))


@app.get("/pisos")
def pisos(edificioId: str | None = None, incluirConteosHistorial: bool = True, user=Depends(allow_roles("ADMIN", "ANALISTA", "VIEWER", "GUEST"))):
    suffix, params = scoped_sql("p", user)
    rows = fetch_all('''SELECT p.id,p."edificioId",p.nombre,p.nivel,
        (SELECT COUNT(*) FROM salas r WHERE r."pisoId"=p.id AND r."retiradoEn" IS NULL) AS "salasActivas",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria t JOIN salas r ON r.id=t."salaId" WHERE r."pisoId"=p.id) ELSE NULL::bigint END AS "telemetriaTotal",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria_tiempo_incierto ti JOIN salas r ON r.id=ti."salaId" WHERE r."pisoId"=p.id) ELSE NULL::bigint END AS "telemetriaInciertaTotal",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM alertas a JOIN salas r ON r.id=a."salaId" WHERE r."pisoId"=p.id) ELSE NULL::bigint END AS "alertasTotal"
        ,(SELECT COUNT(*) FROM nodos n JOIN salas r ON r.id=n."salaId" WHERE r."pisoId"=p.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
        FROM pisos p JOIN edificios ed ON ed.id=p."edificioId" JOIN sectores se ON se.id=ed."sectorId"
        WHERE p."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL AND se."retiradoEn" IS NULL
        AND (%s::text IS NULL OR p."edificioId"=%s::text)'''+suffix+' ORDER BY p."edificioId",p.nivel',
        (incluirConteosHistorial, incluirConteosHistorial, incluirConteosHistorial, edificioId, edificioId, *params))
    return without_restricted_history(rows, user)


@app.post("/pisos", status_code=201)
def create_floor(body: FloorIn, user=Depends(allow_roles("ADMIN"))):
    try:
        if not fetch_one('SELECT id FROM edificios WHERE id=%s AND "retiradoEn" IS NULL', (body.edificioId,)):
            raise HTTPException(404, "Edificio no encontrado o retirado")
        return fetch_one('INSERT INTO pisos("edificioId",nombre,nivel) VALUES (%s,%s,%s) RETURNING id,"edificioId",nombre,nivel', (body.edificioId, body.nombre, body.nivel))
    except HTTPException:
        raise
    except psycopg.errors.ForeignKeyViolation: raise HTTPException(404, "Edificio no encontrado")
    except psycopg.errors.UniqueViolation: raise HTTPException(409, "Ya existe un piso con ese nombre o nivel en el edificio")


@app.patch("/pisos/{pisoId}")
def update_floor(pisoId: str, body: FloorPatch, user=Depends(allow_roles("ADMIN"))):
    fields = body.model_dump(exclude_unset=True)
    if not fields: raise HTTPException(400, "No hay cambios para guardar")
    assignments = ",".join(f'"{key}"=%s' for key in fields)
    try:
        if "edificioId" in fields and fields["edificioId"] is not None and not fetch_one('SELECT id FROM edificios WHERE id=%s AND "retiradoEn" IS NULL', (fields["edificioId"],)):
            raise HTTPException(404, "Edificio no encontrado o retirado")
        row = fetch_one(f'UPDATE pisos SET {assignments} WHERE id=%s AND "retiradoEn" IS NULL RETURNING id,"edificioId",nombre,nivel', (*fields.values(), pisoId))
    except HTTPException:
        raise
    except psycopg.errors.ForeignKeyViolation: raise HTTPException(404, "Edificio no encontrado")
    except psycopg.errors.UniqueViolation: raise HTTPException(409, "Ya existe un piso con ese nivel en el edificio")
    if not row: raise HTTPException(404, "Piso no encontrado")
    return row


@app.delete("/pisos/{pisoId}")
def delete_floor(pisoId: str, body: dict[str, bool] = Body(default={}), user=Depends(allow_roles("ADMIN"))):
    return retire_location("floor", pisoId, user, bool(body.get("borrarHistorial")))


@app.get("/salas")
def salas(pisoId: str | None = None, edificioId: str | None = None, incluirConteosHistorial: bool = True, user=Depends(allow_roles("ADMIN", "ANALISTA", "VIEWER", "GUEST"))):
    suffix, params = scoped_sql("p", user)
    rows = fetch_all('''SELECT s.id,s."pisoId",p."edificioId",ed."sectorId",s.nombre,s."capacidadOcupantes",
        sec.nombre AS "sectorNombre",ed.nombre AS "edificioNombre",p.nombre AS "pisoNombre",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria t WHERE t."salaId"=s.id) ELSE NULL::bigint END AS "telemetriaTotal",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM telemetria_tiempo_incierto ti WHERE ti."salaId"=s.id) ELSE NULL::bigint END AS "telemetriaInciertaTotal",
        CASE WHEN %s THEN (SELECT COUNT(*) FROM alertas a WHERE a."salaId"=s.id) ELSE NULL::bigint END AS "alertasTotal",
        (SELECT COUNT(*) FROM nodos n WHERE n."salaId"=s.id AND n."retiradoEn" IS NULL) AS "nodosActivos"
        FROM salas s JOIN pisos p ON p.id=s."pisoId" JOIN edificios ed ON ed.id=p."edificioId"
        JOIN sectores sec ON sec.id=ed."sectorId"
        WHERE s."retiradoEn" IS NULL AND p."retiradoEn" IS NULL AND ed."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL
        AND (%s::text IS NULL OR s."pisoId"=%s::text) AND (%s::text IS NULL OR p."edificioId"=%s::text)'''+suffix+' ORDER BY s.nombre',
        (incluirConteosHistorial, incluirConteosHistorial, incluirConteosHistorial, pisoId,pisoId,edificioId,edificioId,*params))
    return without_restricted_history(rows, user)


@app.post("/salas", status_code=201)
def create_room(body: RoomIn, user=Depends(allow_roles("ADMIN"))):
    try:
        if not fetch_one('''SELECT p.id FROM pisos p JOIN edificios ed ON ed.id=p."edificioId"
            JOIN sectores sec ON sec.id=ed."sectorId" WHERE p.id=%s AND p."retiradoEn" IS NULL
            AND ed."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL''', (body.pisoId,)):
            raise HTTPException(404, "Piso no encontrado o retirado")
        return fetch_one('INSERT INTO salas("pisoId",nombre,"capacidadOcupantes") VALUES (%s,%s,%s) RETURNING id,"pisoId",nombre,"capacidadOcupantes"', (body.pisoId, body.nombre, body.capacidadOcupantes))
    except HTTPException:
        raise
    except psycopg.errors.ForeignKeyViolation: raise HTTPException(404, "Piso no encontrado")
    except psycopg.errors.UniqueViolation: raise HTTPException(409, "Ya existe una sala con ese nombre en el piso")


@app.patch("/salas/{salaId}")
def update_room(salaId: str, body: RoomPatch, user=Depends(allow_roles("ADMIN"))):
    fields = body.model_dump(exclude_unset=True)
    if not fields: raise HTTPException(400, "No hay cambios para guardar")
    assignments = ",".join(f'"{key}"=%s' for key in fields)
    try:
        if "pisoId" in fields and fields["pisoId"] is not None and not fetch_one('''SELECT p.id FROM pisos p JOIN edificios ed ON ed.id=p."edificioId"
            JOIN sectores sec ON sec.id=ed."sectorId" WHERE p.id=%s AND p."retiradoEn" IS NULL
            AND ed."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL''', (fields["pisoId"],)):
            raise HTTPException(404, "Piso no encontrado o retirado")
        row = fetch_one(f'UPDATE salas SET {assignments} WHERE id=%s AND "retiradoEn" IS NULL RETURNING id,"pisoId",nombre,"capacidadOcupantes"', (*fields.values(), salaId))
    except HTTPException:
        raise
    except psycopg.errors.ForeignKeyViolation: raise HTTPException(404, "Piso no encontrado")
    except psycopg.errors.UniqueViolation: raise HTTPException(409, "Ya existe una sala con ese nombre en el piso")
    if not row: raise HTTPException(404, "Sala no encontrada")
    return row


@app.delete("/salas/{salaId}")
def delete_room(salaId: str, body: dict[str, bool] = Body(default={}), user=Depends(allow_roles("ADMIN"))):
    return retire_location("room", salaId, user, bool(body.get("borrarHistorial")))


@app.get("/salas/{salaId}/estado")
def sala_state(salaId: str, incluirComplementos: bool = True, user=Depends(allow_roles("ADMIN", "ANALISTA", "VIEWER", "GUEST"))):
    ensure_room_access(user, salaId)
    row = fetch_one('SELECT * FROM vw_estado_actual_salas WHERE "salaId"=%s', (salaId,))
    if not row:
        raise HTTPException(404, "Sala no encontrada")
    if incluirComplementos and user["rol"] in ("ADMIN", "ANALISTA"):
        row["particulas24hOMS"] = fetch_one('SELECT * FROM vw_particulas_24h_oms WHERE "salaId"=%s', (salaId,))
    if incluirComplementos and user["rol"] in ("ADMIN", "ANALISTA"):
        row["alertasActivas"] = fetch_all('SELECT id,variable,"valorMedido",nivel,"ventanaConfirmacion" FROM alertas WHERE "salaId"=%s AND estado=\'activa\' ORDER BY "ventanaConfirmacion" DESC', (salaId,))
    return row


@app.get("/salas/{salaId}/estado/complementos")
def sala_state_complements(salaId: str, user=Depends(allow_roles("ADMIN", "ANALISTA", "VIEWER", "GUEST"))):
    """
    Nombre   : sala_state_complements
    Razón    : Obtiene los datos secundarios de sala después del estado actual.
    Entradas : salaId de la ruta y usuario autenticado con acceso a la sala.
    Salida   : Complementos permitidos para el rol del usuario.
    Efectos  : Ninguno; consulta vistas y alertas de PostgreSQL.
    """
    ensure_room_access(user, salaId)
    result = {}
    if user["rol"] in ("ADMIN", "ANALISTA"):
        result["particulas24hOMS"] = fetch_one('SELECT * FROM vw_particulas_24h_oms WHERE "salaId"=%s', (salaId,))
    if user["rol"] in ("ADMIN", "ANALISTA"):
        result["alertasActivas"] = fetch_all('SELECT id,variable,"valorMedido",nivel,"ventanaConfirmacion" FROM alertas WHERE "salaId"=%s AND estado=\'activa\' ORDER BY "ventanaConfirmacion" DESC', (salaId,))
    return result


@app.get("/salas/{salaId}/telemetria")
def room_telemetry(salaId: str, desde: datetime | None = None, hasta: datetime | None = None, limite: int = Query(1000, ge=1, le=10000), user=Depends(allow_roles("ADMIN", "ANALISTA"))):
    ensure_room_access(user, salaId)
    return fetch_all('''SELECT * FROM telemetria WHERE "salaId"=%s AND (%s::timestamptz IS NULL OR "timestamp">=%s::timestamptz)
        AND (%s::timestamptz IS NULL OR "timestamp"<=%s::timestamptz) ORDER BY "timestamp" DESC LIMIT %s''', (salaId,desde,desde,hasta,hasta,limite))


def csv_safe_text(value: str) -> str:
    """
    Nombre   : csv_safe_text
    Razón    : Evita que texto de telemetría se interprete como fórmula al abrir CSV.
    Entradas : value - celda textual proveniente de datos almacenados.
    Salida   : texto original o prefijado para que una hoja de cálculo lo trate como texto.
    Efectos  : Ninguno; no modifica la telemetría almacenada.
    """
    formula = value.lstrip(" \t\r\n\v\f")
    if value.startswith(("\t", "\r", "\n")) or formula.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def stream_room_export(sala_id: str, formato: str, desde: datetime | None, hasta: datetime | None):
    """
    Nombre   : stream_room_export
    Razón    : Transmite las filas de una exportación sin mantener todo el historial en memoria.
    Entradas : sala_id, formato y filtros de fecha validados por export_room.
    Salida   : bloques CSV protegidos o un arreglo JSON válido.
    Efectos  : Mantiene una consulta de solo lectura abierta durante la transmisión.
    """
    sql = '''SELECT * FROM telemetria WHERE "salaId"=%s AND (%s::timestamptz IS NULL OR "timestamp">=%s::timestamptz)
        AND (%s::timestamptz IS NULL OR "timestamp"<=%s::timestamptz) ORDER BY "timestamp"'''
    params = (sala_id, desde, desde, hasta, hasta)
    with db() as conn, conn.cursor(name="exportacion_sala") as cur:
        cur.itersize = 100
        cur.execute(sql, params)
        if formato == "json":
            yield b"["
            first = True
            for row in cur:
                if not first:
                    yield ",".encode("utf-8")
                yield json.dumps(jsonable_encoder(row), ensure_ascii=False).encode("utf-8")
                first = False
            yield b"]"
            return
        output = io.StringIO(newline="")
        writer = None
        for row in cur:
            if writer is None:
                writer = csv.DictWriter(output, fieldnames=list(row.keys()))
                writer.writeheader()
                yield output.getvalue().encode("utf-8")
                output.seek(0)
                output.truncate(0)
            values = {}
            for key, value in row.items():
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, default=str, ensure_ascii=False)
                if isinstance(value, str):
                    value = csv_safe_text(value)
                values[key] = value
            writer.writerow(values)
            yield output.getvalue().encode("utf-8")
            output.seek(0)
            output.truncate(0)


@app.get("/salas/{salaId}/exportacion")
def export_room(salaId: str, formato: Literal["csv", "json"] = "csv", desde: datetime | None = None, hasta: datetime | None = None, user=Depends(allow_roles("ADMIN", "ANALISTA"))):
    ensure_room_access(user, salaId)
    if formato == "json":
        return StreamingResponse(stream_room_export(salaId, formato, desde, hasta), media_type="application/json")
    return StreamingResponse(stream_room_export(salaId, formato, desde, hasta), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="telemetria-{salaId}.csv"'})


@app.get("/alertas")
def alerts(salaId: str | None = None, estado: Literal["activa", "resuelta"] | None = None,
           variable: Literal["CO2", "PM2.5", "PM10", "Temperatura", "Humedad"] | None = None,
           desde: datetime | None = None, hasta: datetime | None = None,
           limite: int = Query(500, ge=1, le=5000), user=Depends(allow_roles("ADMIN", "ANALISTA"))):
    if desde and hasta and desde > hasta:
        raise HTTPException(422, "La fecha inicial debe ser anterior a la fecha final")
    allowed = allowed_buildings(user)
    return fetch_all('''SELECT a.* FROM alertas a JOIN salas s ON s.id=a."salaId" JOIN pisos p ON p.id=s."pisoId"
        WHERE (%s::text IS NULL OR a."salaId"=%s::text) AND (%s::text IS NULL OR a.estado=%s::text)
        AND (%s::text IS NULL OR a.variable=%s::text)
        AND (%s::timestamptz IS NULL OR a."ventanaConfirmacion">=%s::timestamptz)
        AND (%s::timestamptz IS NULL OR a."ventanaConfirmacion"<=%s::timestamptz)
        AND (%s::text[] IS NULL OR p."edificioId"=ANY(%s::text[])) ORDER BY a."ventanaConfirmacion" DESC LIMIT %s''',
        (salaId,salaId,estado,estado,variable,variable,desde,desde,hasta,hasta,allowed,allowed,limite))


@app.get("/nodos")
def nodes(incluirConteosHistorial: bool = True, user=Depends(allow_roles("ADMIN"))):
    return fetch_all('''SELECT n.id,n.nombre,n."salaId",n."macAddress",n.estado,n.firmware,n."firmwareId",n."wifiSsid",
        n."ultimaTelemetria",n."ultimoFlasheoEn",n."createdAt",n."updatedAt",
        r.nombre AS "salaNombre",ed.nombre AS "edificioNombre",sec.nombre AS "sectorNombre",
        (n."salaId" IS NULL AND ultima."salaId" IS NOT NULL) AS "salaContextoHistorico",
        CASE WHEN %s THEN COALESCE(t.total,0) ELSE NULL::bigint END AS "telemetriaTotal",
        CASE WHEN %s THEN COALESCE(ti.total,0) ELSE NULL::bigint END AS "telemetriaInciertaTotal",
        CASE WHEN %s THEN COALESCE(a.total,0) ELSE NULL::bigint END AS "alertasTotal"
        FROM nodos n LEFT JOIN LATERAL (
            SELECT contexto."salaId" FROM (
                SELECT "salaId","timestamp" AS fecha FROM telemetria WHERE "nodoId"=n.id
                UNION ALL SELECT "salaId","recibidoEn" FROM telemetria_tiempo_incierto WHERE "nodoId"=n.id
                UNION ALL SELECT "salaId","timestamp" FROM alertas WHERE "nodoId"=n.id
            ) contexto ORDER BY contexto.fecha DESC LIMIT 1
        ) ultima ON TRUE
        LEFT JOIN salas r ON r.id=COALESCE(n."salaId",ultima."salaId") LEFT JOIN pisos p ON p.id=r."pisoId"
        LEFT JOIN edificios ed ON ed.id=p."edificioId" LEFT JOIN sectores sec ON sec.id=ed."sectorId"
        LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM telemetria WHERE %s AND "nodoId"=n.id) t ON TRUE
        LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM telemetria_tiempo_incierto WHERE %s AND "nodoId"=n.id) ti ON TRUE
        LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM alertas WHERE %s AND "nodoId"=n.id) a ON TRUE
        WHERE n."retiradoEn" IS NULL ORDER BY n.id''',
        (incluirConteosHistorial, incluirConteosHistorial, incluirConteosHistorial,
         incluirConteosHistorial, incluirConteosHistorial, incluirConteosHistorial))


@app.get("/nodos/{nodoId}/resumen-retiro")
def node_retirement_summary(nodoId: str, user=Depends(allow_roles("ADMIN"))):
    """
    Nombre   : node_retirement_summary
    Razón    : Consulta conteos históricos sólo al abrir la confirmación de retiro.
    Entradas : nodoId - identificador técnico recibido desde la ruta.
    Salida   : conteos de telemetría, telemetría incierta y alertas.
    Efectos  : Ninguno. La operación solamente consulta información.
    """
    row = fetch_one('''SELECT
        (SELECT COUNT(*) FROM telemetria WHERE "nodoId"=%s) AS telemetria,
        (SELECT COUNT(*) FROM telemetria_tiempo_incierto WHERE "nodoId"=%s) AS "telemetriaIncierta",
        (SELECT COUNT(*) FROM alertas WHERE "nodoId"=%s) AS alertas
        FROM nodos WHERE id=%s AND "retiradoEn" IS NULL''', (nodoId, nodoId, nodoId, nodoId))
    if not row:
        raise HTTPException(404, "Nodo no encontrado o retirado")
    return row


@app.get("/nodos/{nodoId}")
def node_detail(nodoId: str, user=Depends(allow_roles("ADMIN"))):
    row = fetch_one('''SELECT id,nombre,"salaId","macAddress",estado,firmware,"firmwareId","wifiSsid","ultimaTelemetria","ultimoFlasheoEn","createdAt","updatedAt"
        FROM nodos WHERE id=%s''', (nodoId,))
    if not row:
        raise HTTPException(404,"Nodo no encontrado")
    return row


@app.post("/nodos/{nodoId}/aprovisionamiento")
def node_provisioning(nodoId: str, response: Response, user=Depends(allow_roles("ADMIN"))):
    credential_generated = False
    with db() as conn, conn.cursor() as cur:
        cur.execute('''SELECT id,"salaId","wifiSsid","macAddress","jwtToken"
            FROM nodos WHERE id=%s AND "retiradoEn" IS NULL FOR UPDATE''', (nodoId,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Nodo no encontrado o retirado")
        if not row["jwtToken"]:
            row["jwtToken"] = secrets.token_urlsafe(32)
            credential_generated = True
            cur.execute('UPDATE nodos SET "jwtToken"=%s,"updatedAt"=NOW() WHERE id=%s',
                        (row["jwtToken"], nodoId))
    try:
        provision_mqtt_client(str(row["id"]), row["jwtToken"], force_update=credential_generated)
    except RuntimeError as exc:
        log.error("No se pudo aprovisionar la credencial MQTT para nodo %s: %s", nodoId, exc)
        raise HTTPException(503, "No se pudo registrar la credencial del nodo en el broker MQTT. Reintenta el aprovisionamiento.") from exc
    response.headers["Cache-Control"] = "no-store"
    return {"nodoId": row["id"], "salaId": row["salaId"], "wifiSsid": row["wifiSsid"],
            "macAddress": row["macAddress"], "jwtToken": row["jwtToken"]}


@app.post("/nodos", status_code=201)
def create_node(body: NodeIn, user=Depends(allow_roles("ADMIN"))):
    try:
        if body.salaId and not fetch_one('SELECT id FROM salas WHERE id=%s AND "retiradoEn" IS NULL', (body.salaId,)):
            raise HTTPException(404, "Sala no encontrada o retirada")
        device_token = secrets.token_urlsafe(32)
        if body.id is None:
            row = fetch_one('''INSERT INTO nodos (nombre,"salaId","macAddress",firmware,"wifiSsid","jwtToken")
                VALUES (%s,%s,%s,%s,%s,%s) RETURNING id,nombre,"salaId","macAddress",estado,firmware,"wifiSsid"''',
                (body.nombre,body.salaId,None,body.firmware,None,device_token))
            return {"nodo": row, "reutilizado": False}
        node_id = body.id
        existing = fetch_one('''SELECT n.id,n."salaIdReserva",n."retiradoEn",
            EXISTS(SELECT 1 FROM salas s WHERE s.id=n."salaIdReserva") AS "salaReservaExiste",
            (SELECT COUNT(*) FROM telemetria t WHERE t."nodoId"=n.id) +
            (SELECT COUNT(*) FROM telemetria_tiempo_incierto ti WHERE ti."nodoId"=n.id) +
            (SELECT COUNT(*) FROM alertas a WHERE a."nodoId"=n.id) AS "referenciasHistoricas"
            FROM nodos n WHERE n.id=%s''', (node_id,))
        if existing:
            if not existing["retiradoEn"]:
                raise HTTPException(409, "Ya existe un nodo activo con ese ID")
            same_room = body.salaId and body.salaId == existing["salaIdReserva"]
            references_remain = existing["salaReservaExiste"] and existing["referenciasHistoricas"] > 0
            if not same_room and references_remain:
                raise HTTPException(409, "Ese ID aún tiene sala e historial asociados; mientras ambos existan, sólo puede reutilizarse en su sala original")
            row = fetch_one('''UPDATE nodos SET nombre=%s,"salaId"=%s,"macAddress"=%s,firmware=%s,"wifiSsid"=%s,"jwtToken"=NULL,
                estado='desconectado',"firmwareId"=NULL,"retiradoEn"=NULL,"salaIdReserva"=NULL,"retiroUbicacion"=NULL,
                "ultimaTelemetria"=NULL,"ultimoFlasheoEn"=NULL,"flasheadoPor"=NULL,"updatedAt"=NOW()
                WHERE id=%s AND "retiradoEn" IS NOT NULL RETURNING id,nombre,"salaId","macAddress",estado,firmware,"wifiSsid"''',
                (body.nombre,body.salaId,None,body.firmware,None,node_id))
            if not row:
                raise HTTPException(409, "El nodo cambió mientras se intentaba reutilizar; actualiza la lista y vuelve a intentarlo")
            return {"nodo": row, "reutilizado": True}
        row = fetch_one('''INSERT INTO nodos (id,nombre,"salaId","macAddress",firmware,"wifiSsid","jwtToken")
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id,nombre,"salaId","macAddress",estado,firmware,"wifiSsid"''',
            (node_id,body.nombre,body.salaId,None,body.firmware,None,device_token))
        return {"nodo": row, "reutilizado": False}
    except HTTPException:
        raise
    except psycopg.errors.UniqueViolation as exc:
        if getattr(exc.diag, "constraint_name", None) == "uq_nodo_sala_nombre_activo":
            raise HTTPException(409, "Ya existe un nodo con ese nombre en esa sala")
        raise HTTPException(409,"La sala ya tiene un nodo o la MAC ya está asignada")
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(404,"Sala no encontrada")


@app.patch("/nodos/{nodoId}")
def update_node(nodoId: str, body: NodePatch, user=Depends(allow_roles("ADMIN"))):
    fields = body.model_dump(exclude_unset=True)
    if not fields: raise HTTPException(400, "No hay cambios para guardar")
    if fields.get("salaId") and not fetch_one('SELECT id FROM salas WHERE id=%s AND "retiradoEn" IS NULL', (fields["salaId"],)):
        raise HTTPException(404, "Sala no encontrada o retirada")
    assignments = ",".join(f'"{key}"=%s' for key in fields)
    try:
        row = fetch_one(f'UPDATE nodos SET {assignments},"updatedAt"=NOW() WHERE id=%s AND "retiradoEn" IS NULL RETURNING id,nombre,"salaId","macAddress",estado,firmware,"firmwareId","wifiSsid"', (*fields.values(), nodoId))
    except psycopg.errors.UniqueViolation as exc:
        if getattr(exc.diag, "constraint_name", None) == "uq_nodo_sala_nombre_activo": raise HTTPException(409, "Ya existe un nodo con ese nombre en esa sala")
        raise HTTPException(409, "La sala ya tiene un nodo o la dirección MAC está asignada")
    except psycopg.errors.ForeignKeyViolation: raise HTTPException(404, "Sala no encontrada")
    if not row: raise HTTPException(404, "Nodo no encontrado")
    return row


@app.delete("/nodos/{nodoId}")
def delete_node(nodoId: str, body: dict[str, bool] = Body(default={}), user=Depends(allow_roles("ADMIN"))):
    borrar_historial = bool(body.get("borrarHistorial"))
    with db() as conn, conn.cursor() as cur:
        cur.execute('''SELECT n.id,n.nombre,n."salaId",n."retiradoEn",r.nombre AS "salaNombre",
            COALESCE(n."salaId",ultima."salaId") AS "salaOriginalId",
            (n."salaId" IS NULL AND ultima."salaId" IS NOT NULL) AS "salaContextoHistorico",
            ed.id AS "edificioId",ed.nombre AS "edificioNombre",sec.id AS "sectorId",sec.nombre AS "sectorNombre"
            FROM nodos n LEFT JOIN LATERAL (
                SELECT contexto."salaId" FROM (
                    SELECT "salaId","timestamp" AS fecha FROM telemetria WHERE "nodoId"=n.id
                    UNION ALL SELECT "salaId","recibidoEn" FROM telemetria_tiempo_incierto WHERE "nodoId"=n.id
                    UNION ALL SELECT "salaId","timestamp" FROM alertas WHERE "nodoId"=n.id
                ) contexto ORDER BY contexto.fecha DESC LIMIT 1
            ) ultima ON TRUE
            LEFT JOIN salas r ON r.id=COALESCE(n."salaId",ultima."salaId") LEFT JOIN pisos p ON p.id=r."pisoId"
            LEFT JOIN edificios ed ON ed.id=p."edificioId" LEFT JOIN sectores sec ON sec.id=ed."sectorId"
            WHERE n.id=%s FOR UPDATE OF n''', (nodoId,))
        node = cur.fetchone()
        if not node:
            raise HTTPException(404, "Nodo no encontrado")
        if node["retiradoEn"]:
            return {"nodoId": nodoId, "yaRetirado": True}
        cur.execute('SELECT COUNT(*) AS total FROM telemetria WHERE "nodoId"=%s', (nodoId,))
        telemetry_count = cur.fetchone()["total"]
        cur.execute('SELECT COUNT(*) AS total FROM telemetria_tiempo_incierto WHERE "nodoId"=%s', (nodoId,))
        uncertain_count = cur.fetchone()["total"]
        cur.execute('SELECT COUNT(*) AS total FROM alertas WHERE "nodoId"=%s', (nodoId,))
        alert_count = cur.fetchone()["total"]
        location = {"sectorId": node["sectorId"], "sector": node["sectorNombre"],
                    "edificioId": node["edificioId"], "edificio": node["edificioNombre"],
                    "salaId": node["salaOriginalId"], "sala": node["salaNombre"],
                    "desdeHistorial": node["salaContextoHistorico"]}
        history = {"telemetria": telemetry_count, "telemetriaIncierta": uncertain_count, "alertas": alert_count}
        if borrar_historial:
            cur.execute('DELETE FROM alertas WHERE "nodoId"=%s', (nodoId,))
            cur.execute('DELETE FROM telemetria_tiempo_incierto WHERE "nodoId"=%s', (nodoId,))
            cur.execute('DELETE FROM telemetria WHERE "nodoId"=%s', (nodoId,))
        cur.execute('''UPDATE nodos SET "salaId"=NULL,"salaIdReserva"=%s,"retiradoEn"=NOW(),
            "retiroUbicacion"=%s,"jwtToken"=NULL,estado='desconectado',"updatedAt"=NOW(),
            "historialRetiros"=COALESCE("historialRetiros",'[]'::jsonb) ||
                jsonb_build_array(jsonb_build_object('retiradoEn',NOW(),'ubicacion',%s::jsonb,'historial',%s::jsonb))
            WHERE id=%s RETURNING "retiradoEn"''', (node["salaOriginalId"], Jsonb(location), Jsonb(location), Jsonb(history), nodoId))
        retired_at = cur.fetchone()["retiradoEn"]
    return {"nodoId": nodoId, "nombre": node["nombre"], "retiradoEn": retired_at, "ubicacion": location,
            "historial": history,
            "historialEliminado": borrar_historial,
            "nombreReservadoParaSala": node["salaOriginalId"]}


@app.patch("/nodos/{nodoId}/asignacion")
def assign_node(nodoId: str, body: dict[str,str|None], user=Depends(allow_roles("ADMIN"))):
    sala_id = body.get("salaId")
    if sala_id and not fetch_one('SELECT id FROM salas WHERE id=%s AND "retiradoEn" IS NULL', (sala_id,)):
        raise HTTPException(404,"Sala no encontrada o retirada")
    row = fetch_one('UPDATE nodos SET "salaId"=%s,"updatedAt"=NOW() WHERE id=%s AND "retiradoEn" IS NULL RETURNING id,"salaId"', (sala_id,nodoId))
    if not row: raise HTTPException(404,"Nodo no encontrado")
    return row


@app.patch("/nodos/{nodoId}/firmware")
def assign_firmware(nodoId: str, body: FirmwareAssignIn, user=Depends(allow_roles("ADMIN"))):
    with db() as conn, conn.cursor() as cur:
        cur.execute('SELECT id,version FROM firmwares WHERE id=%s', (body.firmwareId,))
        fw = cur.fetchone()
        if not fw:
            raise HTTPException(404, "Firmware no encontrado")

        cur.execute('SELECT id FROM nodos WHERE id=%s AND "retiradoEn" IS NULL FOR UPDATE', (nodoId,))
        if not cur.fetchone():
            raise HTTPException(404, "Nodo no encontrado")

        # Una MAC guardada en un nodo retirado sin historial ya no representa
        # un origen de telemetría. Permite volver a registrar la placa en un
        # nodo nuevo sin borrar el registro de retiro ni sus datos asociados.
        if body.macAddress:
            cur.execute('''SELECT id,"retiradoEn" FROM nodos
                WHERE "macAddress"=%s AND id<>%s FOR UPDATE''', (body.macAddress, nodoId))
            owner = cur.fetchone()
            if owner and owner["retiradoEn"] is None:
                raise HTTPException(409, "Esta MAC ya está asignada a otro nodo activo")
            if owner:
                cur.execute('''SELECT
                    (SELECT COUNT(*) FROM telemetria WHERE "nodoId"=%s) +
                    (SELECT COUNT(*) FROM telemetria_tiempo_incierto WHERE "nodoId"=%s) +
                    (SELECT COUNT(*) FROM alertas WHERE "nodoId"=%s) AS total''',
                    (owner["id"], owner["id"], owner["id"]))
                if cur.fetchone()["total"]:
                    raise HTTPException(409, "Esta MAC está vinculada a un nodo retirado con historial. Reactiva ese nodo en su sala original para conservar la continuidad de sus datos")
                cur.execute('UPDATE nodos SET "macAddress"=NULL,"updatedAt"=NOW() WHERE id=%s', (owner["id"],))

        cur.execute('''UPDATE nodos SET "firmwareId"=%s,firmware=%s,
            "wifiSsid"=COALESCE(%s::text,"wifiSsid"),
            "macAddress"=COALESCE(%s::text,"macAddress"),
            "ultimoFlasheoEn"=NOW(),"flasheadoPor"=%s,"updatedAt"=NOW()
            WHERE id=%s AND "retiradoEn" IS NULL
            RETURNING id,firmware,"firmwareId","wifiSsid","macAddress"''',
            (fw["id"], fw["version"], body.wifiSsid, body.macAddress, user["id"], nodoId))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Nodo no encontrado")
    return row


@app.post("/firmwares", status_code=201)
async def upload_firmware(version: str = Form(...), versionReglas: str = Form(...), estado: Literal["oficial", "prueba", "obsoleta"] = Form("oficial"), changelog: str | None = Form(None), archivo: UploadFile = File(...), user=Depends(allow_roles("ADMIN"))):
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,20}", version) or not re.fullmatch(r"[A-Za-z0-9._-]{1,20}", versionReglas):
        raise HTTPException(422,"Versión inválida")
    name = Path(archivo.filename or "firmware.bin").name
    if not name.lower().endswith(".bin"):
        raise HTTPException(422,"Sólo se admiten archivos .bin")
    content=await archivo.read(1572865)
    if not content or len(content)>1572864:
        raise HTTPException(413,"El firmware debe pesar entre 1 byte y 1.5 MiB")
    if content[0] != 0xE9:
        raise HTTPException(422,"Cabecera ESP32 inválida (se esperaba 0xE9)")
    digest=hashlib.sha256(content).hexdigest()
    safe_name=f"{version}-{digest[:12]}.bin"
    target=FIRMWARE_DIR/safe_name
    try:
        row=fetch_one('''INSERT INTO firmwares (version,"versionReglas","nombreArchivo","rutaArchivo","tamanoBytes",sha256,"contenido",estado,changelog,"subidoPor")
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,version,"versionReglas","nombreArchivo","tamanoBytes",sha256,estado,changelog,"createdAt"''',
            (version,versionReglas,name,str(target),len(content),digest,content,estado,changelog,user["id"]))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409,"La versión o el hash ya existe")
    return row


@app.get("/firmwares")
def list_firmwares(orden: Literal["asc","desc"]="desc", user=Depends(allow_roles("ADMIN"))):
    direction="ASC" if orden=="asc" else "DESC"
    return fetch_all(f'''SELECT id,version,"versionReglas","nombreArchivo","tamanoBytes",sha256,estado,changelog,"subidoPorNombre","createdAt","nodosInstalados"
        FROM vw_catalogo_firmwares ORDER BY "createdAt" {direction},version {direction}''')


@app.get("/firmwares/{firmwareId}/descarga")
def download_firmware(firmwareId: str, user=Depends(allow_roles("ADMIN"))):
    row=fetch_one('SELECT "nombreArchivo","rutaArchivo",sha256,"contenido" FROM firmwares WHERE id=%s',(firmwareId,))
    if not row: raise HTTPException(404,"Firmware no encontrado")
    content=row["contenido"]
    if content is None:
        path=Path(row["rutaArchivo"])
        content=path.read_bytes() if path.is_file() else None
    if content is None or hashlib.sha256(content).hexdigest()!=row["sha256"].strip():
        raise HTTPException(410,"Archivo ausente o su integridad no coincide",headers={"Cache-Control":"no-store"})
    return Response(content=content,media_type="application/octet-stream",headers={"Content-Disposition":f'attachment; filename="{row["nombreArchivo"]}"',"Cache-Control":"no-store"})


@app.patch("/firmwares/{firmwareId}")
def patch_firmware(firmwareId: str, body: FirmwarePatch, user=Depends(allow_roles("ADMIN"))):
    fields=body.model_dump(exclude_unset=True)
    if not fields: raise HTTPException(400,"No hay cambios")
    assignments=",".join(f'"{k}"=%s' for k in fields)
    row=fetch_one(f'UPDATE firmwares SET {assignments} WHERE id=%s RETURNING id,version,estado,changelog',(*fields.values(),firmwareId))
    if not row: raise HTTPException(404,"Firmware no encontrado")
    return row


@app.delete("/firmwares/{firmwareId}")
def delete_firmware(firmwareId: str, user=Depends(allow_roles("ADMIN"))):
    """Retira una versión del catálogo sin borrar telemetría ni el firmware instalado en nodos."""
    try:
        with db() as conn, conn.cursor() as cur:
            cur.execute('SELECT id,version,"rutaArchivo" FROM firmwares WHERE id=%s FOR UPDATE', (firmwareId,))
            firmware = cur.fetchone()
            if not firmware:
                raise HTTPException(404, "Firmware no encontrado")
            cur.execute('DELETE FROM firmwares WHERE id=%s', (firmwareId,))
    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(409, "No se pudo retirar la versión porque aún tiene referencias asociadas")

    # The binary is also stored in PostgreSQL; remove a legacy file only if it is
    # inside the managed firmware directory. Failure here must not undo the deletion.
    try:
        path = Path(firmware["rutaArchivo"]).resolve()
        root = FIRMWARE_DIR.resolve()
        if path.is_relative_to(root) and path != root:
            path.unlink(missing_ok=True)
    except (OSError, ValueError, TypeError):
        pass
    return {"deleted": True, "id": firmware["id"], "version": firmware["version"]}


@app.get("/usuarios")
def list_users(user=Depends(allow_roles("ADMIN"))):
    return fetch_all('SELECT id,nombre,email,telefono,rol,estado,"assignedEdificios","createdAt","updatedAt" FROM usuarios ORDER BY nombre')


@app.post("/usuarios", status_code=201)
def create_user(body: UserIn, user=Depends(allow_roles("ADMIN"))):
    if body.rol == "GUEST":
        raise HTTPException(422, "El rol Invitado ingresa sin cuenta desde «Ingresar como invitado»")
    try:
        with db() as conn, conn.cursor() as cur:
            cur.execute('''INSERT INTO usuarios (nombre,email,telefono,rol,password) VALUES (%s,lower(%s),%s,%s,%s) RETURNING id,nombre,email,rol,estado''',
                        (body.nombre,body.email,body.telefono,body.rol,bcrypt.hashpw(body.password.encode(),bcrypt.gensalt()).decode()))
            new=cur.fetchone()
            for building in body.edificios:
                cur.execute('INSERT INTO usuario_edificios ("usuarioId","edificioId") VALUES (%s,%s)',(new["id"],building))
        return new
    except psycopg.errors.UniqueViolation: raise HTTPException(409,"Correo duplicado o edificio inválido")
    except psycopg.errors.ForeignKeyViolation: raise HTTPException(422,"Uno de los edificios no existe")


@app.patch("/usuarios/{usuarioId}")
def patch_user(usuarioId: str, body: UserPatch, user=Depends(allow_roles("ADMIN"))):
    if usuarioId == user["id"]:
        raise HTTPException(403, "No puedes editar la cuenta de administrador que estás usando")
    target=fetch_one('SELECT id,rol,estado FROM usuarios WHERE id=%s',(usuarioId,))
    if not target:
        raise HTTPException(404,"Usuario no encontrado")
    fields=body.model_dump(exclude_unset=True)
    if fields.get("rol") == "GUEST":
        raise HTTPException(422, "El rol Invitado no requiere una cuenta; usa «Ingresar como invitado»")
    demoting_last_admin=(target["rol"]=="ADMIN" and target["estado"]=="activo" and
        (fields.get("rol", "ADMIN")!="ADMIN" or fields.get("estado", "activo")!="activo"))
    if demoting_last_admin and fetch_one("SELECT COUNT(*) AS total FROM usuarios WHERE rol='ADMIN' AND estado='activo'")["total"]<=1:
        raise HTTPException(409,"No se puede desactivar o cambiar el rol del último administrador activo")
    buildings=fields.pop("edificios",None)
    if "password" in fields: fields["password"]=bcrypt.hashpw(fields["password"].encode(),bcrypt.gensalt()).decode()
    if fields:
        assignments=",".join(f'"{k}"=%s' for k in fields)
        if "estado" in fields or "password" in fields:
            execute(f'UPDATE sesiones_usuario SET revocada=TRUE WHERE "usuarioId"=%s', (usuarioId,))
        execute(f'UPDATE usuarios SET {assignments},"updatedAt"=NOW() WHERE id=%s',(*fields.values(),usuarioId))
    if buildings is not None:
        with db() as conn, conn.cursor() as cur:
            cur.execute('DELETE FROM usuario_edificios WHERE "usuarioId"=%s',(usuarioId,))
            for building in buildings: cur.execute('INSERT INTO usuario_edificios ("usuarioId","edificioId") VALUES (%s,%s)',(usuarioId,building))
    row=fetch_one('SELECT id,nombre,email,telefono,rol,estado,"assignedEdificios" FROM usuarios WHERE id=%s',(usuarioId,))
    if not row: raise HTTPException(404,"Usuario no encontrado")
    return row


@app.delete("/usuarios/{usuarioId}", status_code=204)
def delete_user(usuarioId: str, user=Depends(allow_roles("ADMIN"))):
    if usuarioId == user["id"]:
        raise HTTPException(403, "No puedes eliminar la cuenta de administrador que estás usando")
    target=fetch_one('SELECT id,rol,estado FROM usuarios WHERE id=%s',(usuarioId,))
    if not target:
        raise HTTPException(404,"Usuario no encontrado")
    if target["rol"]=="ADMIN" and target["estado"]=="activo" and fetch_one("SELECT COUNT(*) AS total FROM usuarios WHERE rol='ADMIN' AND estado='activo'")["total"]<=1:
        raise HTTPException(409,"No se puede eliminar el último administrador activo")
    execute("DELETE FROM usuarios WHERE id=%s",(usuarioId,))
    return Response(status_code=204)


@app.post("/telegram/vinculo")
def telegram_link(user=Depends(current_user)):
    if user["rol"] == "GUEST": raise HTTPException(403, "El acceso de invitado es de solo lectura")
    code=secrets.token_urlsafe(9)[:12]
    execute('''INSERT INTO telegram_vinculos ("usuarioId","codigoTemporal","codigoExpiraEn","chatVinculado","avisosActivos","updatedAt")
        VALUES (%s,%s,NOW()+INTERVAL '10 minutes',FALSE,FALSE,NOW()) ON CONFLICT ("usuarioId") DO UPDATE SET
        "codigoTemporal"=EXCLUDED."codigoTemporal","codigoExpiraEn"=EXCLUDED."codigoExpiraEn","chatVinculado"=FALSE,"updatedAt"=NOW()''',(user["id"],code))
    return {"codigo":code,"expiraEn":(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat(),"botActivo":bool(os.getenv("TELEGRAM_BOT_TOKEN"))}


@app.get("/telegram/preferencias")
def get_telegram_preferences(user=Depends(current_user)):
    if user["rol"] == "GUEST": raise HTTPException(403, "El acceso de invitado no tiene preferencias personales")
    link=fetch_one('SELECT "chatVinculado","avisosActivos","telegramUsername" FROM telegram_vinculos WHERE "usuarioId"=%s',(user["id"],))
    rooms=fetch_all('SELECT "salaId","pausadoHasta" FROM telegram_preferencias_salas WHERE "usuarioId"=%s ORDER BY "salaId"',(user["id"],))
    return {"vinculo":link,"salas":[r["salaId"] for r in rooms],
            "pausas":{r["salaId"]:r["pausadoHasta"].isoformat() for r in rooms if r["pausadoHasta"] and r["pausadoHasta"] > datetime.now(timezone.utc)}}


@app.put("/telegram/preferencias")
def put_telegram_preferences(body: dict[str,Any], user=Depends(current_user)):
    if user["rol"] == "GUEST": raise HTTPException(403, "El acceso de invitado es de solo lectura")
    rooms=body.get("salas",[])
    if not isinstance(rooms,list) or not all(isinstance(room,str) for room in rooms): raise HTTPException(422,"salas debe ser una lista de IDs")
    for room in rooms: ensure_room_access(user,room)
    if user["rol"] not in ("ADMIN","ANALISTA") and body.get("exportacion"): raise HTTPException(403,"Exportación requiere rol ADMIN o ANALISTA")
    with db() as conn, conn.cursor() as cur:
        cur.execute('''INSERT INTO telegram_vinculos ("usuarioId","avisosActivos","updatedAt") VALUES (%s,%s,NOW())
            ON CONFLICT ("usuarioId") DO UPDATE SET "avisosActivos"=EXCLUDED."avisosActivos","updatedAt"=NOW()''',(user["id"],bool(body.get("avisosActivos",False))))
        cur.execute('DELETE FROM telegram_preferencias_salas WHERE "usuarioId"=%s AND NOT ("salaId"=ANY(%s::text[]))',(user["id"],rooms))
        for room in set(rooms):
            cur.execute('INSERT INTO telegram_preferencias_salas ("usuarioId","salaId") VALUES (%s,%s) ON CONFLICT DO NOTHING',(user["id"],room))
    return get_telegram_preferences(user)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Nombre   : websocket_endpoint
    Razón    : Mantiene eventos en vivo autenticados por cookie y origen del sitio.
    Entradas : Handshake WebSocket con cookie de acceso y cabecera Origin.
    Salida   : Flujo de eventos autorizado o cierre de conexión.
    Efectos  : Registra y elimina la conexión en el concentrador en memoria.
    """
    origin = urllib.parse.urlsplit(ws.headers.get("origin", ""))
    host = ws.headers.get("host", "").lower()
    scheme = ws.headers.get("x-forwarded-proto", "https").split(",", 1)[0].strip().lower()
    if not origin.netloc or origin.netloc.lower() != host or origin.scheme.lower() != scheme:
        await ws.close(code=4403)
        return
    token=ws.cookies.get("access_token")
    if not token:
        await ws.close(code=4401)
        return
    try:
        user = session_from_token(token)
    except HTTPException:
        await ws.close(code=4401)
        return
    await hub.connect(ws, user["sessionId"], user.get("tokenExpiresAt"))
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect(ws)

