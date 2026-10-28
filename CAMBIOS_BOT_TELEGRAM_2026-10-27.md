# Cambios del bot de Telegram — 27 de octubre de 2026

## Qué se hizo

Se aclararon los mensajes del bot para describir mediciones observadas sin dar a entender que un problema quedó solucionado definitivamente. Las reglas que crean y resuelven alertas en la base de datos no cambiaron.

## Cambios y funciones nuevas

- Una alerta nueva dice «Se detectó una condición que requiere atención». Cuando corresponde, informa que la condición volvió a aparecer después de una mejoría reciente.
- La primera ventana de mejoría produce un aviso «falta otra medición para confirmarlo». La segunda ventana consecutiva permite el mensaje «La condición dejó de aparecer en dos mediciones consecutivas».
- El mensaje de dos ventanas muestra el valor inicial y los valores y horas de ambas ventanas de mejoría.
- «Ver estado» distingue condiciones activas de mejorías pendientes; si falta la siguiente ventana válida, lo indica.
- Los avisos separan hora de medición y recepción y advierten si un dato llegó tarde o tiene hora futura.
- Avisos simultáneos de una sala se agrupan. El bot guarda los envíos por alerta y chat para evitar repeticiones tras reinicios.
- Se añadieron `telegram_aviso_control` y `telegram_avisos_enviados` para persistir el estado exclusivo del bot. Las migraciones están en `k8s/migrations/2026-10-27-telegram-deliveries.sql` y `k8s/migrations/2026-10-27-telegram-improvement.sql`.

## Límites

La confirmación requiere una segunda ventana válida exactamente cinco minutos después de la primera. Si falta, Telegram no anuncia una mejoría sostenida. Un envío a Telegram puede repetirse si el servicio termina justo después de enviarlo y antes de registrar la entrega en PostgreSQL.

La sesión web de 30 minutos de inactividad y su renovación fueron cambios locales previos incluidos en este estado del repositorio; su implementación está en `api/main.py` y `web/src/`.
