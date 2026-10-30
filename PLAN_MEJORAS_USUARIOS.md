# Análisis y plan de mejoras de Usuarios

Fecha: 2026-10-30. Estado: plan autorizado; primer lote de interfaz implementado y desplegado, pendiente de revisión visual del usuario. El segundo lote de backend se realizará después de resolver esa revisión. Esta revisión no incluye inspección visual del navegador ni mediciones de red o renderizado. No se realizaron escrituras sobre cuentas reales.

## Perímetro verificado

La ruta `/usuarios`, protegida para ADMIN en `web/src/ui.jsx`, carga `PenpotUsers.jsx`. Este componente usa React, iconos Lucide, `ROLE_LABEL` y `api.users`, `api.buildings`, `api.createUser`, `api.patchUser` y `api.deleteUser` de `web/src/services.js`. Los estilos específicos están en `web/src/penpot.css` y dependen también de clases globales como panel, formGrid, tableScroll y botones.

El backend utiliza GET/POST `/usuarios`, PATCH/DELETE `/usuarios/{usuarioId}`, los esquemas `UserIn` y `UserPatch`, las tablas `usuarios`, `usuario_edificios` y `sesiones_usuario`, y el campo `assignedEdificios`. La sesión se obtiene por cookie; los endpoints exigen ADMIN y las mutaciones verifican origen. Edificios se consulta por GET `/edificios` sin conteos históricos desde el servicio frontend.

Las ediciones pueden afectar permisos por edificio, estado, credenciales y sesiones del usuario editado. El frontend también contiene una implementación anterior de usuarios en `ui.jsx`, pero la ruta activa usa `PenpotUsers`; los cambios deben concentrarse en la implementación activa. No intervienen firmware, Web Serial, tópicos MQTT ni certificados. La relación con Telegram es indirecta: sus consultas utilizan roles y permisos de las cuentas.

## Hallazgos confirmados

1. **Operaciones sin estado de guardado.** Crear, editar y eliminar no bloquean nuevos envíos mientras la petición está pendiente. Los diálogos se pueden cerrar durante una operación.
2. **Errores fuera del diálogo.** El aviso de error se representa en la página detrás del modal de creación. La eliminación cierra el diálogo incluso si falla, perdiendo el contexto de la acción.
3. **Guardado de permisos poco visible.** La selección múltiple de edificios guarda al perder foco. No hay confirmación clara de cambios pendientes y un error puede dejar la selección local diferente del servidor.
4. **Contraseña con prompt.** No hay formulario integrado, confirmación ni mensaje al introducir menos de 12 caracteres. El formulario de creación tampoco refleja todos los máximos del backend.
5. **Accesibilidad de diálogos incompleta.** No hay gestión explícita de foco, retorno al control de apertura, contención del tabulador, cierre con Escape ni bloqueo del scroll del fondo. El buscador depende de placeholder y los avisos no tienen región viva.
6. **CSS existente, con controles pequeños.** Hay estilos específicos y un breakpoint de 760 px. La tabla usa selectores de 11 px y notas de cuenta de 10 px. Los selectores múltiples nativos requieren revisar legibilidad y manejo táctil. No se afirma una rotura visual sin comprobarla.
7. **Recarga completa después de cada edición.** `reload()` vuelve a pedir cuentas y edificios y sustituye la tabla por el cargador. Las ubicaciones se consultan aunque no hayan cambiado.
8. **Cálculo repetido y crecimiento sin límite.** El conteo de administradores activos se recalcula para cada fila; GET `/usuarios` devuelve toda la lista y la tabla la representa completa. No hay evidencia medida de lentitud actual; el impacto crece con el número de cuentas.
9. **Actualización parcial posible en API.** `patch_user` revoca sesiones, actualiza campos y reemplaza asignaciones mediante operaciones/transacciones independientes. Si falla una asignación, los campos pueden haber cambiado. No hay manejo específico de claves foráneas/duplicados en este endpoint como sí existe en creación.
10. **Errores de validación poco legibles.** El servicio convierte directamente `detail` en un Error; una lista de errores de Pydantic no produce mensajes útiles para cada campo.

## Plan propuesto y orden

### 1. Fiabilidad y formularios

