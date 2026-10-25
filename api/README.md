# API FastAPI

`main.py` contiene autenticación, permisos por rol y edificio, jerarquía de espacios, nodos, ingesta MQTT, telemetría, alertas, catálogo de firmware, WebSocket de actualización en vivo y bot Telegram. `requirements.txt` fija las dependencias; `Dockerfile` usa Python 3.12. El esquema requerido está en [base de datos](../contenido/base%20de%20datos/README_BD.md).

## Iniciar en desarrollo

1. Prepara una base TimescaleDB nueva mediante la [instalación local](../docs/instalacion-local.md). El API no crea tablas al arrancar.
2. Desde la raíz, crea un entorno virtual e instala dependencias: `python -m venv .venv`, activa el entorno y ejecuta `python -m pip install -r api/requirements.txt`.
3. Define en el entorno `DB_HOST`, `DB_NAME`, `DB_USER`, `POSTGRES_PASSWORD` y `JWT_SECRET_KEY`. Usa `api/.env.example` solo como lista de nombres: el proceso **no carga** archivos `.env` automáticamente. Genera valores propios y guárdalos fuera de Git.
4. Ejecuta `python -m uvicorn main:app --app-dir api --host 127.0.0.1 --port 8000`.
5. Comprueba `http://127.0.0.1:8000/healthz` (HTTP 200) y el contrato OpenAPI vigente en `/docs`. Inicia la web según [web/README.md](../web/README.md).

`MQTT_PASSWORD` vacío desactiva la ingesta MQTT y `TELEGRAM_BOT_TOKEN` vacío desactiva el bot; son útiles para levantar primero la interfaz. Al configurar el broker, usa `MQTT_HOST`, `MQTT_USERNAME` y `MQTT_PASSWORD` de la cuenta interna, reinicia el API y verifica su conexión en los logs. `FIRMWARE_DIR` debe apuntar a un directorio escribible y persistente si almacenas binarios.

## Primer usuario, permisos y flujos

En una base nueva, ejecuta `python scripts/bootstrap_admin.py --name 'Administrador inicial' --email 'tu-correo@example.org'`. El script pide la contraseña por consola y solo crea el primer ADMIN activo. Después crea usuarios y asigna edificios desde la web. El invitado entra mediante `POST /auth/invitado` y no accede al historial; los usuarios autenticados entran por `POST /auth/login`. Los permisos se validan en el servidor. `/ws` envía actualizaciones a la interfaz; las rutas REST vigentes se consultan en `/docs`, no en la especificación histórica de etapa 2.

El ESP32 publica en `telemetria/<nodoId>/datos`. El API consume, comprueba la credencial y el vínculo del nodo, persiste ventanas e informa el estado a la web. Los avisos de Telegram requieren además un token de bot vigente, vinculación privada y preferencias de salas; no uses el token en URL, logs o documentación compartida.

![Secuencia del nodo al broker, API, base de datos y dashboard](../docs/arquitectura/diagrama_secuencia_telemetria_indices.png)

## Verificación y diagnóstico

- `python -m compileall -q api scripts` valida sintaxis.
- `python scripts/test_telegram_bot.py` comprueba flujos del bot, pero su parte final **consulta una base real** con el esquema y las migraciones requeridos. Úsalo solo en un entorno de pruebas.
- Si `/healthz` responde y el login falla, revisa `JWT_SECRET_KEY`, la tabla `usuarios` y la conexión a PostgreSQL.
- Si la web no recibe datos, comprueba broker y suscripción del API, ventana publicada por el nodo, base y WebSocket, en ese orden. La conexión Wi‑Fi por sí sola no confirma ingesta.

El despliegue del clúster monta `main.py` desde un ConfigMap generado con `scripts/generate_api_configmap.py`; el [despliegue Kubernetes](../k8s/README.md) describe la secuencia y sus límites de persistencia.
