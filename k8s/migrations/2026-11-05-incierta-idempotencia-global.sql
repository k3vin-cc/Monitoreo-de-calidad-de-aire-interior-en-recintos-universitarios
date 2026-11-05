-- Comprobar duplicados por nodo y secuencia antes de ejecutar esta migración.
-- La secuencia se conserva en NVS y se comparte entre versiones de firmware.
BEGIN;
CREATE UNIQUE INDEX uq_incierto_nodo_orden_global
ON telemetria_tiempo_incierto ("nodoId", "ordenRegistro");
DROP INDEX IF EXISTS uq_incierto_v109_nodo_orden;
DROP INDEX IF EXISTS uq_incierto_v110_v111_nodo_orden;
DROP INDEX IF EXISTS uq_incierto_v1111_nodo_orden;
COMMIT;