Añadir estado pendiente por operación y fila; bloquear envíos duplicados y cierre accidental mientras se guarda. Mostrar errores dentro del diálogo, conservar valores tras fallar y anunciar éxito/error de forma accesible. Reemplazar prompt por un diálogo de contraseña con validación visible y límites coherentes con la API.

Hacer atómica la edición de cuenta, revocación y asignaciones cuando formen una misma solicitud; validar edificios y devolver errores controlados. Mantener las protecciones de cuenta actual, último ADMIN y acceso exclusivo de ADMIN. Revisar validación de campos opcionales para rechazar valores nulos cuando la operación no los admite. No requiere migración de esquema.

### 2. Experiencia y diseño

Cambiar la asignación de edificios a un editor con selección clara y botones Guardar/Cancelar. Mostrar los edificios asignados de forma legible en la tabla; explicar acceso total para ADMIN y ausencia de edificios para otros roles. Presentar GUEST como acceso sin cuenta y no como rol asignable.

Revisar jerarquía, tamaños, espaciado, contraste, foco y controles táctiles. Comprobar tabla y diálogos a 360, 768 y 1440 px. Añadir filtro por estado, contador de resultados y acción para limpiar filtros. Conservar el lenguaje visual existente y usar CSS limitado a Usuarios para evitar regresiones en otros diálogos.

### 3. Rendimiento

Cargar edificios una vez y refrescarlos sólo cuando sea necesario. Tras editar, usar la respuesta del servidor para actualizar la fila; tras crear/eliminar, refrescar cuentas sin ocultar toda la tabla. Calcular una vez los conteos compartidos y evitar respuestas antiguas sobrescribiendo la vista.

Medir tamaño de respuesta, duración de GET `/usuarios` y `/edificios`, renderizado y tiempo de guardado. Añadir paginación/búsqueda en servidor sólo si las mediciones y volumen lo justifican; esto requeriría acordar el cambio del contrato de API. No añadir librerías ni caché genérica.

### 4. Validación y publicación

Verificar carga normal, vacíos, filtros, errores de red, validaciones, envío repetido, cancelar, navegación por teclado y tamaños de pantalla. Probar mutaciones con cuentas desechables y comprobar permisos de ADMIN/ANALISTA/VIEWER/GUEST, protección de cuenta actual y último ADMIN, y rollback si fallan edificios. No usar cuentas reales para pruebas destructivas.

Ejecutar sintaxis Python y build frontend. En Kubernetes, generar los tres ConfigMaps web del mismo build y reemplazar todos correctamente antes de reiniciar; comprobar rollout, salud y hashes de todos los assets. Registrar resultados y riesgos en la bitácora, crear commits descriptivos por archivo y solicitar autorización para push.

## Riesgos y compatibilidad

Los cambios de permisos deben seguir siendo decididos por la API. El reemplazo de guardado por blur por Guardar/Cancelar debe explicarse en la interfaz. Los estilos compartidos pueden afectar otras páginas y deben acotarse. La mejora transaccional debe conservar las respuestas y reglas actuales. No se propone modificar JWT, rutas, esquema de BD, firmware ni dependencias.

## Reversión obligatoria antes de implementar

La base de código actual es el commit `9e505c1`. Antes de editar se comprobarán los cambios locales y se conservarán los documentos o archivos ajenos al cambio. Se creará una referencia Git local de la base y una rama `codex/mejoras-usuarios`; los commits distinguirán interfaz y backend.

Antes del despliegue se guardará una copia del contenido real de los tres ConfigMaps web (`calidad-web-core`, `calidad-web-assets`, `calidad-web-main-js`) y del Deployment `calidad-web` en una carpeta de respaldo local fuera de Git. Si se modifica el backend, se hará lo mismo con `calidad-api-code` y `calidad-api`. Los respaldos se guardarán sin Secrets y con contexto, namespace, fecha y hashes. No basta con reconstruir desde Git: se conservarán los assets exactos que estaban publicados.

El primer lote será la interfaz de Usuarios: CSS acotado, formularios, estados pendientes, errores y actualización de filas. Después de los controles técnicos se publicará para la comprobación visual del usuario. Se ofrecerá una lista concreta de recorridos: buscar/filtrar, crear, editar edificios, cambiar contraseña, cancelar y abrir/cerrar diálogos en escritorio y móvil. No se avanzará a otras páginas hasta resolver la valoración del usuario.

