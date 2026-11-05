-- v1.0.10 y v1.0.11 conservan la misma secuencia persistente y recuperación NTP de v1.0.9.
-- Evita duplicar la ventana si el broker vuelve a entregarla tras un PUBACK perdido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_incierto_v110_v111_nodo_orden
ON telemetria_tiempo_incierto ("nodoId", "ordenRegistro")
WHERE "paqueteOriginal"->>'firmwareVersion' IN ('v1.0.10', 'v1.0.11');
