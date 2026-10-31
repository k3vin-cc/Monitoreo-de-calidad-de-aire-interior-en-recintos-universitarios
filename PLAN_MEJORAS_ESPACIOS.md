# Análisis y plan de mejoras de Espacios

Fecha: 2026-10-30. Estado: mejoras de interfaz desplegadas; revisión visual pendiente del usuario. Base de código anterior: `c482077` (la aplicación era equivalente a `9c3bebb`).

## Perímetro revisado

La ruta `/espacios` de `web/src/ui.jsx` permite sólo `ADMIN` y carga `web/src/LocationsAdmin.jsx`. Este componente utiliza `CascadeSelect`, `web/src/services.js` y estilos de `web/src/penpot.css` y `web/src/style.css`. Carga `GET /espacios/resumen`, crea y modifica sectores, edificios, pisos y salas; antes de retirar consulta conteos históricos mediante los cuatro endpoints de listado y confirma con los endpoints `DELETE` correspondientes.

Los esquemas Pydantic son `SectorIn/Patch`, `BuildingIn/Patch`, `FloorIn/Patch` y `RoomIn/Patch`. El backend consulta las tablas `sectores`, `edificios`, `pisos`, `salas` y `nodos`; el retiro también puede modificar nodos y, si se marca borrado, eliminar filas de `telemetria`, `telemetria_tiempo_incierto` y `alertas`. `retire_location` ejecuta la operación en una transacción. La API exige `ADMIN`, valida sesión por cookie y origen para mutaciones. No intervienen firmware, MQTT, Web Serial ni Telegram directamente; sí pueden verse afectadas sus referencias a salas y nodos.

El resumen administrativo ya evita cuatro solicitudes de lista al entrar. El recuento histórico se solicita sólo al abrir el diálogo de retiro. No se midieron tiempos reales ni se inspeccionó la página visualmente en esta revisión.

## Problemas observados en el código

1. `submit` y `remove` no bloquean envíos repetidos. Se puede cerrar un diálogo durante una petición y volver a iniciar la misma acción.
2. Los errores de guardar o retirar aparecen en el aviso general de la página, detrás del diálogo. `remove` cierra el diálogo si falla y pierde el contexto del retiro.
3. El diálogo de edición y el de retiro no tienen contención ni retorno de foco, cierre por Escape controlado, ni indicación del estado de guardado para lectores de pantalla.
4. El aviso de la tabla afirma que se conserva el historial, aunque el diálogo permite marcar `borrarHistorial`. Esta frase puede inducir a error en una acción irreversible.
5. La tabla prioriza el ID como primera columna y muestra acciones sólo con iconos y `title`; dificulta reconocer ubicaciones y usar la página en pantallas táctiles. Los selectores de ubicación y varias etiquetas usan tamaños de 9 a 11 px en CSS.
6. Después de cada mutación, `reload()` oculta la tabla completa y vuelve a consultar las cuatro listas. Puede sentirse lento aun cuando la operación terminó.
7. La búsqueda y las rutas jerárquicas resuelven nombres con `.find()` repetidos para cada fila; `CascadeSelect` calcula similitud de texto al buscar. Con muchos espacios aumenta el trabajo en el navegador. No hay evidencia de un problema medido hoy.
8. `GET /espacios/resumen` construye una respuesta con cuatro agregados JSON y varios conteos correlacionados. Conviene medir su tiempo y tamaño antes de cambiar SQL o introducir paginación.

## Mejoras propuestas

### Etapa 1: seguridad de uso y diseño

- Guardado y retiro con estado pendiente; deshabilitar botones, cierre y nuevo envío hasta recibir respuesta. Mostrar error y acción de reintento dentro del diálogo. Mantener los valores introducidos cuando falla el guardado.
- Diálogos con foco contenido, Escape y retorno al botón que los abrió. Mensajes de éxito/error anunciados de forma accesible.
- En la tabla, mostrar primero nombre y jerarquía, y dejar el ID como dato secundario copiable. Añadir nombre accesible a los botones de editar y retirar. Aumentar tamaño de letra, área táctil y foco visible en controles de Espacios, con CSS limitado a `.locationsAdmin`.
- Corregir el texto de retiro: explicar que, por defecto, conserva historial y desvincula nodos; si se marca borrado, indicar claramente qué datos desaparecerán. Solicitar una confirmación adicional específica para el borrado permanente. Mantener el valor seguro por defecto.
- Revisar junto con el usuario escritorio, tableta y móvil, incluyendo tablas con texto largo y diálogos de los cuatro tipos.

