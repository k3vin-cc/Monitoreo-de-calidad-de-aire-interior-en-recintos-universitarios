# Estados del firmware

El [diagrama FSM](diagrama_fsm_firmware.png) muestra inicialización, conexión Wi‑Fi, sincronización NTP, publicación MQTT y funcionamiento degradado con buffer LittleFS. Úsalo junto a `../config.h` y `../esp32_nodo_aira.ino` para interpretar el log serie. La figura procede del documento técnico y puede requerir actualización si cambian estados o tiempos; el código define el comportamiento vigente.

![Máquina de estados del firmware ESP32](diagrama_fsm_firmware.png)
