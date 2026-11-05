-- Corrige el mínimo entero de 80 % de 288 ventanas y excluye fechas futuras.
-- La vista sigue devolviendo los mismos campos para los consumidores existentes.
CREATE OR REPLACE VIEW vw_particulas_24h_oms AS
SELECT
    s.id AS "salaId",
    COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL)::INTEGER AS "ventanasValidasPm25_24h",
    COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL)::INTEGER AS "ventanasValidasPm10_24h",
    CASE
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL) >= 231
        THEN ROUND(AVG(t.pm25)::numeric, 2)::DOUBLE PRECISION
        ELSE NULL
    END AS "media24hPm25",
    CASE
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL) >= 231
        THEN ROUND(AVG(t.pm10)::numeric, 2)::DOUBLE PRECISION
        ELSE NULL
    END AS "media24hPm10",
    15.0::DOUBLE PRECISION AS "referenciaOms24hPm25",
    45.0::DOUBLE PRECISION AS "referenciaOms24hPm10",
    CASE
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL) >= 231
         AND COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL) >= 231
        THEN 'completo'
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL) >= 231
          OR COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL) >= 231
        THEN 'parcial'
        ELSE 'dato_insuficiente'
    END AS "estadoSerie24h"
FROM salas s
LEFT JOIN telemetria t
       ON t."salaId" = s.id
      AND t."timestamp" > NOW() - INTERVAL '24 hours'
      AND t."timestamp" <= NOW()
GROUP BY s.id;
