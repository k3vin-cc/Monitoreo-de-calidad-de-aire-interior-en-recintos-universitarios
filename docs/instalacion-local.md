# Instalación local para desarrollo (PowerShell)

Esta guía inicia una base nueva, API y web. No crea usuarios ni mediciones de ejemplo. Requiere Git, Python 3.12, Node.js 20, PostgreSQL 16 con TimescaleDB y `psql`. Docker puede aportar PostgreSQL/TimescaleDB si no está instalado. La carga del firmware y la ingesta MQTT se configuran después según las guías de [ESP32](../esp32_nodo_aira/README.md) y [Mosquitto](../mosquitto/README.md).

## 1. Preparar la base de datos

Abre PowerShell en la raíz del clon. Inicia una instancia **vacía** de TimescaleDB, por ejemplo con Docker. Introduce la contraseña sin dejarla en el historial de comandos; el siguiente bloque la conserva solo en el entorno de esta terminal y genera una clave JWT aleatoria para el API:

```powershell
$dbPass = Read-Host 'Contraseña nueva para PostgreSQL' -AsSecureString
$dbPassPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPass)
try { $env:POSTGRES_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($dbPassPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($dbPassPtr) }
$env:JWT_SECRET_KEY = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

No copies esos valores a un archivo versionado. Al abrir otra consola, recupera **los mismos valores** desde tu gestor de secretos; una contraseña PostgreSQL distinta impedirá conectar y una clave JWT nueva invalidará las sesiones emitidas anteriormente. Luego ejecuta:

```powershell
docker run --name aira-db --env POSTGRES_PASSWORD -e POSTGRES_DB=postgres -p 127.0.0.1:5432:5432 -v aira-postgres:/var/lib/postgresql/data -d timescale/timescaledb:latest-pg16
docker ps --filter name=aira-db
```

En una instalación existente, usa una base separada y haz un respaldo antes de ejecutar SQL. El esquema inicial crea las extensiones `pgcrypto` y `timescaledb`; la cuenta de base necesita permisos para ello. Desde la raíz del proyecto:

```powershell
psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f 'contenido/base de datos/schema_timescaledb.sql'
psql -h localhost -U postgres -d postgres -Atc "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','timescaledb') ORDER BY extname"
```

El segundo comando debe mostrar ambas extensiones. **No ejecutes todas las migraciones sobre esta base nueva:** el esquema ya incorpora varios cambios. Las migraciones de `k8s/migrations/` sirven para actualizar una instalación anterior tras comparar su estado y hacer un respaldo.

## 2. Crear el primer administrador

Instala las dependencias del API, que utiliza también el script de arranque. `bootstrap_admin.py` solicita la contraseña de forma interactiva, valida que no exista otro ADMIN activo y guarda solo el hash bcrypt.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r api/requirements.txt
python scripts/bootstrap_admin.py --name 'Administrador inicial' --email 'admin@example.org'
```

Usa tu propio correo válido en el último comando. El script toma `DB_HOST`, `DB_NAME`, `DB_USER` y `POSTGRES_PASSWORD` del entorno; con la base del paso anterior basta con `POSTGRES_PASSWORD`. Si no se configura, el proceso intentará conectarse con contraseña vacía y fallará. Después de crear el primer administrador, gestiona los demás usuarios desde la web.

## 3. Iniciar el API

Asigna en tu entorno, fuera de Git, al menos `POSTGRES_PASSWORD` y un `JWT_SECRET_KEY` aleatorio. Copiar `api/.env.example` no carga automáticamente sus valores. Para esta base local, `DB_HOST=localhost`; deja `TELEGRAM_BOT_TOKEN` y `MQTT_PASSWORD` vacíos hasta configurar esos servicios. Configura `FIRMWARE_DIR` como directorio local escribible si probarás cargas de firmware.

```powershell
$env:DB_HOST='localhost'
$env:DB_NAME='postgres'
$env:DB_USER='postgres'
$env:FIRMWARE_DIR=(Join-Path (Get-Location) 'firmwares')
python -m uvicorn main:app --app-dir api --host 127.0.0.1 --port 8000
```

En otra consola, `Invoke-WebRequest http://127.0.0.1:8000/healthz` debe devolver HTTP 200. El contrato vigente está en `http://127.0.0.1:8000/docs`. Si el API indica que no hay `JWT_SECRET_KEY`, define esa variable antes de reiniciar: de lo contrario el acceso autenticado fallará.

## 4. Iniciar la web

Con el API en ejecución:

```powershell
Set-Location web
npm ci
npm run dev
```

Abre `http://localhost:5173`. El servidor Vite reenvía `/api` y `/ws` al API local; no necesitas cambiar el código para este caso. Inicia sesión con el administrador creado en el paso 2. El acceso de invitado muestra solo información actual; una base vacía no mostrará salas ni lecturas hasta que crees la jerarquía y aprovisiones un nodo.

## 5. Activar mediciones reales y comprobarlas

Prepara el broker conforme a [mosquitto/README.md](../mosquitto/README.md), define `MQTT_HOST`, `MQTT_USERNAME` y `MQTT_PASSWORD` para el API, y reinícialo. En la web crea sector, edificio, piso, sala y nodo. Compila o carga firmware siguiendo [esp32_nodo_aira/README.md](../esp32_nodo_aira/README.md). Comprueba en ese orden: conexión Wi‑Fi del ESP32, conexión al broker, publicación MQTT/PUBACK, ingesta del API, registro en la base y actualización de la vista sin recargar. Una ventana normal se completa en cinco minutos; PM₂.₅ y PM₁₀ pueden ser nulos si el PMS5003 no está conectado.

## 6. Validaciones y salida

`python -m compileall -q api scripts` valida sintaxis Python y `npm run build` valida la web desde `web/`. `scripts/test_telegram_bot.py` incluye consultas reales a la base, por lo que necesita esquema y acceso a BD; no es una prueba aislada. Para detener Docker usa `docker stop aira-db`. El volumen `aira-postgres` conserva datos entre arranques; antes de borrarlo o reutilizarlo, confirma si contiene información que debas conservar.
