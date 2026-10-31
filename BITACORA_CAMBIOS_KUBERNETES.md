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

## 2026-10-30 — Publicación en GitHub autorizada

El usuario autorizó publicar en `origin/main` los siguientes commits locales, con mensajes descriptivos en español y detalle por archivo:

- `e07160d`: sesiones WebSocket, exportaciones seguras y límite de acceso invitado.
- `4b04981`: navegación de consulta del invitado hasta la sala y estado del nodo.
- `9b7962e`: recuperación de assets y corrección de instrucciones de despliegue.

Este registro acompaña el mismo lote de publicación. Los archivos sin seguimiento preexistentes del área de trabajo no se incluyen. El destino es el repositorio `k3vin-cc/Monitoreo-de-calidad-de-aire-interior-en-recintos-universitarios`, rama `main`.

## 2026-10-30 — Análisis de mejoras de Usuarios

Se leyó el contrato y se revisaron componente activo, ruta, CSS, servicios HTTP, esquemas y endpoints de usuarios. Los hallazgos y plan están en `PLAN_MEJORAS_USUARIOS.md`. Destacan guardado por pérdida de foco, falta de bloqueo de operaciones, errores detrás de modales, recargas completas y transacciones separadas en edición de cuenta. No se modificó código ni se desplegó una nueva versión. La inspección visual quedó pendiente porque el navegador conectado devolvió `browser.user is unavailable`; tampoco se midieron tiempos reales de rendimiento. Implementación pendiente de autorización del plan.

El usuario precisó que realizará la validación visual. Se revisó nuevamente el código y se amplió el plan con reversión por lotes: referencia Git de base `9e505c1`, respaldo de ConfigMaps y Deployments reales antes de implementar, restauración conjunta de assets y verificación por hashes. Se aclara que revertir código o despliegue no revierte operaciones guardadas en cuentas. Esta ampliación modifica únicamente documentación; no se desplegaron cambios de aplicación.

## 2026-10-30 — Primer lote de mejoras de Usuarios autorizado y desplegado

- `web/src/PenpotUsers.jsx`: diálogos nativos accesibles, selección de edificios mediante casillas y guardado explícito, formulario de contraseña con confirmación, mensajes dentro del diálogo, bloqueo de envíos y cierre durante escritura. Se agregaron filtro por estado, contador y limpieza de filtros. Las ediciones usan la respuesta de PATCH y las eliminaciones actualizan la lista local; ya no se recargan edificios después de cada cambio. Los conteos compartidos se calculan una sola vez por cambio de lista.
- Funciones del componente: `reload`, `create`, `update`, `removeUser` y `UserRow` modificadas; `openDialog`, `closeDialog`, `submitEdit`, `UserDialog`, `BuildingChoices`, `DialogActions` y `CreateUserForm` agregadas. Cada una documenta entradas, salida y efectos.
- `web/src/penpot.css`: estilos de Usuarios acotados a `.penpotUsers`; tipografía/controles mayores, foco visible, tabla con desplazamiento y formularios adaptados a móvil.
- `web/src/services.js`: los errores 422 con lista de validaciones ahora indican campo y motivo. Es una función compartida por otras páginas; conserva rutas, cookies y respuestas exitosas.
- `PLAN_MEJORAS_USUARIOS.md`: plan autorizado, procedimiento de reversión concreto y estado de primer/segundo lote.

Antes de editar se creó la etiqueta local `respaldo/usuarios-20261030` sobre `9e505c1` y la rama `codex/mejoras-usuarios`. Los ConfigMaps y Deployments reales se guardaron fuera de Git en `C:\Users\corte\.codex\backups\aira-usuarios-20261030-antes`, con hashes y script `Restaurar.ps1`. Se validó sintaxis del script y restauración web con dry-run del servidor; no se ejecutó la reversión real.

Build Vite correcto y prueba HTTP simulada correcta para mensajes 422, PATCH, envío de cookies y JSON. Se reemplazaron los tres ConfigMaps web, comprobando éxito antes de reiniciar. Rollout completo, 45 archivos idénticos por SHA-256, todos los assets disponibles por HTTP y salud API `ok`. No se escribieron cuentas reales ni se realizaron pruebas visuales; la revisión visual queda a cargo del usuario.

Sin cambios de esquema, API, permisos ni dependencias. El backend transaccional pertenece al segundo lote posterior a la revisión visual. La reversión del frontend restaura archivos publicados; no deshace operaciones guardadas sobre usuarios. Push pendiente de autorización.

## 2026-10-30 — Retiro del aviso de roles en Usuarios

