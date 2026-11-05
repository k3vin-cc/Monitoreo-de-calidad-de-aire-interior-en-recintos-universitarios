-- Idempotencia de ventanas con hora incierta del firmware v1.0.11.1.
-- Verificar antes de aplicar que no existan filas duplicadas de esta versión.
CREATE UNIQUE INDEX IF NOT EXISTS uq_incierto_v1111_nodo_orden
ON telemetria_tiempo_incierto ("nodoId", "ordenRegistro")
WHERE "paqueteOriginal"->>'firmwareVersion' = 'v1.0.11.1';
