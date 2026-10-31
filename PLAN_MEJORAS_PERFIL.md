# Mejoras de Mi perfil

## Alcance y perímetro

La ruta React `/perfil` muestra `ProfilePage` en `web/src/ui.jsx`. Lee los datos del usuario autenticado en la sesión, consulta `GET /edificios` para traducir las asignaciones y guarda con `PATCH /perfil` mediante `web/src/services.js`. El backend limita edificios al ámbito autorizado, permite consultar el perfil a ADMIN, ANALISTA y VIEWER, y actualiza solamente el usuario de la sesión. El cambio de contraseña verifica la contraseña actual y aplica el mínimo de 12 caracteres. GUEST no tiene acceso de escritura.

No se modifican API, roles, JWT, base de datos, permisos, rutas, dependencias ni manifiestos de Kubernetes. Los cambios de presentación no sustituyen las validaciones del backend.

## Mejoras aplicadas

- Se distingue información personal del bloque de seguridad.
- Nombre, correo de solo lectura y teléfono permanecen en el formulario de datos personales.
- Los campos de contraseña aparecen solo al elegir Cambiar contraseña; Cancelar cambio limpia los valores escritos.
- Guardar cambios y Descartar cambios aparecen cuando hay diferencias pendientes; descartar restaura los datos de sesión.
- Se conserva el permiso espacial informativo. ADMIN ve todos los espacios sin solicitar edificios; los demás roles mantienen la consulta de edificios asignados con carga, error y reintento visibles.
- Los estilos nuevos están limitados a Perfil y ajustan los formularios y acciones en móvil.

## Verificación y reversión

La compilación de Vite valida JSX, CSS y generación de assets. El despliegue sustituye los tres ConfigMaps web desde el mismo build; se debe confirmar rollout, salud de API y coincidencia SHA-256 de todos los assets publicados. No se cambian datos. La validación visual final corresponde al usuario.

Respaldo publicado anterior: `C:\Users\corte\.codex\backups\aira-perfil-20261030-antes`, con manifiestos JSON, hashes y `Restaurar.ps1`. Etiqueta Git previa: `respaldo/perfil-20261030`. Para restaurar la publicación, ejecutar el script del respaldo desde PowerShell con el contexto `estudiante-kcortes`; para revertir el código, revertir el commit de esta mejora después de revisar el estado local.
