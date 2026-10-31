# Análisis de la página Telegram

## Funciones implementadas sobre `3ae3598`

La página incorpora filtros jerárquicos por IDs de sector/edificio/piso, vista de suscripciones/selección actual, selección de página o resultados, eliminación por resultados y deshacer cambios locales. Las acciones indican alcance y no abarcan salas futuras. Cada sala muestra nodos activos y estado efectivo de vínculo, activación y pausa. Se añadieron pausas/reanudación de 1/24 horas por grupo de suscripciones guardadas y desvinculación con confirmación. Pausar grupos requiere guardar antes los cambios locales y admite hasta 1000 IDs por solicitud. Sincronizar preferencias se habilita cuando no hay cambios locales.

`TelegramPreferencesIn` admite selección base e interruptor base. El PUT aplica sólo altas/bajas respecto de esa base, realiza la inserción por conjunto y rechaza con 409 un cambio concurrente del interruptor global. Esto preserva suscripciones ajenas a la edición, pero no resuelve conflictos contradictorios sobre la misma sala ni constituye versionado completo del bot. La validación de acceso por sala sigue usando la regla existente.

Nuevas rutas: `PUT /telegram/pausas`, `DELETE /telegram/vinculo` y `GET /telegram/envios?pagina=…`, todas personales y con rechazo de GUEST. El historial devuelve páginas de 20 éxitos del chat actualmente vinculado y edificios autorizados; no registra fallos ni confirma lectura. No hay migraciones ni dependencias nuevas. Backend modificado en `api/main.py`; frontend en `TelegramPage.jsx`, `services.js` y `penpot.css`.

Respaldo de cuatro ConfigMaps y script con hashes: `C:\Users\corte\.codex\backups\aira-telegram-funciones-20261030-antes`, etiqueta `respaldo/telegram-funciones-20261030`. Ejecutar su `Restaurar.ps1` para volver a web/API anteriores y revertir el commit de código. Restaurar la aplicación no revierte desvinculaciones, suscripciones ni pausas guardadas.

Pruebas con BD simulada verificaron altas/bajas por diferencias, conflicto de interruptor, duraciones y rechazo de invitado. Python compiló y Vite terminó. La revisión visual y las operaciones reales de vinculación/pausa quedan a cargo del usuario. No se enviaron mensajes ni se alteraron preferencias reales durante las pruebas.

Pendientes explícitos del plan de crecimiento: paginar en servidor el catálogo completo de salas y evitar la validación individual con consultas por conjunto; registrar fallos/reintentos persistentes; definir horarios, resúmenes y reglas de salas futuras. Estas últimas requieren decisiones funcionales y migraciones, y no se habilitan implícitamente. No se ha medido carga real.

## Análisis funcional para crecimiento — 2026-10-30

Revisión ampliada sobre `b063b34`: página, servicios, endpoints de preferencias, suscripciones/pausas del bot, envíos y SQL versionado en `contenido/base de datos/schema_timescaledb.sql` y migraciones. Sólo análisis estático; no se verificó el esquema productivo ni se midió carga. El esquema versionado ya define unicidad de `chatId` e índice por sala; no se debe proponer duplicarlos sin comparar producción.

### Funciones prioritarias