Se eliminó de `web/src/PenpotUsers.jsx` el bloque «Acceso controlado por rol y ubicación» y el icono que sólo se utilizaba en ese bloque. Se retiraron sus reglas CSS específicas en `web/src/penpot.css`. No cambia permisos, endpoints ni operaciones de cuenta. Build Vite correcto; se reemplazaron los tres ConfigMaps y el rollout de web completó. La búsqueda en los assets servidos confirmó que el texto ya no está y `/api/healthz` respondió `ok`.

## 2026-10-30 — Análisis de mejoras de Espacios

Se revisaron `LocationsAdmin`, `CascadeSelect`, estilos, servicios HTTP, esquemas Pydantic, endpoints y operación de retiro. El análisis, prioridades y reversión están en `PLAN_MEJORAS_ESPACIOS.md`. No se modificó ni desplegó la aplicación. La comprobación visual y la medición de rendimiento quedan pendientes de la etapa de implementación.

## 2026-10-30 — Mejoras de Espacios implementadas

- `web/src/LocationsAdmin.jsx`: bloqueo de escritura, errores dentro de diálogos, confirmación escrita para borrar historial y diálogo nativo con control de foco. Tabla con nombre, jerarquía e ID secundario; búsqueda con mapas por ID y refresco sin ocultar la tabla. `reload`, `submit`, `remove`, `openRetireDialog` y las filas/diálogos fueron modificados; `LocationDialog` fue agregado y documentado.
- `web/src/penpot.css`: tamaños, foco, diálogo, tabla y controles de Espacios, limitados al componente.
- `PLAN_MEJORAS_ESPACIOS.md`: implementación, respaldo y restauración concretos.

Base Git `c482077`, etiqueta `respaldo/espacios-20261030`; ConfigMaps y Deployment web anteriores guardados fuera de Git en `C:\Users\corte\.codex\backups\aira-espacios-20261030-antes`. Sintaxis del script `Restaurar.ps1` y reemplazo simulado de los tres ConfigMaps correctos. Build Vite correcto; los tres ConfigMaps actuales se reemplazaron antes de reiniciar web; rollout completo, 45 assets iguales por SHA-256 y salud API `ok`. Sin cambios de base de datos, API, rutas, permisos ni dependencias. No se hicieron mutaciones de espacios ni se midió rendimiento real. Revisión visual del usuario pendiente. Restaurar la web no recupera datos borrados por operaciones posteriores.

## 2026-10-30 — Espacios preparada para más ubicaciones

- `web/src/LocationsAdmin.jsx`: añade filtros jerárquicos de sector, edificio y piso, búsqueda por ruta completa, 20 resultados por página y conteo de nodos activos en salas. Reinicia página y filtros al cambiar de contexto. La paginación limita filas renderizadas; la API sigue enviando el resumen completo.
- `web/src/penpot.css`: filtros adaptables y tarjetas móviles en la tabla de Espacios.
- `PLAN_MEJORAS_ESPACIOS.md`: registra esta etapa, límite de rendimiento y reversión de la versión visual inmediatamente anterior.

La versión previa `133d8e3` quedó etiquetada `respaldo/espacios-volumen-20261030`; su despliegue está respaldado fuera de Git en `C:\Users\corte\.codex\backups\aira-espacios-volumen-20261030-antes`. Tres ConfigMaps web reemplazados conjuntamente y rollout completado. Build correcto, 45 assets idénticos por SHA-256, salud API `ok`. Sin cambios de API, esquema, permisos o datos; revisión visual del usuario pendiente.

## 2026-10-30 — Explorador visual combinado de Espacios

- `web/src/LocationsAdmin.jsx`: reemplaza las pestañas y tablas por tarjetas para sectores/edificios y listas compactas para pisos/salas/nodos. Añade ruta jerárquica, búsqueda por nivel o en toda la estructura, apertura directa de resultados, páginas de 20, carga diferida de nodos y preselección de la ubicación superior al crear. Conserva los diálogos de edición y retiro. Se modificó `LocationsAdmin`; se agregaron `loadNodes`, `enter`, `openResult` y la reconciliación de selección al recargar.
- `web/src/penpot.css`: define tarjetas, listas, ruta, búsqueda y adaptación móvil sólo para `.locationsAdmin`.
- `PLAN_MEJORAS_ESPACIOS.md`: documenta el diseño elegido, la limitación del endpoint de nodos, verificación y reversión.
- `k8s/05-web-core.yaml`, `k8s/05-web-assets.yaml`, `k8s/05-web-main-js.yaml`: se regeneraron juntos desde el mismo build de Vite para publicar CSS y JavaScript coherentes; son artefactos ignorados por Git.

