# Mejoras de Mi perfil

## Alcance y perímetro

La ruta React `/perfil` muestra `ProfilePage` en `web/src/ui.jsx`. Lee los datos del usuario autenticado en la sesión, consulta `GET /edificios` para traducir las asignaciones y guarda con `PATCH /perfil` mediante `web/src/services.js`. El backend limita edificios al ámbito autorizado, permite consultar el perfil a ADMIN, ANALISTA y VIEWER, y actualiza solamente el usuario de la sesión. El cambio de contraseña verifica la contraseña actual; ahora exige entre 8 y 128 caracteres y confirmación coincidente. GUEST no tiene acceso de escritura.

No se modifican roles, JWT, base de datos, permisos efectivos, rutas, dependencias ni manifiestos de Kubernetes. El endpoint `PATCH /perfil` sí valida la confirmación de contraseña enviada por la interfaz.

## Mejoras aplicadas

- Se distingue información personal del bloque de seguridad.
- Nombre, correo de solo lectura y teléfono permanecen en el formulario de datos personales.
- Los campos de contraseña aparecen solo al elegir Cambiar contraseña; Cancelar cambio limpia los valores escritos.
- Guardar cambios y Descartar cambios aparecen cuando hay diferencias pendientes; descartar restaura los datos de sesión.
- Se conserva el permiso espacial informativo. ADMIN ve todos los espacios sin solicitar edificios; los demás roles mantienen la consulta de edificios asignados con carga, error y reintento visibles.
- Los estilos nuevos están limitados a Perfil y ajustan los formularios y acciones en móvil.

## Ajuste del cambio de contraseña

Por solicitud del usuario, el cambio de contraseña desde Perfil acepta entre 8 y 128 caracteres. Se repite la nueva contraseña y se muestran errores si no coincide; el servidor aplica la misma regla y compara la confirmación antes de modificar el hash. Cada uno de los tres campos de contraseña tiene un control de ojo minimalista e independiente. La creación y el restablecimiento administrativo de cuentas conservan su política vigente de 12 caracteres; no se alteran flujos ajenos a Perfil.

Se corrigió la duplicación visual del ojo en navegadores que añaden un control nativo a los campos de contraseña. El CSS de Perfil oculta solo ese control nativo y conserva el botón accesible de la aplicación. Respaldo web anterior al ajuste: `C:\Users\corte\.codex\backups\aira-perfil-ojo-20261031-antes`, etiqueta Git `respaldo/perfil-ojo-20261031`.

Este ajuste reduce de 12 a 8 caracteres el mínimo del flujo de Perfil. NIST SP 800-63B-4 indica un mínimo de 15 caracteres para contraseñas usadas como único factor y permite un mínimo de 8 cuando forman parte de autenticación multifactor; AIRA no tiene un segundo factor en este flujo. Se aplica el mínimo solicitado por el usuario y se deja explícita esta limitación de seguridad: [NIST SP 800-63B-4](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63b-4.pdf).

## Verificación y reversión

La compilación de Vite valida JSX, CSS y generación de assets; `py_compile` valida sintaxis de `api/main.py`. El despliegue sustituye el ConfigMap de API y los tres ConfigMaps web. En el ajuste de contraseña se verificaron ambos rollouts, salud de API y coincidencia SHA-256 de los 48 assets publicados; no se cambiaron datos. La validación visual final corresponde al usuario.

Respaldo publicado anterior: `C:\Users\corte\.codex\backups\aira-perfil-20261030-antes`, con ConfigMaps web/API, hashes y `Restaurar.ps1`. El respaldo de este ajuste está en `C:\Users\corte\.codex\backups\aira-perfil-clave-20261030-antes`; su script restaura los cuatro ConfigMaps y reinicia API y web. Etiqueta Git previa a este ajuste: `respaldo/perfil-clave-20261030`. Para revertir el código, revertir el commit de este ajuste después de revisar el estado local.