1. Explorar sectores → edificios → pisos → salas con selección por grupo, estado parcial y contadores. Mantener búsqueda general y vista «Mis suscripciones». Los nodos serían contexto operativo dentro de una sala: el modelo actual suscribe salas, por lo que incluir o reemplazar un nodo no debe cambiar silenciosamente qué ubicación se vigila.
2. Selección masiva explícita: seleccionar página, resultados filtrados o todas las salas autorizadas del grupo. Mostrar el alcance antes de guardar y permitir deshacer cambios locales. La primera versión debe seleccionar salas existentes; suscripción automática a futuras salas exige reglas persistentes nuevas y decisiones sobre excepciones y pérdida de permisos.
3. Pausar/reanudar por sala o grupo desde la web, con vencimiento visible. El bot ya ofrece pausas de una y 24 horas mediante `pausadoHasta`; reutilizar esa regla con endpoints autorizados. Distinguir vínculo, interruptor global, suscripción y pausa para explicar por qué una sala no enviaría avisos.
4. Desvincular con confirmación y cancelación de códigos pendientes; después mostrar un estado verificable. Hoy sólo existe generación/revinculación. Añadir acceso al bot usando un nombre público verificado, nunca inventado. Una prueba de mensaje sería una acción explícita del usuario, limitada en frecuencia y registrada sin contenido sensible.
5. Historial personal de intentos de aviso, con fecha, sala, tipo y resultado. `telegram_avisos_enviados` registra éxitos por alerta/chat/tipo, pero no todos los fallos ni una garantía de lectura por el destinatario. Registrar fallos sanitizados y reintentos antes de prometer trazabilidad completa. ADMIN podría ver salud del servicio; cada usuario sólo sus entregas autorizadas.

### Problemas de escala y coherencia

- La paginación es local: se descargan todas las salas y suscripciones. El guardado valida cada sala por separado y hace una inserción por selección, por lo que aumenta el número de consultas. Medir y evolucionar a búsqueda/páginas en servidor y validación/escritura por conjuntos, manteniendo autorización y transacción.
- PUT reemplaza la selección completa y no controla versión. Una pestaña antigua puede borrar suscripciones cambiadas desde el bot o desde otra pestaña. Añadir control de concurrencia o actualizaciones explícitas por diferencias y respuesta 409 para conflictos; mostrar cómo recargar o revisar los cambios.
- El refresco web sólo actualiza el vínculo, no la lista ni pausas. Debe detectar cambios externos sin sobrescribir edición local. Al guardar, usar una instantánea consistente; el estado de vínculo y avisos también debe evitar carreras entre consultas y mutaciones.
- Los avisos se agrupan por sala/ventana, pero no existe configuración de resumen entre salas, horario silencioso o severidad mínima por usuario. Son opciones posteriores con reglas explícitas; no cambiar detección ni resolución de alertas para reducir mensajes. Si se crean alertas operativas de nodo desconectado, definir umbral y recuperación aparte de alertas ambientales.
- El bot procesa avisos y consultas en el mismo ciclo de polling y envía a destinatarios en secuencia; mayor volumen puede retrasar la interacción. Medir duración, errores y pendientes; preparar envío con límite de concurrencia, tratamiento de rechazo temporal y reintentos persistentes si la evidencia lo exige. Persistir el offset de actualizaciones para evitar reprocesar tras reinicio. No introducir infraestructura nueva sin necesidad medida.

### Entrega recomendada

Lote 1: navegación jerárquica, Mis suscripciones, selección masiva de salas actuales, resumen de estado efectivo y protección de cambios locales. Lote 2: pausas web, desvinculación y control de concurrencia con el bot. Lote 3: paginación/operaciones por conjuntos en servidor y trazabilidad de envíos. Lote 4: reglas para futuras salas, horarios y resúmenes sólo tras definir su semántica. Cada lote requiere respaldo, revisión de permisos, pruebas con volumen simulado y aprobación previa de cambios estructurales; no se modificó la aplicación durante este análisis.

Fecha: 2026-10-30. Base: `8065e1a`. Estado: análisis de código; sin cambios de aplicación ni mensajes enviados.

## Implementación autorizada

Aplicada sobre `d053b39`: `TelegramPage` se extrajo de `ui.jsx` a `web/src/TelegramPage.jsx`, cargado de forma diferida. Incluye comando copiable, vencimiento real, consulta de vínculo cada cinco segundos mientras el código está vigente, actualización manual y confirmación explícita de revinculación. Los controles de generación y guardado bloquean duplicados; errores y cambios sin guardar permanecen visibles. La búsqueda por sala/jerarquía y páginas de 20 mantienen selecciones. El catálogo de salas conserva la autorización del endpoint existente. La disponibilidad anunciada del bot sigue significando configuración presente, no prueba de conectividad.