Si el resultado no convence, se restaurarán juntos los tres ConfigMaps web desde el respaldo y se reiniciará `calidad-web`. Se comprobarán rollout, salud y hashes de todos los archivos publicados. `rollout undo` por sí solo no restaura ConfigMaps. El código se revertirá con un commit que deshaga exclusivamente el lote de Usuarios, conservando trabajos posteriores o ajenos; no se usará reset destructivo.

La mejora transaccional del backend se implementará y desplegará en un segundo lote aprobado. Si debe revertirse, se restaurará también `calidad-api-code` y se reiniciará API, verificando los endpoints afectados. No se prevén migraciones de base de datos.

Restaurar la interfaz o API no deshace cuentas creadas/eliminadas, contraseñas cambiadas, sesiones revocadas ni permisos guardados durante la revisión. Las pruebas de escritura usarán únicamente cuentas desechables identificadas; las comprobaciones visuales podrán realizarse sin confirmar operaciones sobre cuentas reales. Cualquier recuperación de datos se tratará por separado, sin restaurar globalmente la base productiva.

Cada lote y eventual reversión quedarán registrados en `BITACORA_CAMBIOS_KUBERNETES.md`, con archivos, propósito, validaciones, referencia de respaldo y commits. El push se realizará sólo cuando el usuario lo autorice.

## Respaldo preparado y primer lote publicado

- Base anterior: commit `9e505c1`, etiqueta local `respaldo/usuarios-20261030`.
- Rama de implementación: `codex/mejoras-usuarios`.
- Respaldo real del clúster: `C:\Users\corte\.codex\backups\aira-usuarios-20261030-antes`. Incluye los cuatro ConfigMaps de web/API, los dos Deployments, hashes de respaldo y `Restaurar.ps1`. No está en Git y no contiene Secrets.
- La sintaxis de `Restaurar.ps1` y la aceptación de los tres ConfigMaps web mediante `kubectl replace --dry-run=server` fueron verificadas. El script comprueba contexto y hashes antes de reemplazar; detiene la operación si falla un reemplazo y reinicia web después de completar los tres.

Para volver a la interfaz anterior:

```powershell
& 'C:\Users\corte\.codex\backups\aira-usuarios-20261030-antes\Restaurar.ps1'
```

Después se comprobarán los assets restaurados contra el contenido de los ConfigMaps de respaldo, los módulos de login/Usuarios y `/api/healthz`. No debe reconstruirse la versión antigua antes de restaurarla: el respaldo ya conserva los archivos exactos publicados. El parámetro `-IncludeApi` queda disponible para un eventual lote posterior de API; no es necesario para revertir este primer lote.

Primer lote: diálogos nativos con foco/modalidad, guardado explícito de edificios, formulario de contraseña con confirmación, bloqueo de operaciones duplicadas, errores dentro del diálogo, filtros de estado/resultados, tamaños de controles y CSS acotado. PATCH actualiza la fila con la respuesta de servidor; eliminar actualiza la lista local y crear refresca sólo cuentas. El botón Actualizar permite volver a consultar cuentas y edificios. Los errores 422 de Pydantic se muestran como campo y motivo en el servicio HTTP compartido.

Verificaciones: build Vite correcto; prueba HTTP simulada del servicio (422, PATCH, cookies y JSON) correcta; rollout web completo; 45 archivos comparados por SHA-256 sin diferencias; todos los assets respondieron por HTTP; salud del API `ok`. No se realizaron mutaciones de cuentas ni pruebas visuales. No se modificó el backend, la base de datos ni las dependencias. No se ha medido una mejora de tiempo real: la reducción de recargas está verificada por el flujo del código.

La revisión visual debe cubrir crear/cancelar, búsqueda y filtros, abrir/cerrar diálogos con teclado, comprobar que Guardar/Cancelar de edificios sea claro, comparar escritorio y móvil, y confirmar legibilidad de la tabla y sus acciones. Cualquier prueba que confirme una escritura debe usar una cuenta desechable. La mejora transaccional del backend y su validación con cuentas desechables quedan para el segundo lote.