### Etapa 2: rendimiento sin alterar contratos

- Al editar una fila, actualizar la lista con la respuesta de la API cuando incluya los datos necesarios; para crear o retirar, refrescar la estructura sin esconder la tabla existente. Mostrar «Actualizando…» y conservar un botón de actualización manual.
- Crear mapas de nombres por ID con `useMemo` para filtros, jerarquías y filas. Evitar recalcular búsquedas difusas si no hay texto de búsqueda. Mantener `CascadeSelect` salvo que una medición señale un problema real.
- Medir tiempo y tamaño de `GET /espacios/resumen`, tiempo de render y respuesta al filtro con el volumen actual. Considerar índices, reescritura SQL o paginación sólo con evidencia y un plan aparte si cambian contratos de API.

### Etapa 3: validación y publicación

- Revisar por código permisos ADMIN, campos Pydantic, creación, edición, conteos previos al retiro y respuesta tras errores. Las pruebas de escritura se harán sólo con sectores/edificios/pisos/salas desechables, sin borrar historial productivo.
- Ejecutar build de frontend y verificaciones pertinentes del API si se modifica. Desplegar los tres ConfigMaps web del mismo build como una unidad; comprobar rollout, salud y correspondencia de todos los assets publicados. Registrar archivos, funciones, resultados y commit descriptivo en la bitácora. El usuario comprobará visualmente la página.

## Reversión antes de aplicar cambios

Antes de editar, crear una referencia Git del commit estable y respaldar fuera de Git los ConfigMaps web realmente publicados (`calidad-web-core`, `calidad-web-assets`, `calidad-web-main-js`) y el Deployment. Si se toca API, respaldar también `calidad-api-code` y el Deployment API. Verificar hashes y contexto `estudiante-kcortes` / namespace `student-kcortes`.

Si el resultado visual no convence, restaurar juntos los tres ConfigMaps web respaldados, reiniciar `calidad-web` y comprobar rollout, salud y hashes. Revertir el commit de Espacios de forma aislada en Git, sin reset destructivo. Si una etapa incluyó backend, restaurar también su ConfigMap y reiniciar API. Registrar la reversión en la bitácora.

Restaurar código o ConfigMaps no recupera espacios retirados ni mediciones/alertas borradas. Antes de cualquier prueba de retiro se usará información desechable; si se considerara borrar historial real, se necesitaría respaldo verificable de PostgreSQL y un procedimiento de restauración de datos específico. No se ejecutará borrado irreversible como parte de la validación visual.

## Compatibilidad y decisión pendiente

La primera etapa mantiene rutas, roles, formatos de respuesta y esquema de base de datos. Cambiar el contenido del mensaje de retiro y el orden visual de la tabla afecta la presentación, no los permisos. Optimizar SQL o cambiar la API requiere medición y revisión separada.

## Implementación y recuperación preparada

Se aplicaron cambios de interfaz en `web/src/LocationsAdmin.jsx` y CSS acotado a `.locationsAdmin` en `web/src/penpot.css`. Guardado y retiro bloquean duplicados y cierre durante la petición; los errores permanecen dentro del diálogo. Los diálogos nativos contienen el foco y lo devuelven al control inicial. La tabla permanece visible al refrescar, prioriza nombre y jerarquía, muestra el ID debajo y usa mapas por ID para el filtro. Borrar historial exige escribir exactamente el nombre de la ubicación. No se cambió backend, esquema, roles ni contratos HTTP.

Antes de editar se creó la etiqueta `respaldo/espacios-20261030` sobre `c482077`. Los tres ConfigMaps web y el Deployment anterior quedaron en `C:\Users\corte\.codex\backups\aira-espacios-20261030-antes`, con hashes y `Restaurar.ps1`. Se validaron sintaxis del script y ConfigMaps con `kubectl replace --dry-run=server`.

Para restaurar exactamente la web anterior:

```powershell
& 'C:\Users\corte\.codex\backups\aira-espacios-20261030-antes\Restaurar.ps1'
```

El script comprueba contexto y hashes, reemplaza juntos los tres ConfigMaps y reinicia web sólo después de completar los reemplazos. Después se comprobarán rollout, salud y hashes de los archivos publicados. Para revertir código se creará un commit que deshaga sólo Espacios.

