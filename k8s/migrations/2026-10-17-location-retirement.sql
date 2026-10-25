BEGIN;

ALTER TABLE sectores ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE sectores ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;
ALTER TABLE edificios ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE edificios ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;
ALTER TABLE pisos ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE pisos ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;

ALTER TABLE sectores DROP CONSTRAINT IF EXISTS sectores_nombre_key;
ALTER TABLE edificios DROP CONSTRAINT IF EXISTS uq_edificio_sector_nombre;
ALTER TABLE pisos DROP CONSTRAINT IF EXISTS uq_piso_edificio_nivel;
ALTER TABLE salas DROP CONSTRAINT IF EXISTS uq_sala_piso_nombre;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sectores_nombre_activo ON sectores(nombre) WHERE "retiradoEn" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_edificio_sector_nombre_activo ON edificios("sectorId", nombre) WHERE "retiradoEn" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_piso_edificio_nivel_activo ON pisos("edificioId", nivel) WHERE "retiradoEn" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sala_piso_nombre_activa ON salas("pisoId", nombre) WHERE "retiradoEn" IS NULL;

CREATE INDEX IF NOT EXISTS idx_sectores_retirado_en ON sectores("retiradoEn");
CREATE INDEX IF NOT EXISTS idx_edificios_retirado_en ON edificios("retiradoEn");
CREATE INDEX IF NOT EXISTS idx_pisos_retirado_en ON pisos("retiradoEn");
CREATE INDEX IF NOT EXISTS idx_salas_retirado_en ON salas("retiradoEn");

CREATE OR REPLACE VIEW vw_estado_actual_salas AS
SELECT sec.id AS "sectorId",sec.nombre AS "sectorNombre",edf.id AS "edificioId",edf.nombre AS "edificioNombre",
    p.id AS "pisoId",p.nombre AS "pisoNombre",p.nivel AS "pisoNivel",s.id AS "salaId",s.nombre AS "salaNombre",
    s."capacidadOcupantes",n.id AS "nodoId",n.estado AS "nodoEstado",n.firmware AS "nodoFirmware",
    n."ultimaTelemetria",t."timestamp" AS "ventanaTimestamp",t."versionReglas",t."conteosValidos",t.co2,t.pm25,t.pm10,
    t.temperatura,t.humedad,t."icaiScore",t."icaiCategoria",t."icaiEstado",t."causasICAI",t."ictScore",
    t."ictCategoria",t."ictEstado",t."causasICT",t."icgScore",t."icgCategoria",t."icgEstado",t."causasICG",
    t."celdaMatriz",t.recomendaciones
FROM salas s JOIN pisos p ON p.id=s."pisoId" JOIN edificios edf ON edf.id=p."edificioId"
JOIN sectores sec ON sec.id=edf."sectorId" LEFT JOIN nodos n ON n."salaId"=s.id
LEFT JOIN LATERAL (SELECT * FROM telemetria tl WHERE tl."salaId"=s.id ORDER BY tl."timestamp" DESC LIMIT 1) t ON TRUE
WHERE s."retiradoEn" IS NULL AND p."retiradoEn" IS NULL AND edf."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL;

COMMIT;
