# Revisión de coherencia funcional de Telegram

## Implementación aplicada

Sobre `4f73897`: TelegramPage descarta respuestas de vínculo anteriores a escrituras; invalida consultas de historial al cambiar vínculo y limpia su contenido local. El reloj se actualiza continuamente para evaluar pausas y códigos. Las suscripciones visibles usan la lista guardada, por lo que desmarcar no oculta la fila antes de guardar. Los estados locales se describen como «Se añadirá/quitará al guardar», sin repetir condiciones globales en cada sala. Se agregó Cancelar cambios y recuperación explícita de 409 con confirmación antes de descartar el borrador.

Las pausas individuales aparecen fuera de la etiqueta de selección e indican que se aplican inmediatamente. Seleccionar todos los resultados sólo aparece con más de una página; quitar se limita a la página visible. El historial carga al abrirse y usa textos legibles. Se eliminó código de confirmación de revinculación sin acceso y el botón permanente de comprobar vínculo: sólo aparece con código pendiente. API devuelve fecha de vinculación y cuatro últimos caracteres del chat propio para identificar una cuenta sin username. Los estilos de Telegram se consolidaron en un bloque, con casillas aisladas y un pie único de guardado.

Archivos: `web/src/TelegramPage.jsx`, `web/src/penpot.css`, `api/main.py`. Sin esquema, dependencias ni reglas de generación de alertas nuevas. Respaldo: `C:\Users\corte\.codex\backups\aira-telegram-coherencia-20261030-antes`, etiqueta `respaldo/telegram-coherencia-20261030`; su `Restaurar.ps1` restaura web/API. Revertir código por commit aislado; restaurar la aplicación no revierte preferencias ya guardadas.

Python y Vite compilaron; la prueba con BD simulada verificó forma de preferencias, referencia parcial y rechazo GUEST. Pruebas visuales y de carrera completas en navegador pendientes del usuario. Este lote no añade paginación servidor del catálogo ni un protocolo de versionado compartido con todos los escritores del bot: las limitaciones de escala/concurrencia descritas abajo siguen pendientes. No se enviaron mensajes ni se probaron escrituras reales.

Fecha: 2026-10-30. Base: `0be383a`. Alcance: análisis estático de TelegramPage, servicios, CSS, endpoints y manejadores de vinculación/preferencias del bot. No se modificó la aplicación ni se enviaron mensajes.

## Modelo que debe entender el usuario

Una cuenta AIRA tiene como máximo una cuenta/chat privado de Telegram vinculado. Telegram Bot API no identifica el teléfono físico ni sus sesiones; mostrar una cuenta no acredita un único dispositivo físico. Los permisos determinan qué salas se pueden consultar; las suscripciones determinan de cuáles se reciben avisos. ADMIN puede consultar todas las salas; ANALISTA y VIEWER se limitan a sus edificios autorizados. Los avisos se configuran por sala, no por nodo.

Una sala es elegible para recibir avisos cuando el vínculo está confirmado, el interruptor global guardado está activo, la suscripción está guardada, no hay pausa vigente y el usuario conserva autorización. Esto no garantiza entrega ni que exista una alerta nueva. La interfaz debe distinguir configuración guardada de cambios locales.

## Problemas concretos

