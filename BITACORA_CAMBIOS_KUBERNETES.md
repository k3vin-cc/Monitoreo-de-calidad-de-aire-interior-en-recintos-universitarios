# Bitácora de cambios del proyecto AIRA en Kubernetes

Este documento registra cambios realizados en el proyecto Kubernetes, su propósito, archivos afectados, validaciones y acciones de recuperación. Se actualizará junto con los cambios futuros de este proyecto.

## Estado operativo

- Clúster/contexto usado: `estudiante-kcortes`.
- Namespace de la aplicación: `student-kcortes`.
- Sitio: `https://kcortes.dev.censei.cl`.
- Última comprobación registrada: 2026-10-30. Los Deployments `calidad-api`, `calidad-web`, `calidad-db` y `calidad-mqtt` estaban `1/1` disponibles; los cuatro Pods estaban `Running`.
- La comprobación interna de `http://127.0.0.1:8080/api/healthz` desde el Pod web respondió `{"status":"ok"}`.

## 2026-10-30 — Autorización WebSocket, exportaciones y límite de acceso invitado

### Propósito

Corregir la entrega de eventos WebSocket fuera del ámbito autorizado, respetar la expiración e inactividad de sesión, evitar fórmulas ejecutables en CSV, limitar el uso de memoria en exportaciones históricas, incluir el login de invitado en el límite por IP y evitar asignar el rol `GUEST` desde el administrador.

### Archivos y cambios

- `api/main.py`
  - `Hub.broadcast`: valida tipo y sala del evento; aplica ámbito de edificio y rol al enviar eventos; reserva alertas para `ADMIN` y `ANALISTA`; permite al invitado sólo eventos de ventana; desconecta sesiones expiradas o inactivas con cierre `4401`. Los eventos fuera de ámbito se descartan sin invalidar la sesión.
  - `session_from_token`: conserva la expiración del JWT en la información usada por la conexión WebSocket.
  - `csv_safe_text`: neutraliza valores de texto que podrían interpretarse como fórmula en una hoja de cálculo.
  - `stream_room_export`: transmite exportaciones CSV/JSON en bloques desde un cursor PostgreSQL en lugar de cargar todo el historial en memoria. La exportación CSV aplica neutralización a las celdas.
  - El CSV de Telegram aplica la misma neutralización. No cambia su límite de 1000 filas.
- `web/src/ui.jsx`
  - `HistoryPage.download`: convierte la respuesta JSON en un `Blob` descargable, compatible con `URL.createObjectURL`.
  - El alta de usuarios ya no ofrece `GUEST` como rol asignable. Los registros antiguos con ese rol se muestran como legado deshabilitado.
- `k8s/06-ingress-auth-limit.yaml`
  - Añade `/api/auth/invitado` al Ingress con la misma política de límite por IP aplicada al login normal: 10 solicitudes por minuto y burst 2.

### Impacto y compatibilidad

- No se modificó el esquema de PostgreSQL ni se añadieron dependencias.
- Se mantienen las rutas y formatos de exportación existentes.
- El archivo de Ingress del repositorio conserva sus valores plantilla (`aira` / `aira.example.org`). Para el clúster `student-kcortes` se aplicaron los valores específicos del entorno durante el despliegue.
- La descarga JSON ahora crea explícitamente el `Blob` antes de guardarlo.

### Verificaciones realizadas

- `python -m py_compile api/main.py`: correcto.
- `npm run build` en `web/`: correcto con Vite 5.4.21.
- `git diff --check`: sin errores de whitespace; Git mostró sólo un aviso de conversión LF/CRLF en el manifiesto Ingress.
- Pruebas sintéticas: neutralización CSV, estructura y serialización JSON, ámbitos/roles WebSocket, expiración de sesión y captura de expiración JWT en `session_from_token`: correctas.
- Despliegue: ConfigMaps de API y web regenerados; Deployments de API y web reiniciados y rollout completado. Ingress actualizado. Salud interna del API verificada desde el Pod web.
- No se hizo una prueba de carga del rate limit ni una validación visual manual en navegador.

### Diagnóstico y recuperación

Consultar primero el estado de recursos:

```powershell
kubectl -n student-kcortes get deployments,pods,ingress -o wide
kubectl -n student-kcortes logs deployment/calidad-api --tail=200
kubectl -n student-kcortes logs deployment/calidad-web --tail=200
```

Comprobar la salud interna del API:

```powershell
kubectl -n student-kcortes exec deployment/calidad-web -- wget -qO- http://127.0.0.1:8080/api/healthz
```

