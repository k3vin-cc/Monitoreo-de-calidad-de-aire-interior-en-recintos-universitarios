# Esquema eléctrico del nodo

[`esp32_con_lineas.kicad_sch`](esp32_con_lineas.kicad_sch) es la fuente KiCad 10 del [PNG publicado](estacion_monitoreo_cableado.png). Se comprobó que la exportación original coincide byte por byte con la figura usada en `main.tex`. Mantén `esp32_con_lineas.kicad_pro`, `Proyecto.kicad_sym` y `sym-lib-table` en esta carpeta: la biblioteca local usa `${KIPRJMOD}` y permite abrir los símbolos personalizados al clonar el proyecto. No se incluyen archivos `.kicad_prl`, netlists ni salidas de compilación.

![Esquema eléctrico KiCad del nodo ESP32](estacion_monitoreo_cableado.png)

1. Abre el `.kicad_sch` en KiCad 10 y verifica que no se soliciten bibliotecas faltantes.
2. Revisa el cajetín y la serigrafía de tu ESP32 físico: antena arriba, USB abajo y posiciones L01–L19/R01–R19. El pinout depende de la placa concreta.
3. Compara las líneas SCD40, PMS5003 y ST7789 con las constantes de `../esp32_nodo_aira.ino`. Si cambias el cableado, modifica también código, tabla de pines y exportación PNG.
4. Antes de energizar, mide la salida LM2596 a 5,0 V, comprueba GND común, polaridad y capacidad de 3V3. La fuente de 12 V alimenta el regulador, nunca directamente al ESP32.

Los símbolos no tienen footprint para PCB: el archivo sirve para documentar conexiones. No se ha ejecutado KiCad/ERC como parte de esta reorganización; el esquema original indicaba una revisión previa, que debe repetirse después de cualquier modificación.
