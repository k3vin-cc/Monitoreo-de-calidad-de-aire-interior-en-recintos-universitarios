# Análisis y plan de mejoras de Nodos

Fecha: 2026-10-30. Estado: mejoras frontend desplegadas; revisión visual pendiente. Base de implementación: `8befd96`.

## Perímetro revisado

`/nodos` carga `NodesPage` en `web/src/ui.jsx` y `/nodos/administrar` carga `web/src/NodeInventory.jsx`; ambas rutas exigen `ADMIN`. `NodesPage` combina tres pestañas (Dispositivos, Firmware y Conexión USB), incluye `NodeRoomSelect`, usa `web/src/services.js`, `web/src/penpot.css`, `web/src/style.css` y Web Serial. `NodeInventory` usa `CascadeSelect` y los endpoints de listado, creación, edición y retiro. Espacios también consume `GET /nodos` al entrar a una sala o buscar globalmente. La sesión viaja mediante cookie y la autorización se valida en FastAPI.

La API involucrada incluye `GET /nodos`, `GET /nodos/{nodoId}/resumen-retiro`, `POST/PATCH/DELETE /nodos`, `PATCH /nodos/{nodoId}/asignacion`, `POST /nodos/{nodoId}/aprovisionamiento`, `PATCH /nodos/{nodoId}/firmware` y el catálogo `/firmwares`. Se revisaron `NodeIn`, `NodePatch`, `FirmwareAssignIn` y `FirmwarePatch`. La API consulta o modifica `nodos`, `salas`, `pisos`, `edificios`, `sectores`, `firmwares`, `telemetria`, `telemetria_tiempo_incierto` y `alertas`. El aprovisionamiento obtiene una credencial del nodo y registra el cliente en Mosquitto; el flasheo usa Web Serial. El retiro puede borrar historial si el administrador lo solicita.

## Problemas comprobados en el código

1. `NodeRoomSelect` consulta sectores, edificios, pisos y salas por cada fila. `NodesPage` monta la tabla aunque otra pestaña esté oculta con CSS. Con N nodos se generan hasta 4N solicitudes de ubicaciones al montar el panel, además de las solicitudes principales. No se midió aún la latencia real.
2. `/nodos` y `/nodos/administrar` muestran todos los nodos sin búsqueda, filtros ni paginación. Las columnas técnicas ocupan mucho espacio y complicarán localizar un dispositivo cuando crezca el inventario.
3. `NodeInventory.reload()` vuelve a pedir nodos y cuatro listas de ubicaciones y oculta la tabla completa mientras actualiza. La respuesta de `GET /espacios/resumen` ya reúne las cuatro listas para `ADMIN`.
4. `NodeRoomSelect` revierte la selección si falla `PATCH /nodos/{id}/asignacion`, pero el error no se muestra. Los errores de crear/editar en `NodeInventory` quedan en el aviso general detrás del diálogo; el diálogo de retiro se cierra si falla.
5. Los diálogos de `NodeInventory` usan un fondo con `role=dialog` sin contención y retorno de foco. No se bloquean envíos repetidos ni el cierre durante operaciones pendientes. La opción de borrar historial permanente carece de confirmación escrita específica.
6. En Firmware, el cambio de estado llama a `api.patchFirmware` sin tratamiento de error local. En Conexión USB, las pestañas siguen disponibles durante una operación y el panel activo se puede ocultar, perdiendo de vista el progreso sin detener necesariamente el trabajo.
7. El texto del monitor serie se muestra en pantalla y puede descargarse. Antes de cambiar ese flujo, se debe comprobar que ninguna respuesta del dispositivo incluya credenciales; no se observó una filtración confirmada en esta revisión.

## Plan de implementación

### Etapa 1: rendimiento y seguridad de uso

- Cargar la estructura de ubicaciones una vez en `NodesPage` y pasarla a `NodeRoomSelect`; reutilizar `GET /espacios/resumen` para el rol `ADMIN`. Montar sólo el contenido de la pestaña activa para evitar efectos y renderizado de paneles ocultos. Conservar el formulario de asignación y el endpoint existentes.
- En `NodeInventory`, cargar nodos y resumen de espacios en paralelo; mantener el listado visible durante las actualizaciones y anunciar el refresco. Mostrar errores de asignación y guardado junto al control afectado.
- Bloquear operaciones duplicadas, cierre y cambio de pestaña durante flasheo, aprovisionamiento o escrituras pendientes. Mantener el estado y los errores de cada operación visibles. No cambiar el protocolo de Web Serial ni el manejo de la credencial MQTT en esta etapa.
- Mejorar los diálogos de alta, edición y retiro con foco contenido, Escape controlado y retorno de foco. Exigir confirmación escrita sólo si se selecciona borrar historial; conservar el retiro sin borrado como opción inicial.

### Etapa 2: diseño para muchos nodos

