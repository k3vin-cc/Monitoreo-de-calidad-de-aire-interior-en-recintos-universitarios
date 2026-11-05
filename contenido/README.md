# Especificaciones y fuentes documentales

Esta carpeta conserva el diseño metodológico y documentos de etapas anteriores. Para iniciar una instalación usa [docs/instalacion-local.md](../docs/instalacion-local.md) o [k8s/README.md](../k8s/README.md), no estos documentos como instrucciones de despliegue.

1. [Base de datos](base%20de%20datos/README_BD.md): esquema SQL inicial, modelo ER y advertencias sobre migraciones.
2. [Página web](pagina/README.md): especificación funcional que debe contrastarse con `web/src/`.
3. `FLUJO_DATOS_ESP32_Y_SELECCION_BD.md` y `.tex`: explicación del flujo nodo → MQTT → API → TimescaleDB. Edita el texto fuente; PDF y auxiliares se generan localmente.
4. `openapi_etapa2.yaml`: contrato histórico de etapa 2. Para las rutas actualmente implementadas, inicia el API y consulta `/docs`.

Cuando cambie código, SQL o protocolo, revisa si la documentación correspondiente también requiere actualización. No añadas al repositorio tablas de mediciones reales, informes operativos con identificadores ni archivos compilados de LaTeX.

![Flujo de telemetría e índices desde el ESP32 hasta la plataforma](../docs/arquitectura/diagrama_secuencia_telemetria_indices.png)
