# Scripts de preparación y operación

Ejecuta los comandos desde la raíz del proyecto. Para generadores YAML instala `python -m pip install -r scripts/requirements.txt`. Los scripts que acceden a PostgreSQL usan `api/requirements.txt` o al menos `psycopg`; leen credenciales desde variables de entorno y nunca deben recibir contraseñas como argumento.

Los generadores de ConfigMap usan `aira` por defecto. Para otro clúster, define `AIRA_K8S_NAMESPACE` antes de generarlos con el namespace de esa instalación.

| Script | Cuándo usarlo | Resultado y precaución |
| --- | --- | --- |
| `bootstrap_admin.py` | Tras crear el esquema en una base nueva: `python scripts/bootstrap_admin.py --name 'Administrador inicial' --email 'tu-correo@example.org'`. | Pide contraseña interactiva, inserta solo el primer ADMIN activo. Requiere acceso BD; no lo uses en producción sin verificar la base destino. |
| `generate_db_configmap.py` | Antes del primer despliegue Kubernetes. | Genera `k8s/02-db-init.yaml` desde el SQL. Solo inicializa una base con volumen vacío. |
| `generate_api_configmap.py` | Después de cambiar API o dependencias. | Genera `k8s/04-api-code.yaml`. Revisa tamaño y namespace. |
| `generate_web_configmaps.py` | Después de `cd web; npm ci; npm run build; cd ..`. | Genera los ConfigMaps `05-web-core.yaml`, `05-web-assets.yaml` y `05-web-main-js.yaml` desde `web/dist`. Crea los tres con `kubectl create -f` la primera vez y actualiza los tres con `kubectl replace -f`: tanto assets como el JS principal pueden superar el límite de anotaciones de `kubectl apply`. Comprueba que los tres se actualicen antes de reiniciar web y verifica todos los archivos publicados después del rollout. |
| `generate_tls_certificates.py` | Solo en un entorno que administra su propia CA; consulta `--help`. | Produce claves privadas y certificados. Guarda la salida fuera de Git y comprueba dominio/cadena antes de desplegar. |
| `register_firmware.py` | Registrar un `.bin` ESP32 ya compilado. | Escribe metadatos y contenido en la base. Requiere argumentos de versión, reglas, nombre y ruta; úsalo solo con un binario verificado. |
| `replace_uninstalled_firmware.py` | Corregir un binario recién registrado en estado `prueba`. | Solo lo reemplaza cuando no hay nodos asociados a esa versión; usa el entorno y dependencias del API. |
| `test_telemetry_audit.py` | Tras ampliar el contrato de telemetría. | Valida paquetes nuevos y antiguos y ejecuta `EXPLAIN` del `INSERT` real sin crear ventanas. |
| `backfill_firmware.py` y `check_firmware_download.py` | Mantenimiento del catálogo de firmware. | Consulta el código y destino antes de usar en una instalación con datos. |
| `test_telegram_bot.py` | Verificación en entorno de pruebas. | Simula mensajes, pero también consulta la BD; no es independiente del esquema. |
| `check_publication.py` | Tras `git add` y antes de cada push. | Examina archivos preparados y bloquea rutas/credenciales conocidas; complementa revisión manual e imágenes. |

Los ConfigMaps generados, binarios, respaldos y certificados están ignorados por Git. Comprueba `git status --short`, `git diff --cached --name-only` y `python scripts/check_publication.py` antes de publicar. Si cambias namespace o ruta de archivos, adapta el generador y su README en el mismo cambio.
