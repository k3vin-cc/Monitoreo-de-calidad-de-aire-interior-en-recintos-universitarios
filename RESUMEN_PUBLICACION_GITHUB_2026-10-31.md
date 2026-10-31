# Publicación de mejoras de AIRA en Kubernetes

Este registro describe los 24 commits locales posteriores a la base de `origin/main` revisada el 31 de octubre de 2026. Los cambios ya se publicaron y verificaron en el Kubernetes `estudiante-kcortes`; este envío sincroniza su código fuente y documentación con GitHub. Los archivos de contexto y trabajo temporal que figuran como no rastreados no forman parte del envío.

## Cambios por página

| Página | Cambios y propósito |
| --- | --- |
| Espacios | Exploración mediante tarjetas y ventana flotante por sector, edificio, piso, sala y nodo; búsqueda y paginación para crecer sin listas inmanejables; acceso directo a administrar el nodo seleccionado. |
| Nodos | Carga de ubicaciones compartida, pestañas montadas según uso, filtros y páginas, detalles técnicos, controles de operación y correcciones del scroll y de los selectores de sala. |
| Telegram | Vinculación de una cuenta por usuario, selección de salas autorizadas, pausas, desvinculación, historial de envíos y estados de guardado más claros; controles visuales compactos. |
| Histórico | Consulta de sala y período más simple, resultados paginados, resumen, exportación asociada a la consulta aplicada y gráficos con cinco variables y huecos de datos. |
| Mi perfil | Información personal y seguridad separadas, descarte de cambios, menor consulta para ADMIN, confirmación de contraseña y ojos para mostrar u ocultar cada campo. |

## Propósito de cada archivo enviado

| Archivo | Cambio y propósito |
| --- | --- |
| `api/main.py` | Refuerza y valida rutas de Telegram, fechas de Histórico y cambio de contraseña en Perfil; mantiene controles de rol y acceso a salas. |
| `web/src/LocationsAdmin.jsx` | Presenta la jerarquía de Espacios en tarjetas y explorador flotante; permite administrar el nodo específico. |
| `web/src/NodeInventory.jsx` | Mejora carga, edición, eliminación, confirmaciones y navegación al nodo indicado desde Espacios. |
| `web/src/NodeListControls.jsx` | Añade búsqueda, filtros y paginación compartidos para listados de Nodos. |
| `web/src/CascadeSelect.jsx` | Mantiene cerrados los selectores hasta que el usuario los abre y corrige su cierre. |
| `web/src/TelegramPage.jsx` | Reúne vinculación, preferencias, selección de salas, pausas, desvinculación e historial con estados de interfaz coherentes. |
| `web/src/HistoryPage.jsx` | Implementa consulta, resumen, páginas de resultados y exportación del rango aplicado. |
| `web/src/HistoryRoomPicker.jsx` | Permite buscar y elegir una sala en un único control, distinguiendo salas homónimas por ubicación. |
| `web/src/ui.jsx` | Integra las rutas y cambios de Nodos, Histórico, gráficos y Mi perfil. |
| `web/src/services.js` | Declara las llamadas HTTP de las funciones nuevas de Telegram. |
| `web/src/penpot.css` | Ajusta estilos de Espacios, Nodos, Telegram, Histórico y Perfil, incluidos estados y distribución móvil. |
| `PLAN_MEJORAS_ESPACIOS.md` | Registra análisis, etapas y reversión de Espacios. |
| `PLAN_MEJORAS_NODOS.md` | Registra análisis, alcance y reversión de Nodos. |
| `PLAN_MEJORAS_TELEGRAM.md` | Registra implementación, límites y reversión de Telegram. |
| `ANALISIS_COHERENCIA_TELEGRAM.md` | Explica decisiones de interacción y evita controles duplicados o ambiguos en Telegram. |
| `PLAN_MEJORAS_HISTORICO.md` | Registra análisis, alcance, límites y reversión de Histórico. |
| `PLAN_MEJORAS_PERFIL.md` | Registra cambios de Perfil, política de contraseña y reversión. |
| `BITACORA_CAMBIOS_KUBERNETES.md` | Conserva la secuencia de cambios, verificaciones y respaldos publicados. |

## Alcance de publicación

No se incluyen los ConfigMaps generados localmente, archivos de contexto no rastreados, credenciales ni respaldos externos al repositorio. Los detalles de cada etapa y sus procedimientos de restauración están en la bitácora y planes correspondientes. El mínimo de 8 caracteres en el cambio de contraseña de Perfil fue solicitado expresamente y su riesgo consta en `PLAN_MEJORAS_PERFIL.md`.
