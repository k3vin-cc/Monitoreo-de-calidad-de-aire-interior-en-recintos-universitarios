# Código fuente de la interfaz

`main.jsx` monta React, Router, Chart.js y estilos. `ui.jsx` define navegación, pantallas y parte del flujo Web Serial. `services.js` concentra el acceso REST, sesión y WebSocket; `domain.js` reúne etiquetas, formatos y reglas de presentación. `LocationsAdmin.jsx` y `NodeInventory.jsx` administran lugares/nodos; `CascadeSelect.jsx` y `SearchableSelect.jsx` implementan selección filtrable en cascada. Los componentes `Penpot*.jsx` y `penpot.css` trasladan elementos del diseño visual; `style.css` contiene estilos generales.

Para agregar una vista: (1) define su ruta y permiso en `ui.jsx`; (2) agrega la operación en `services.js` si necesita datos; (3) confirma el mismo permiso en el endpoint del API; (4) trata estados de carga, vacío y error; (5) comprueba navegación invitado y usuario autenticado; (6) ejecuta `npm run build` desde `web/`. Si cambia la estructura de vistas, actualiza el [diagrama de rutas](../docs/README.md). La comprobación de permisos en la UI no reemplaza la del servidor.

![Componentes React de la interfaz](../docs/diagrama_componentes_react.png)
