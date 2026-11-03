-- Las ventanas v1.0.9 de hora incierta se deduplican por nodo y secuencia.
-- Revisar primero posibles duplicados v1.0.9 antes de aplicar este índice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_incierto_v109_nodo_orden
ON telemetria_tiempo_incierto ("nodoId", "ordenRegistro")
WHERE "paqueteOriginal"->>'firmwareVersion' = 'v1.0.9';

CREATE INDEX IF NOT EXISTS idx_incierto_sala_fecha_estimada
ON telemetria_tiempo_incierto ("salaId", "timestampResuelto" DESC)
WHERE "timestampResuelto" IS NOT NULL;