En `api/main.py` se añadió `TelegramPreferencesIn` con booleanos e IDs estrictos; se deduplican salas y se conserva validación de acceso. El GET filtra suscripciones por edificios autorizados y ubicaciones activas sin borrar datos. Generar o completar la revinculación desactiva avisos para coincidir con el mensaje del bot. Los códigos llevan `Cache-Control: no-store`; la generación rechaza otro código durante 30 segundos por usuario mediante su vencimiento almacenado. Esta comprobación no constituye un límite distribuido atómico frente a solicitudes simultáneas; no se añadieron índices ni restricciones de unicidad. Esas mejoras requieren revisar concurrencia y datos antes de una migración.

Respaldo en `C:\Users\corte\.codex\backups\aira-telegram-20261030-antes`, etiqueta `respaldo/telegram-20261030`, con los cuatro ConfigMaps (tres web y API), ambos Deployments, hashes y `Restaurar.ps1`. Reemplazo simulado aceptado. Restaurar con ese script y comprobar rollout y salud; revertir este commit de código por separado. La restauración no revierte vínculos o preferencias guardadas.

Python compiló y Vite terminó correctamente. Prueba aislada en runtime API verificó rechazo de booleanos ambiguos y GUEST en los tres endpoints sin tocar BD. Ambos rollouts completaron, la salud respondió `ok` y los 46 archivos web coincidieron por SHA-256. No se enviaron mensajes ni se generaron códigos reales. La vinculación completa, permisos por salas con cuentas reales y presentación móvil/escritorio quedan pendientes; el usuario hará la validación visual.

## Perímetro

`TelegramPage` en `web/src/ui.jsx` usa `services.js`, `style.css`, `GET /telegram/preferencias`, `POST /telegram/vinculo`, `PUT /telegram/preferencias` y `GET /salas`. La ruta web admite ADMIN, ANALISTA y VIEWER; los endpoints personales rechazan GUEST. Las preferencias usan `telegram_vinculos` y `telegram_preferencias_salas`; el bot revisa usuarios activos y ámbito por edificios y consulta salas/estados/historial. Los envíos usan Telegram Bot API desde el backend, con token en configuración. La vinculación ocurre en chat privado mediante `/start CODIGO`; el código vence en diez minutos y se consume al vincular. Se revisaron también el manejador de mensajes, consultas de acceso, documentación del bot y script de pruebas existente. No se probó el servicio externo, no se inspeccionaron secretos ni se midieron tiempos.

## Hallazgos

1. Generar un código pone `chatVinculado=FALSE` también en cuentas ya vinculadas. La página ofrece ese botón sin advertir que interrumpe el vínculo actual y, con ello, los avisos. Conviene convertirlo en una acción explícita de revinculación con confirmación, conservando la regla existente hasta aprobar cualquier cambio de backend.
2. El frontend ignora `expiraEn` y siempre indica «Expira en 10 minutos», aunque pase el tiempo. No ofrece copiar el comando `/start CODIGO`, ni confirma desde la web que la vinculación se completó. El backend exige ese comando; el texto web sólo pide enviar el código al bot. No hay nombre público del bot en la respuesta para construir un enlace verificado.
3. `link` y `save` no bloquean duplicados. Generar códigos repetidos invalida el anterior; guardar y vincular simultáneamente puede sobrescribir el estado visible. `reload` oculta toda la pantalla y reinicia selecciones locales. Guardar ignora la respuesta actualizada del servidor.
4. La carga inicial hace dos consultas en paralelo, lo que ya es adecuado. Al generar código vuelve a pedir ambas listas aunque sólo cambió el vínculo. Si falla la carga, se presenta el formulario con valores iniciales vacíos y error al final, pudiendo confundirse con preferencias realmente vacías.
5. Las salas se muestran sólo por nombre en una lista de altura máxima de 250 px con scroll, sin búsqueda, jerarquía, páginas ni contador de seleccionadas. Los cambios no guardados no están indicados. Las pausas se muestran, pero la web no tiene acciones para gestionarlas; el bot sí dispone de controles.
6. `PUT /telegram/preferencias` usa un diccionario libre y convierte `avisosActivos` con `bool(...)`; un texto como `"false"` se interpreta como verdadero. Valida tipos de la lista y acceso por sala, pero necesita un esquema Pydantic explícito para rechazar valores ambiguos. Cambiar validación requiere pruebas del cliente y del contrato.
7. `GET /telegram/preferencias` devuelve IDs y pausas de todas las suscripciones almacenadas sin volver a filtrar su ámbito actual. Si se retiró un permiso, puede devolver referencias antiguas y un guardado posterior puede fallar por esas salas. Revisar filtrado y política de limpieza sin eliminar suscripciones silenciosamente.
8. El mensaje de vinculación del bot afirma que los avisos quedan desactivados, pero al revincular la sentencia de actualización no fuerza `avisosActivos=FALSE`. Hay una inconsistencia que debe resolverse con una regla explícita y pruebas. La presencia de token (`botActivo`) tampoco prueba disponibilidad real del bot.