- La cuenta no requiere un panel de acciones permanente. Actualizar vínculo es útil durante una vinculación pendiente, pero aporta poco una vez confirmada. Sigue existiendo código de confirmación de revinculación sin un acceso visible que lo active.
- El vínculo sólo muestra username cuando existe; sin él, la identidad queda ambigua. La API dispone de vinculadoEn y chatId en BD, pero no los entrega en preferencias. Puede exponer fecha y referencia de cuenta propia de forma controlada, sin inventar teléfono o modelo de dispositivo.
- La selección y el interruptor se guardan con Guardar; pausas y desvinculación son inmediatas. La página no comunica esa diferencia de forma uniforme. Las pausas sólo por grupo obligan a filtrar hasta una sala para una acción individual.
- La opción de mostrar seleccionadas usa el borrador actual; desmarcar una sala la hace desaparecer. No equivale a una vista de suscripciones guardadas. Es preferible una vista estable de Todas/Con avisos con semántica explícita.
- Cada fila repite falta de vínculo o interruptor global desactivado y añade otro texto de pausa. El aviso global debe aparecer una vez, y cada fila debe reservar su estado para suscripción o pausa propia. «Avisos habilitados» calculado con borrador puede anticipar un resultado todavía no guardado.
- Página, resultados y grupos se tratan juntos sin explicar si hay selección total/parcial. Con pocos resultados, seleccionar página y resultados son la misma acción. Quitar resultados puede afectar mucho más que lo visible. El alcance debe verse en el propio texto y confirmarse en cambios amplios.
- Historial exige abrir y luego Consultar, dos acciones para una misma intención. Los tipos confirmada/mejoria/resuelta se muestran como nombres internos. La lista no muestra la ruta completa ni ofrece filtro por sala/fecha.
- No hay salida cómoda tras conflicto 409: Sincronizar fue retirado y Actualizar vínculo no recarga selección/pausas. Deshacer vuelve al estado local antiguo. Se necesita una recuperación explícita que preserve el borrador hasta decidir.
- La consulta de vínculo puede terminar después de un guardado y reemplazar su estado con una respuesta antigua. No se descartan respuestas obsoletas. Generar/desvincular no limpia deliveries ya cargadas, dejando en pantalla datos de un vínculo anterior. Desvincular mientras existe una consulta pendiente también puede quedar representado incorrectamente.
- El vencimiento actualiza reloj sólo cuando existe código. Las pausas pueden seguir mostrándose vigentes después de expirar; el texto de fecha se muestra si existe la clave, aunque haya pasado. Se necesita evaluar el vencimiento de forma consistente.
- CSS contiene varias redefiniciones de los mismos selectores acumuladas por correcciones. La regla general de formulario llegó a estirar checkboxes. Consolidar únicamente estilos de Telegram y comprobar tamaños calculados en escritorio/móvil.
- Carga completa de salas y filtrado local, validación SQL individual por sala y selecciones masivas sin límite acorde a pausas (1000) no escalan de manera uniforme. El historial ya pagina en servidor. El catálogo debe evolucionar a consultas acotadas cuando se implemente el crecimiento; no hay mediciones reales en esta revisión.
- Guardar diferencias preserva cambios ajenos sobre otras salas, pero no resuelve ediciones contradictorias sobre la misma sala ni cambios de vínculo. El bloqueo del interruptor no cubre todos los escritores del bot. Primera preferencia sin fila tampoco tiene un bloqueo existente que serialice creación. Requiere una estrategia de concurrencia compartida y pruebas.
- La clave primaria por usuario y chatId único del esquema versionado ya limitan cuentas; falta manejar el conflicto de un chat ya asociado con un mensaje comprensible en el bot. No se verificaron restricciones productivas durante esta revisión.

## Propuesta única de interfaz

1. Encabezado compacto: Telegram, estado de cuenta y nombre/referencia propia con fecha de vinculación. Si no hay vínculo, acción Conectar y pasos sólo durante ese proceso. Si lo hay, Cambiar cuenta dentro de un menú con confirmación y Desvincular como acción secundaria.
2. Un interruptor global con texto «Recibir avisos» y una única explicación contextual: desconectado, apagado o activo. Debe estar claro que cambiarlo requiere Guardar, como la selección de salas.
3. Lista de salas como contenido principal: búsqueda primero, filtro de ubicación opcional y vistas Todas/Con avisos. Ruta en texto secundario. Una casilla por sala para la suscripción; estado Pausada con vencimiento sólo cuando aplica. Pausar/reanudar en acción individual, indicando aplicación inmediata.
4. Selección de página mediante checkbox de cabecera con estado parcial. «Seleccionar los N resultados» aparece sólo cuando supera la página. Acciones de grupo aparecen al seleccionar un alcance explícito. No usar «mis salas» para mezclar permisos, borrador y suscripción.
5. Pie único: número de cambios y Guardar; Cancelar cambios sólo si existe borrador. Conflicto ofrece revisar cambios externos o recargar con confirmación. Filtros no guardan ni alteran selecciones.
6. Historial secundario: abrir carga la primera página; nombres legibles de tipos y estado vacío claro. Cambiar o quitar vínculo limpia el historial local. No afirmar lectura o entrega garantizada.

## Orden de corrección y aceptación

Primero resolver coherencia de estados y respuestas: borrador vs guardado, recuperación 409, consultas obsoletas, limpieza de historial y vencimiento de pausas. Después reconstruir una sola disposición y consolidar CSS. Finalmente extender identidad de cuenta, acciones individuales y paginación de salas con autorización en servidor. Cada cambio estructural necesita plan aprobado, respaldo y commit aislado según contrato.

Comprobar cuenta sin vínculo, vinculada sin username, avisos apagados, cero salas autorizadas, dos salas homónimas en edificios distintos, cambio de filtros con borrador, pausa que expira, dos pestañas editando, desvinculación durante consulta pendiente, pérdida de permiso y volumen simulado de al menos varias páginas. Verificar que ninguna selección del usuario amplíe el ámbito autorizado. No validar acciones irreversibles con información real.
