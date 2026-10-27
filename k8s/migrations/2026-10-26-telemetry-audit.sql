-- Auditoría opcional por ventana. Las filas anteriores conservan NULL.
ALTER TABLE telemetria
  ADD COLUMN IF NOT EXISTS "ventanaId" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "ventanaInicio" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "ventanaFinReal" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "ordenRegistro" BIGINT,
  ADD COLUMN IF NOT EXISTS "firmwareVersion" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "mediasClasificacion" JSONB,
  ADD COLUMN IF NOT EXISTS subniveles JSONB,
  ADD COLUMN IF NOT EXISTS persistencia JSONB,
  ADD COLUMN IF NOT EXISTS invalidaciones JSONB,
  ADD COLUMN IF NOT EXISTS calibracion JSONB;

CREATE INDEX IF NOT EXISTS idx_telemetria_nodo_orden
  ON telemetria ("nodoId", "ordenRegistro") WHERE "ordenRegistro" IS NOT NULL;
