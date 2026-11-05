-- Expone el subnivel ya almacenado por cada variable en el estado actual.
-- Agregar la columna al final conserva el orden de las columnas existentes.
CREATE OR REPLACE VIEW vw_estado_actual_salas AS
SELECT
    sec.id AS "sectorId", sec.nombre AS "sectorNombre",
    edf.id AS "edificioId", edf.nombre AS "edificioNombre",
    p.id AS "pisoId", p.nombre AS "pisoNombre", p.nivel AS "pisoNivel",
    s.id AS "salaId", s.nombre AS "salaNombre", s."capacidadOcupantes",
    n.id AS "nodoId", n.estado AS "nodoEstado", n.firmware AS "nodoFirmware",
    n."ultimaTelemetria", t."timestamp" AS "ventanaTimestamp",
    t."versionReglas", t."conteosValidos", t.co2, t.pm25, t.pm10,
    t.temperatura, t.humedad,
    t."icaiScore", t."icaiCategoria", t."icaiEstado", t."causasICAI",
    t."ictScore", t."ictCategoria", t."ictEstado", t."causasICT",
    t."icgScore", t."icgCategoria", t."icgEstado", t."causasICG",
    t."celdaMatriz", t.recomendaciones, t.subniveles
FROM salas s
JOIN pisos p ON p.id=s."pisoId"
JOIN edificios edf ON edf.id=p."edificioId"
JOIN sectores sec ON sec.id=edf."sectorId"
LEFT JOIN nodos n ON n."salaId"=s.id
LEFT JOIN LATERAL (
    SELECT * FROM telemetria tl
    WHERE tl."salaId"=s.id
    ORDER BY tl."timestamp" DESC
    LIMIT 1
) t ON TRUE
WHERE s."retiradoEn" IS NULL AND p."retiradoEn" IS NULL
  AND edf."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL;