- En Dispositivos y Administrar, dar prioridad visual a nombre, estado, sala y última telemetría. Ubicar MAC, Wi-Fi, firmware e ID en un detalle accesible por fila, sin perder los datos existentes.
- Incorporar búsqueda por nombre, ID y MAC; filtros por conexión y ubicación; conteo de resultados y paginación local. Mostrar filas compactas en escritorio y tarjetas en móvil. Distinguir claramente «sin asignar» de «última sala del historial».
- Mantener Firmware y Conexión USB como pestañas separadas. Presentar el catálogo de versiones con estado y fecha claros; situar la carga de binario como acción secundaria. En USB, ordenar los pasos y mostrar el progreso de forma persistente mientras dure la operación.

### Etapa 3: medición y validación

- Medir número de solicitudes, tamaño y tiempo de `GET /nodos`, `GET /espacios/resumen` y renderizado con el volumen actual. La paginación del navegador limita filas dibujadas, pero no la transferencia de `GET /nodos`. Si el crecimiento exige filtros o paginación de servidor, preparar un plan separado para cambiar el contrato HTTP y revisar la consulta SQL.
- Verificar por código los permisos `ADMIN`, validaciones Pydantic, respuestas y errores de alta, edición, asignación, firmware y retiro. No ejecutar flasheos ni borrados de historial reales como prueba visual. Probar operaciones de escritura sólo con datos desechables y un dispositivo de pruebas autorizado.
- Ejecutar build, publicar juntos los tres ConfigMaps web, comprobar rollout, salud y hashes de assets. El usuario revisará la apariencia en escritorio y móvil.

## Riesgos, compatibilidad y reversión

La primera etapa pretende conservar rutas, roles, esquemas, endpoints, payloads, MQTT, Web Serial y datos. El principal riesgo es alterar una asignación o un estado de operación por mover la carga de ubicaciones fuera de cada fila; debe verificarse con al menos dos nodos en salas distintas y uno sin asignar. Cambiar la presentación del flujo USB requiere preservar su secuencia actual de selección de puerto, verificación SHA-256, escritura y confirmación del dispositivo.

Antes de implementar, crear una etiqueta Git del commit estable y respaldar los tres ConfigMaps web publicados y el Deployment fuera del repositorio, con hashes y un script de restauración validado en el contexto `estudiante-kcortes` y namespace `student-kcortes`. Si se modifica backend en una etapa posterior, respaldar también API. Para revertir la web, restaurar juntos los tres ConfigMaps, reiniciar `calidad-web`, comprobar rollout y hashes, y crear un commit que deshaga sólo Nodos. Restaurar la interfaz no revierte altas, asignaciones, versiones de firmware, flasheos ni historial borrado; no se usarán esas operaciones irreversibles para la validación visual.

## Implementación y comprobaciones

Se implementó carga compartida de ubicaciones en `NodesPage`, montaje por pestaña activa y carga del catálogo también en USB (necesaria para seleccionar firmware). `NodeRoomSelect` recibe las ubicaciones, bloquea asignaciones duplicadas y muestra errores. El panel bloquea cambios de pestaña durante operaciones USB, monitor o retiro de firmware; el cambio de estado de firmware muestra fallos. La publicación de una versión queda en una sección desplegable, el catálogo muestra fecha y USB presenta pasos visibles sin modificar su protocolo.

`NodeInventory.reload` consulta nodos y resumen en dos solicitudes paralelas y mantiene el inventario durante un refresco. `save` y `remove` bloquean duplicados y conservan errores en sus diálogos; borrar historial exige escribir el ID. `NodeDialog` contiene el foco y controla Escape. Ambas vistas usan `NodeListControls`, `filterNodes` y `NodePages` para búsqueda, filtros de estado/sala y 20 filas por página. MAC, red y firmware se muestran mediante detalles desplegables; móvil muestra filas como tarjetas. La paginación sigue siendo local y la API entrega el inventario completo.

Respaldo previo en `C:\Users\corte\.codex\backups\aira-nodos-20261030-antes`, con tres ConfigMaps, Deployment, hashes y `Restaurar.ps1`; etiqueta Git `respaldo/nodos-20261030`. El reemplazo simulado de los respaldos fue aceptado. Para restaurar la web anterior:

```powershell
& 'C:\Users\corte\.codex\backups\aira-nodos-20261030-antes\Restaurar.ps1'
```

Build Vite correcto y prueba ejecutada de filtros con dos salas distintas, conexión y un nodo sin asignar. Rollout completo, 45 archivos publicados idénticos por SHA-256 y salud API `ok`. No se midieron tiempos reales ni se realizaron escrituras o pruebas físicas de flasheo/USB. El usuario hará la revisión visual. La validación de asignación real, firmware y dispositivo queda pendiente; los resultados anteriores no prueban el funcionamiento físico. No hubo cambios de backend, permisos, datos, protocolo ni dependencias.