Build Vite correcto; los tres ConfigMaps nuevos se reemplazaron y el rollout de `calidad-web` terminó. Los 45 archivos publicados coincidieron con `web/dist` por SHA-256 y `/api/healthz` respondió `ok`. No hubo operaciones sobre espacios reales ni medición de rendimiento; la revisión visual queda a cargo del usuario. Restaurar la interfaz no recupera datos históricos eliminados después.

## Segunda etapa visual para muchos espacios

Tras la observación del usuario sobre el crecimiento futuro, se añadieron filtros de sector, edificio y piso según la pestaña, búsqueda por nombre/ID/ruta jerárquica, contador visible y páginas de 20 resultados. Al cambiar de pestaña o filtro se vuelve a la primera página. En móvil las filas se presentan como tarjetas y las salas indican cuántos nodos activos tienen. Estos cambios son de `web/src/LocationsAdmin.jsx` y CSS limitado a Espacios en `web/src/penpot.css`.

La versión inmediatamente anterior a esta segunda etapa quedó etiquetada `respaldo/espacios-volumen-20261030` sobre `133d8e3`. Los tres ConfigMaps web y el Deployment de esa versión están en `C:\Users\corte\.codex\backups\aira-espacios-volumen-20261030-antes`, con hashes y `Restaurar.ps1`. Para volver sólo a esa versión visual:

```powershell
& 'C:\Users\corte\.codex\backups\aira-espacios-volumen-20261030-antes\Restaurar.ps1'
```

El reemplazo simulado de los tres ConfigMaps fue aceptado por Kubernetes. La nueva web compiló, su rollout terminó, los 45 archivos publicados coincidieron por SHA-256 y `/api/healthz` respondió `ok`. No se hicieron escrituras de espacios ni revisión visual por parte del asistente.

La paginación actual limita filas renderizadas, pero `GET /espacios/resumen` todavía entrega la estructura completa. Si el volumen futuro hace lenta la respuesta de API, se deberá medir tamaño y tiempo y planificar paginación del servidor por separado. La página administrativa de nodos es otro módulo; aquí sólo se muestra su conteo por sala.

## Tercera etapa: explorador visual combinado

Por solicitud del usuario se sustituyeron las pestañas y tablas de Espacios por un recorrido de sector → edificio → piso → sala → nodos. Sectores y edificios se presentan como tarjetas con conteos; pisos, salas y nodos usan filas compactas. La ruta jerárquica permite volver a cada nivel. Una búsqueda local filtra el nivel visible y la opción «Buscar en toda la estructura» muestra resultados con su ruta y permite abrirlos directamente. Ambos listados muestran hasta 20 resultados por página.

El botón Agregar usa el nivel visible y preselecciona la ubicación superior. Se conservaron los diálogos existentes para editar y retirar, incluidos sus controles de errores, bloqueo de operaciones duplicadas y confirmación adicional para borrar historial. En la sala se muestran nombre, ID y estado de los nodos asociados; la edición de dispositivos sigue en `/nodos/administrar`. `GET /nodos` se consulta sólo al entrar a una sala o iniciar una búsqueda general; el endpoint actual devuelve todos los nodos activos, por lo que un crecimiento grande requeriría medir respuesta y evaluar un filtro por sala en un cambio separado. No se añadieron dependencias ni se alteraron API, SQL, datos, rutas o permisos.

Antes de editar se etiquetó `dddca8a` como `respaldo/espacios-tarjetas-20261030`. Los tres ConfigMaps web publicados y el Deployment se respaldaron en `C:\Users\corte\.codex\backups\aira-espacios-tarjetas-20261030-antes`, junto con hashes y `Restaurar.ps1`. El reemplazo simulado de los ConfigMaps fue aceptado por Kubernetes. Para recuperar exactamente esa versión:

```powershell
& 'C:\Users\corte\.codex\backups\aira-espacios-tarjetas-20261030-antes\Restaurar.ps1'
```

Tras ejecutar el script, comprobar el rollout, la salud API y los hashes publicados. Crear un commit que revierta únicamente esta tercera etapa en Git, sin `reset` destructivo. La restauración de la web no revierte escrituras realizadas después sobre espacios o nodos.

El build Vite terminó correctamente, los tres ConfigMaps se reemplazaron como unidad y el rollout web concluyó. Los 45 archivos servidos coincidieron con `web/dist` por SHA-256 y `/api/healthz` respondió `ok`. No se realizaron mutaciones de datos ni revisión visual; la validación visual corresponde al usuario.
