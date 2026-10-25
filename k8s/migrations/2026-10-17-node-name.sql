BEGIN;

ALTER TABLE nodos ADD COLUMN IF NOT EXISTS nombre VARCHAR(100);
UPDATE nodos
SET nombre = 'Nodo-' || SUBSTRING(MD5(id), 1, 12)
WHERE nombre IS NULL OR BTRIM(nombre) = '';
ALTER TABLE nodos ALTER COLUMN nombre SET NOT NULL;

DROP INDEX IF EXISTS uq_nodo_sala_nombre_activo;
CREATE UNIQUE INDEX uq_nodo_sala_nombre_activo
    ON nodos (COALESCE("salaId", ''), LOWER(BTRIM(nombre)))
    WHERE "retiradoEn" IS NULL;

COMMIT;