La versión previa `dddca8a` quedó etiquetada `respaldo/espacios-tarjetas-20261030`; ConfigMaps, Deployment, hashes y script de recuperación están en `C:\Users\corte\.codex\backups\aira-espacios-tarjetas-20261030-antes`. Dry run de reemplazo aceptado. Build correcto, rollout completo, 45 archivos servidos idénticos por SHA-256 y `/api/healthz` respondió `ok`. Sin cambios de API, permisos, esquema ni datos. La consulta `/nodos` sigue devolviendo la lista completa cuando se abre una sala o se busca globalmente; se medirá si el volumen futuro afecta su respuesta. Revisión visual del usuario pendiente; sin push automático.

## 2026-10-30 — Explorador flotante de Espacios

- `web/src/LocationsAdmin.jsx`: la vista principal conserva tarjetas de sectores; pulsar toda la tarjeta abre una ventana flotante que permite recorrer edificios, pisos, salas y nodos. La ventana mantiene ruta, búsqueda y paginación. Se añadió `closeExplorer` para volver a sectores y devolver el foco. El explorador se suspende al editar o retirar y vuelve a la misma ubicación al cerrar el formulario. Se amplió `LocationDialog` con una clase visual para el explorador.
- `web/src/penpot.css`: añade área pulsable de tarjeta, dimensiones de la ventana, encabezado fijo y presentación de pantalla completa en móvil, limitados a `.locationsAdmin`.
- `PLAN_MEJORAS_ESPACIOS.md`: registra el alcance, las pruebas y el procedimiento de restauración de esta etapa.
- Los tres ConfigMaps web ignorados por Git se regeneraron desde el mismo build y se reemplazaron juntos.

Base Git `f2b0653`, etiqueta `respaldo/espacios-modal-20261030`; respaldo de ConfigMaps, Deployment, hashes y `Restaurar.ps1` en `C:\Users\corte\.codex\backups\aira-espacios-modal-20261030-antes`. Dry run de restauración aceptado. Build correcto, rollout web completo, 45 archivos idénticos por SHA-256 y salud API `ok`. Sin cambios de API, permisos, esquema, datos ni dependencias. La revisión visual corresponde al usuario; no se hizo push.

## 2026-10-30 — Análisis y plan de Nodos

Se revisaron `NodesPage`, `NodeRoomSelect`, `NodeInventory`, estilos, servicios HTTP, esquemas Pydantic y endpoints de nodos, firmware y aprovisionamiento. `PLAN_MEJORAS_NODOS.md` documenta los problemas comprobados en código, las etapas propuestas, límites de medición, compatibilidad y restauración. Se detectó que el selector de sala consulta cuatro listas por cada nodo incluso si su pestaña está oculta con CSS. No se modificó ni desplegó la aplicación; no hubo operaciones sobre dispositivos ni datos.

## 2026-10-30 — Mejoras de Nodos desplegadas

Acceso al nodo desde Espacios: `LocationsAdmin.jsx` envía `?nodo=ID` en el enlace individual Administrar. `NodeInventory.jsx` busca ese ID exacto en la lista autorizada una vez cargada, filtra el listado y abre su edición; consume el parámetro para evitar reaperturas al refrescar. Si el registro ya no existe, muestra aviso. Sin cambios de roles, API o datos. Build, rollout y salud API correctos; revisión visual pendiente. Reversión mediante el commit aislado de este cambio.

Corrección del selector compartido: `web/src/CascadeSelect.jsx` inicializaba opciones abiertas y repetía esa apertura al actualizar valor/datos; también abría automáticamente el nivel siguiente. Ahora inicia cerrado en modo normal y compacto, abre un solo nivel por clic y cierra al elegir, pulsar fuera o Escape. Afecta formularios de ubicación que usan este componente; no modifica valores ni contratos HTTP. Prueba de render inicial con valor seleccionado correcta en ambos modos, build correcto, rollout completo, 45 archivos publicados idénticos y API `ok`. Interacciones visuales pendientes del usuario. Reversión mediante el commit aislado de este ajuste.

Corrección posterior a la captura del usuario: `web/src/penpot.css` elimina el scroll del contenedor de nodos y hace que las opciones de sala amplíen la fila en flujo normal. La tabla usa ancho fijo y permite partir texto para ajustarse al panel. La causa era `overflow:auto` junto con el desplegable absoluto de `compactCascade`. Build y rollout correctos, 45 archivos publicados idénticos por SHA-256 y API `ok`; revisión visual pendiente del usuario. Se puede revertir este ajuste mediante su commit aislado. No hay cambios de datos ni API.

