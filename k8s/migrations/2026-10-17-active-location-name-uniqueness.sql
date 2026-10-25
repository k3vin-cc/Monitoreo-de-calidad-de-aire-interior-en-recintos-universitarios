BEGIN;

-- Comparaciones sin distinguir mayúsculas ni espacios exteriores, sólo entre registros activos.
DROP INDEX IF EXISTS uq_sectores_nombre_activo;
DROP INDEX IF EXISTS uq_edificio_sector_nombre_activo;
DROP INDEX IF EXISTS uq_piso_edificio_nombre_activo;
DROP INDEX IF EXISTS uq_sala_piso_nombre_activa;

CREATE UNIQUE INDEX uq_sectores_nombre_activo
    ON sectores (LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE UNIQUE INDEX uq_edificio_sector_nombre_activo
    ON edificios ("sectorId", LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE UNIQUE INDEX uq_piso_edificio_nombre_activo
    ON pisos ("edificioId", LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE UNIQUE INDEX uq_sala_piso_nombre_activa
    ON salas ("pisoId", LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;

COMMIT;