## Plan recomendado

Primera etapa: mejorar la interfaz con dos bloques claros, estado de vínculo y preferencias. Mostrar instrucciones exactas y botón Copiar comando, vencimiento basado en `expiraEn`, acción explícita de actualizar estado y consulta temporal sólo mientras se espera la vinculación. Al detectar vínculo confirmado, retirar el código de pantalla. No guardar códigos en almacenamiento del navegador ni logs. Generar código en una cuenta vinculada requerirá confirmación explicando el efecto actual.

Añadir estados pendientes separados, bloqueo de duplicados, errores próximos al control y aviso de cambios sin guardar. Usar la respuesta de guardado para sincronizar la pantalla. Separar error de carga de una lista realmente vacía y refrescar el vínculo sin descartar preferencias locales. Mantener el listado visible al actualizar.

Para salas, mostrar sector/edificio/piso/nombre, búsqueda, contador de seleccionadas y paginación sin scroll vertical corto. Conservar selecciones al filtrar o cambiar de página. Mostrar pausas activas y explicar cómo gestionarlas en el bot; una gestión web de pausas requeriría un endpoint nuevo y plan separado. Adaptar controles y mensajes a móvil y teclado con CSS acotado a Telegram.

Segunda etapa: definir esquema Pydantic para preferencias y probar booleanos, duplicados y salas sin acceso; filtrar preferencias devueltas conforme al ámbito actual. Acordar y aplicar una regla consistente para avisos tras revincular. Revisar unicidad y concurrencia del código/chat antes de proponer restricciones nuevas. Añadir `Cache-Control: no-store` a respuestas con códigos y comprobar límites de generación en la protección existente. No asumir que el bot está operativo sólo por existir configuración.

## Validación y reversión

Probar ADMIN, ANALISTA y VIEWER con salas permitidas y no permitidas; GUEST debe recibir rechazo. Probar carga fallida, vencimiento, generación repetida, cambio de permisos, revinculación, selección entre páginas y errores de guardado. Usar simulación para el flujo del bot; una vinculación real necesita cuenta de pruebas y autorización para enviar mensajes. El script existente incluye lecturas de BD y una aserción de mensaje que debe revisarse contra la redacción actual antes de usarlo como gate.

Antes de implementar, etiquetar el commit estable y respaldar los tres ConfigMaps web y Deployment con hashes y script validado. Si se aplica la segunda etapa, respaldar también ConfigMap y Deployment API. Verificar build, rollout, salud y assets; registrar resultados en bitácora. La revisión visual corresponde al usuario. Restaurar archivos no recupera automáticamente vínculos o preferencias modificados ni mensajes enviados. Mantener cada etapa en commits aislados, sin push automático.
