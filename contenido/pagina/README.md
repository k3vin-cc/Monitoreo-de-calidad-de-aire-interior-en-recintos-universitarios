# Especificación de la página

[`ESPECIFICACION_PAGINA_WEB.md`](ESPECIFICACION_PAGINA_WEB.md) reúne decisiones funcionales de la etapa de diseño. Es una referencia para entender roles, jerarquía de lugares y presentación de índices, no una guía de instalación ni un contrato de API actualizado.

Para comprobar una función: identifica su vista en [`web/src/`](../../web/src/README.md), encuentra la solicitud en `services.js` y contrasta la ruta/permiso en `api/main.py` o `/docs` del API. Si la especificación y el comportamiento divergen, documenta la diferencia antes de modificarla. Los diagramas propios de la web están en [`web/docs/`](../../web/docs/README.md).

![Arquitectura del dashboard web](../../web/docs/diagrama_arquitectura_dashboard_web.png)
