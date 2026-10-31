# Análisis de la página Telegram

Fecha: 2026-10-30. Base: `8065e1a`. Estado: análisis de código; sin cambios de aplicación ni mensajes enviados.

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
