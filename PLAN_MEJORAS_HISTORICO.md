# Análisis y plan de Histórico

## Simplificación del filtro

La revisión del usuario motivó sustituir búsqueda más select por `HistoryRoomPicker`: un campo permite buscar y seleccionar, mostrando ruta para distinguir salas homónimas. Incluye opciones cerradas inicialmente, flechas/Enter/Escape, cierre al salir y un máximo visible de 50 coincidencias con aviso para acotar. El período pasa a un select único (24 h, 7 días, 30 días, personalizado); sólo Personalizado muestra Desde/Hasta. Los rangos rápidos se calculan al consultar, no al abrir la página. La consulta aplicada y exportaciones conservan su coherencia. Inspiración: USWDS Combo box (https://designsystem.digital.gov/components/combo-box/), sin añadir librerías.

Archivos: `HistoryPage.jsx`, nuevo `HistoryRoomPicker.jsx` y CSS aislado en `penpot.css`. Prueba de render inicial con selección y salas homónimas correcta; build y rollout correctos, API `ok`. Teclado e interacción visual completos pendientes del usuario. Respaldo web en `C:\Users\corte\.codex\backups\aira-historico-filtro-20261030-antes`, etiqueta `respaldo/historico-filtro-20261030`; restaurar con su script y revertir el commit de esta etapa. Sin API, permisos ni datos modificados.

## Primera etapa implementada

Base de implementación `b639876`. `web/src/HistoryPage.jsx` separa la página y recibe gráfico/tabla compartidos. Consulta salas autorizadas una vez con búsqueda por ruta completa, rango inicial de 24 horas, accesos de 7/30 días y zona del navegador indicada. El detalle de sala transmite su ID a Histórico. Filtros y consulta aplicada tienen estados separados; exportar siempre usa esta última. Se distingue estado inicial, carga, error y ausencia de datos; se conserva la consulta previa al editar filtros o fallar una petición.

El resumen indica alcance y cantidad válida por variable; al alcanzar 10.000 filas se advierte que puede existir truncamiento. Tabla con páginas de 50 del subconjunto recibido. Exportación del rango completo con bloqueo de duplicados y estado pendiente. El gráfico compartido admite cinco variables incluso si la actual está vacía, muestra fecha/hora, elimina suavizado y separa huecos de más de cinco minutos y medio con nulos. El eje sigue siendo categórico y no representa distancias temporales proporcionales; una escala temporal real necesitaría diseño separado o soporte apropiado sin inventar precisión.

`api/main.py` valida desde/hasta en telemetría y exportación y rechaza mezcla de fechas con/sin zona. No cambian roles ni protección CSV. Python/Vite correctos; prueba aislada de rango invertido, zonas inconsistentes, rango válido y protección CSV correcta sin BD. No se midió latencia ni se ejecutaron descargas reales grandes. La revisión visual y de interacción corresponde al usuario.

Respaldo web/API con cuatro ConfigMaps, hashes y `Restaurar.ps1`: `C:\Users\corte\.codex\backups\aira-historico-20261030-antes`, etiqueta `respaldo/historico-20261030`. Ejecutar script para restaurar la publicación anterior y revertir commit de código de esta etapa. Sin cambios de esquema o datos.

Pendiente segunda etapa: páginas/total/resumen del rango completo en servidor, agregación temporal y descarga JSON sin parsear todo en memoria. La lista de salas también se descarga completa; búsqueda actual es local. El aviso de límite es conservador: 10.000 filas no prueba que haya filas adicionales, por eso dice «podrían».

Fecha: 2026-10-30. Base: `8ee89ed`. Sólo análisis estático; sin cambios de aplicación ni consultas de datos reales.

## Perímetro

`HistoryPage` en `web/src/ui.jsx`, `TelemetryChart`, `TelemetryTable`, `Select`, `saveBlob`, `services.js`, CSS de filtros/gráficos. `/historico` y endpoints `GET /salas/{salaId}/telemetria` y `/exportacion` admiten ADMIN/ANALISTA; el servidor valida acceso por edificio. Los filtros consultan sectores, edificios, pisos y salas. SQL lee `telemetria`; exportación usa cursor y transmisión progresiva, con protección de fórmulas CSV existente. El gráfico también se usa en detalle de sala, por lo que cambios compartidos deben conservarlo. La ingestión MQTT/firmware origina las ventanas pero no necesita cambios para mejorar esta página. Se revisó esquema versionado e índices; no se verificó producción ni se midieron tiempos.

## Hallazgos comprobados

1. Filtros editables y resultados no son la misma instantánea: cambiar fechas o sala puede dejar datos anteriores visibles; exportar utiliza los filtros nuevos. Exportación y gráfico pueden representar consultas distintas sin advertencia.
2. La API retorna las últimas 10.000 filas como máximo, sin total ni indicador de truncamiento. El resumen se calcula sólo sobre ese subconjunto y se titula resumen del período. A ventanas regulares de cinco minutos por sala, 10.000 equivalen aproximadamente a 34,7 días; no es un límite temporal garantizado.
3. TelemetryTable sólo muestra las primeras 80 de las filas recibidas, sin páginas ni aviso. El frontend invierte el orden descendente, por lo que la tabla muestra el inicio del subconjunto, no necesariamente lo más reciente.
4. TelemetryChart permite sólo CO₂, PM₂.₅ y temperatura; si CO₂ no tiene valores retorna un estado vacío antes de mostrar las pestañas, incluso si otras variables tienen mediciones. Omite PM₁₀ y humedad, aunque figuran en tabla y resumen.
5. El gráfico etiqueta sólo horas/minutos, ambiguos en rangos de varios días; elimina filas nulas, pudiendo conectar mediciones a través de intervalos sin datos. La curva suavizada puede sugerir valores no observados.
6. No hay validación desde<=hasta en telemetría/exportación, ni rango inicial acotado. El usuario puede consultar o descargar todo el historial sin prever el tamaño. Los datetime-local se convierten usando zona del navegador sin mostrarla explícitamente.
7. Selectores dependientes y consultas no cancelan ni descartan respuestas antiguas. Cambiar rápido sector/sala puede mezclar opciones o resultados de solicitudes distintas. El estado vacío aparece antes de consultar y también en errores/rangos sin datos, confundiendo situaciones.
8. Las ubicaciones usan selects nativos sin búsqueda. Para muchas salas obligan a recorrer toda la jerarquía. El enlace desde detalle de sala no transmite la sala a Histórico.
9. Se puede iniciar más de una exportación, sin progreso ni estado pendiente propio. Aunque servidor transmite, `request` convierte JSON a objetos y CSV a Blob; el navegador termina almacenando la descarga completa y reserializa JSON. Exportar rangos grandes puede consumir memoria considerable.
10. El resumen no indica cantidad válida por variable, cobertura, huecos o calidad parcial; promedios con distinta cantidad de mediciones parecen comparables. Los datos sin hora verificable no aparecen en la consulta: no deben presentarse como ausencia de mediciones sin explicar el alcance.

## Propuesta unificada

Flujo: elegir sala → elegir período → Consultar → revisar la consulta aplicada → exportar esa misma consulta. Sala con búsqueda por nombre y ruta, filtros jerárquicos opcionales. Accesos rápidos de 24 horas, 7 días y 30 días; fechas personalizadas con zona horaria indicada. Cargar sala de origen si se llega desde su detalle.

Mantener separado borrador de filtros y consulta aplicada. Al editar, avisar «Filtros modificados; consulta para actualizar». Gráfico, resumen, tabla y exportación se vinculan a la consulta aplicada, con nombre/ruta y rango visibles una sola vez. Estado inicial, cargando, fallo y sin resultados deben diferenciarse.

Gráfico de una variable a la vez con las cinco variables, unidades y fecha/hora claras. Permitir cambiar variable aunque la actual no tenga datos. Marcar huecos y conservar nulos; evitar suavizado que sugiera valores interpolados. Tabla paginada con contador visible y calidad; resumen con número de valores válidos y alcance real.

Primera etapa: corregir coherencia, fechas, carreras de solicitudes y estados; mejorar selección de sala, períodos y tabla. Cambios mínimos en gráficos compartidos con revisión del detalle de sala. Si se alcanza el límite actual, mostrar aviso y no afirmar que el resumen representa todo el período. Exportación completa diferenciada del subconjunto visible.

Segunda etapa: endpoint de consulta con metadatos de total/truncamiento y páginas en servidor; resumen calculado en SQL sobre el rango completo. Para gráficos extensos evaluar agregación temporal explícita, manteniendo extremos y explicando resolución. No confundir promedio agregado con ventanas originales. Validar permisos y rango en cada petición y medir consulta antes de proponer índices. La exportación conserva todas las filas del rango y necesita flujo de descarga que evite parsear y reserializar JSON completo en memoria.

## Verificación y reversión

Casos: ADMIN y ANALISTA autorizado/no autorizado; VIEWER/GUEST rechazados; dos salas homónimas, cambios rápidos de ubicación, rango invertido, CO₂ vacío con otra variable presente, huecos temporales, cambio de filtros sin consultar, límite 10.000 y páginas de tabla, exportación CSV/JSON. Verificar fechas alrededor de cambios horarios y conservar protección CSV. Medir tamaño/tiempo/render con datos simulados y volumen real sin escrituras.

Antes de implementar respaldar ConfigMaps web y API, Deployments y hashes; crear etiqueta Git y script de restauración validado. Publicar los tres ConfigMaps web del mismo build y API si cambia. Comprobar rollout, salud y assets. Registrar archivos/métodos y resultados en bitácora; revisión visual del usuario y commit descriptivo sin push. Sin cambios de esquema previstos en primera etapa.
