# Arquitectura entre componentes

El [diagrama de arquitectura general](diagrama_arquitectura_general.png) sitúa sensores/ESP32, LittleFS, Wi‑Fi, broker Mosquitto, API, TimescaleDB y dashboard. El [diagrama de secuencia](diagrama_secuencia_telemetria_indices.png) sigue una ventana desde el cálculo local hasta su publicación, validación, persistencia y actualización de vistas.

![Arquitectura general del sistema](diagrama_arquitectura_general.png)

![Secuencia de telemetría e índices](diagrama_secuencia_telemetria_indices.png)

Estas figuras cruzan varios módulos y por eso permanecen en `docs/arquitectura/`. El [README principal](../../README.md) resume el flujo; los detalles vigentes están en el firmware, API, SQL y manifiestos. Si cambian protocolo, ruta MQTT, cálculo de índices o persistencia, revisa ambos diagramas y sus enlaces en la memoria técnica.
