BEGIN;

ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "salaIdReserva" VARCHAR(36);
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "retiroUbicacion" JSONB;
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "historialRetiros" JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_nodos_retirado_en ON nodos("retiradoEn");
CREATE INDEX IF NOT EXISTS idx_alertas_nodo ON alertas("nodoId");

COMMIT;
