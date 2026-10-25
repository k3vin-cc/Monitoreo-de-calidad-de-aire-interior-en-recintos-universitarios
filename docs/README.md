# Documentación y diagramas transversales

- [Instalación local](instalacion-local.md): base nueva, primer administrador, API, web y comprobaciones.
- [Arquitectura general y secuencia de telemetría](arquitectura/README.md): diagramas que cruzan hardware, broker, API y web.
- [Firmware y KiCad](../esp32_nodo_aira/README.md), [modelo ER](../contenido/base%20de%20datos/README_BD.md) y [diagramas web](../web/docs/README.md): figuras junto a sus componentes.
- [Despliegue Kubernetes](../k8s/README.md): instalación institucional, Secret, ConfigMaps, verificación y límites.

Los documentos bajo `contenido/` conservan el contexto de diseño y de la memoria técnica; las figuras fueron citadas en un `main.tex` externo a este repositorio. Si se actualiza la memoria, sincroniza sus rutas y exportaciones. No publiques las gráficas de pruebas con telemetría real sin anonimizar y revisar su uso.

![Arquitectura general: nodo, broker, API, base de datos y dashboard](arquitectura/diagrama_arquitectura_general.png)