Si se requiere volver al código de la imagen actualmente desplegada, primero consultar el historial y confirmar que el rollout anterior corresponde a la versión deseada; después puede usarse `kubectl -n student-kcortes rollout undo deployment/calidad-api` o `kubectl -n student-kcortes rollout undo deployment/calidad-web`. Esto revierte el Deployment, pero los ConfigMaps se deben restaurar por separado si también se desea revertir su contenido. No ejecutar la reversión sin verificar el historial y los ConfigMaps activos.

Para restaurar manifiestos desde Git, aplicar sólo después de verificar el contexto y los valores de entorno:

```powershell
kubectl config current-context
kubectl -n student-kcortes get configmap
```

### Seguimiento Git

Este cambio está preparado para un commit local descriptivo junto con esta bitácora. El `push` requiere autorización explícita posterior, conforme a `contrato-general.md`.

## Registro de cambios futuros

Para cada modificación posterior se añadirá una entrada con fecha, motivo, archivos y funciones afectados, impacto/compatibilidad, validaciones, despliegue y pasos de diagnóstico o recuperación pertinentes. También se anotará el identificador del commit local y si el cambio fue publicado en GitHub.

## 2026-10-30 — Navegación de consulta para invitado

### Motivo

El invitado podía cargar el resumen del campus, pero la tarjeta de sector no era un enlace, las rutas de sector/edificio/piso/sala lo redirigían al inicio y la API rechazaba varias lecturas necesarias para navegar.

### Archivos y cambios

- `web/src/ui.jsx`
  - La tarjeta de sector ahora enlaza con la vista del sector.
  - Las rutas de sector, edificio, piso y sala admiten `GUEST`; las demás rutas conservan sus roles actuales.
- `api/main.py`
  - Se habilita `GUEST` en lectura de sectores, edificios, pisos, salas, estado actual de sala y complementos de estado. Las operaciones de escritura siguen bajo `ADMIN`.
  - La comprobación de acceso a una sala continúa usando `ensure_room_access`; el invitado ve los datos de estado actuales, no historial.
  - `/nodos` permanece sólo para `ADMIN`: esa vista incluye MAC, SSID Wi-Fi, firmware y datos de operación. El identificador y conectividad del nodo se muestran dentro de la sala.

### Alcance y validación

El recorrido esperado es inicio → sector → edificio → piso → sala. No se habilitan para el invitado la administración independiente de nodos, historial, alertas, usuarios, espacios administrativos, perfil ni Telegram.

### Verificaciones realizadas

- `python -m py_compile api/main.py`: correcto.
- `npm run build` en `web/`: correcto con Vite 5.4.21.
- Sesión GUEST sintética contra el API desplegado: `/campus`, `/sectores`, `/edificios`, `/pisos` y `/salas` respondieron 200 y devolvieron datos. La consulta de estado de una sala respondió 200 e incluyó el identificador de nodo.
- La ruta administrativa `GET /nodos` respondió 403 para GUEST.
- Se regeneraron los ConfigMaps de API y web; los Deployments `calidad-api` y `calidad-web` completaron el rollout. Los Pods quedaron `Running` y el proxy `/api/healthz` respondió `{"status":"ok"}`.
- La validación directa usando el dominio HTTPS no pudo completarse porque el cliente reportó `PartialChain` en el certificado TLS. La validación funcional se realizó por el servicio interno del clúster sin desactivar la verificación TLS.

### Nota de despliegue

`kubectl apply` no pudo actualizar los ConfigMaps grandes porque los manifiestos generados superan el límite de tamaño de la anotación `last-applied-configuration`. Inicialmente se reemplazó sólo `calidad-web-main-js`; la revisión posterior de la pantalla en blanco confirmó que también había quedado desactualizado `calidad-web-assets`. La recuperación completa se registra a continuación.

## 2026-10-30 — Recuperación de pantalla en blanco

La actualización parcial del frontend dejó el módulo principal nuevo junto a módulos secundarios antiguos. Los logs mostraron respuestas 404 para `PenpotLogin-Baq8UYcf.js` y `arrow-right-CPM_xp43.js`, lo que impedía iniciar la interfaz.

Se reemplazaron juntos `calidad-web-core`, `calidad-web-assets` y `calidad-web-main-js` desde el mismo build, y se reinició `calidad-web`. El rollout terminó correctamente. Se compararon por SHA-256 los 45 archivos de `web/dist` contra los publicados por el Pod: todos coincidieron. El módulo de login respondió HTTP 200 con tipo JavaScript y `/api/healthz` respondió `ok`. No se modificaron permisos, datos ni esquema de base de datos en esta recuperación.

Se corrigieron `scripts/README.md` y `k8s/README.md` para usar creación inicial y reemplazo de los tres ConfigMaps en actualizaciones. Antes de reiniciar web debe comprobarse que los tres comandos hayan terminado correctamente; después se debe verificar el contenido de todos los assets, además de la sonda de salud. No se realizó validación visual en navegador.