- `web/src/ui.jsx`: `NodesPage` comparte ubicaciones y monta sólo la pestaña activa; añade filtros/páginas, detalles técnicos, fechas del catálogo y publicación desplegable. `NodeRoomSelect` usa datos compartidos, bloquea duplicados y muestra errores. USB carga el catálogo y conserva visible su operación mediante bloqueo de pestañas.
- `web/src/NodeInventory.jsx`: `reload` pasa de cinco consultas a dos, conserva filas al refrescar; `save` y `remove` controlan duplicados y errores locales. Añade confirmación por ID para borrar historial y `NodeDialog` con foco y Escape controlados.
- `web/src/NodeListControls.jsx`: controles compartidos de búsqueda, estado, sala y paginación; prueba de `filterNodes` con dos salas distintas y un dispositivo sin asignar correcta.
- `web/src/penpot.css`: filtros, detalles, diálogo, filas móviles como tarjetas y visibilidad de paneles condicionales.
- `PLAN_MEJORAS_NODOS.md`: alcance aplicado, respaldo, restauración y límites de validación.

Base `8befd96`, etiqueta `respaldo/nodos-20261030`; respaldo en `C:\Users\corte\.codex\backups\aira-nodos-20261030-antes`. Dry run de restauración aceptado, build correcto, tres ConfigMaps regenerados y reemplazados juntos, rollout completo, 45 assets idénticos por SHA-256 y API `ok`. Sin cambios de API, datos, roles o dependencias. Sin medición de latencia, escrituras reales o prueba física USB; revisión visual pendiente. La paginación es local. No se hizo push.

## 2026-10-30 — Análisis de Telegram

Se documentó en PLAN_MEJORAS_TELEGRAM.md el perímetro frontend/backend, vinculación, preferencias, avisos y acceso por rol. Se detectaron apertura de revinculación sin advertencia, estado web desactualizado, falta de búsqueda de salas y validación débil del booleano de avisos. No se modificó la aplicación, no se desplegó ni se enviaron mensajes. El plan incluye etapas, validación y reversión.

## 2026-10-30 — Mejoras de Telegram aplicadas

TelegramPage.jsx separa la página de ui.jsx y añade comando copiable, vencimiento, confirmación de vínculo, protección de operaciones y selección de salas con búsqueda/páginas. penpot.css adapta sus controles. api/main.py añade TelegramPreferencesIn estricto, filtrado de permisos actuales, códigos no almacenables en caché y espera de 30 segundos entre generaciones; revincular desactiva avisos explícitamente. PLAN_MEJORAS_TELEGRAM.md documenta alcance y límites. Respaldo de web/API y restauración en C:\Users\corte\.codex\backups\aira-telegram-20261030-antes; etiqueta respaldo/telegram-20261030. Python, build, rechazo de booleanos ambiguos y GUEST correctos; ambos rollouts completos, salud ok y 46 archivos web idénticos. Sin mensajes, códigos reales ni escrituras de prueba. Validación visual y vinculación completa pendientes. Sin cambios de esquema ni dependencias. Sin push.

## 2026-10-30 — Análisis funcional de crecimiento de Telegram

Se amplió PLAN_MEJORAS_TELEGRAM.md con selección jerárquica/masiva, pausas web, desvinculación, concurrencia web/bot y trazabilidad. Se revisaron código de envíos y esquema SQL versionado; no se midió carga ni se consultaron secretos o esquema productivo. Sin cambios de aplicación ni mensajes.

## 2026-10-30 — Funciones de Telegram para muchos espacios

TelegramPage.jsx añade filtros jerárquicos por ID, suscripciones actuales, acciones masivas con alcance explícito, deshacer local, estado efectivo, nodos activos, pausas, desvinculación e historial paginado. services.js incorpora las rutas personales nuevas; penpot.css adapta filtros y acciones. api/main.py añade TelegramPauseIn, telegram_pause, telegram_unlink y telegram_deliveries; el PUT de preferencias aplica diferencias e inserta por conjunto y detecta conflicto del interruptor global. PLAN_MEJORAS_TELEGRAM.md detalla límites y pendientes de crecimiento.

Respaldo en C:\Users\corte\.codex\backups\aira-telegram-funciones-20261030-antes; etiqueta respaldo/telegram-funciones-20261030. Pruebas simuladas de diferencias, conflicto, duraciones y GUEST correctas; Python/build, ambos rollouts y salud correctos; 46 archivos web idénticos por SHA-256. Sin mensajes ni cambios reales de preferencias durante pruebas, sin migraciones. Revisión visual pendiente. La paginación del catálogo de salas sigue siendo local; historial usa servidor. No se implementaron reglas para salas futuras, horarios ni persistencia de fallos. Sin push.
