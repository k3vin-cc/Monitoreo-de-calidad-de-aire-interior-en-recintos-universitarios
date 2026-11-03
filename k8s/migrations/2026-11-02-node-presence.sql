-- Presencia: la telemetría no demuestra que el nodo siga comunicado.
BEGIN;
ALTER TABLE nodos DROP CONSTRAINT nodos_estado_check;
ALTER TABLE nodos ADD CONSTRAINT nodos_estado_check CHECK (estado IN ('conectado','no_respondio','desconectado'));
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "ultimaSenalPresencia" TIMESTAMPTZ;
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "presenciaPendienteDesde" TIMESTAMPTZ;
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "presenciaSesion" BIGINT;
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "presenciaSecuencia" BIGINT;
CREATE INDEX IF NOT EXISTS idx_nodos_presencia_plazo ON nodos ("ultimaSenalPresencia")
WHERE "retiradoEn" IS NULL AND "ultimaSenalPresencia" IS NOT NULL;
-- Los antiguos estados conectados provenían de telemetría, no de presencia.
UPDATE nodos SET estado='desconectado'
WHERE "retiradoEn" IS NULL AND "ultimaSenalPresencia" IS NULL AND estado='conectado';
CREATE OR REPLACE FUNCTION fn_procesar_ventana_telemetria()
RETURNS TRIGGER AS $$
DECLARE
    v_pareja       RECORD;
    v_primera      RECORD;
    v_segunda      RECORD;
    v_causa        TEXT;
    v_valor_medido DOUBLE PRECISION;
BEGIN
    -- A. Actualizar telemetría sin alterar la presencia del nodo
    UPDATE nodos
       SET "ultimaTelemetria" = GREATEST(COALESCE("ultimaTelemetria", NEW."timestamp"), NEW."timestamp"),
           "updatedAt" = NOW()
     WHERE id = NEW."nodoId";

    -- B. Si la ventana insertada es completa y es la más reciente, verificar si resuelve alertas activas previas
    IF NEW."icgEstado" = 'completo' AND NOT EXISTS (
        SELECT 1 FROM telemetria posterior
        WHERE posterior."salaId"=NEW."salaId" AND posterior."timestamp">NEW."timestamp"
    ) THEN
        UPDATE alertas a
           SET estado = 'resuelta',
               "resueltaEn" = NEW."timestamp"
         WHERE a."salaId" = NEW."salaId"
           AND a.estado = 'activa'
           AND a."ventanaConfirmacion" < NEW."timestamp"
           AND (
               NEW."icgScore" < 3
               OR NOT (a.variable = ANY(COALESCE(NEW."causasICG", '{}'::TEXT[])))
           );
    END IF;

    -- C. Evaluar confirmación de avisos sólo si la ventana insertada tiene ICG completo y nivel >= 3
    IF NEW."icgEstado" <> 'completo' OR NEW."icgScore" IS NULL OR NEW."icgScore" < 3
       OR EXISTS (SELECT 1 FROM telemetria posterior
                  WHERE posterior."salaId"=NEW."salaId" AND posterior."timestamp">NEW."timestamp") THEN
        RETURN NEW;
    END IF;

    -- Buscar ventana vecina exactamente 5 minutos antes o 5 minutos después en la misma sala
    FOR v_pareja IN
        SELECT *
          FROM telemetria t
         WHERE t."salaId" = NEW."salaId"
           AND t."timestamp" IN (NEW."timestamp" - INTERVAL '5 minutes', NEW."timestamp" + INTERVAL '5 minutes')
           AND t."icgEstado" = 'completo'
           AND t."icgScore" >= 3
    LOOP
        -- Determinar cuál es la primera y cuál es la segunda ventana en orden temporal real
        IF v_pareja."timestamp" < NEW."timestamp" THEN
            v_primera := v_pareja;
            v_segunda := NEW;
        ELSE
            v_primera := NEW;
            v_segunda := v_pareja;
        END IF;

        -- Recorrer cada variable causal común presente en ambas ventanas (conserva empates)
        FOR v_causa IN
            SELECT UNNEST(COALESCE(v_primera."causasICG", '{}'::TEXT[]))
            INTERSECT
            SELECT UNNEST(COALESCE(v_segunda."causasICG", '{}'::TEXT[]))
        LOOP
            -- Extraer el valor medido de la variable causal en la ventana de confirmación (segunda ventana)
            v_valor_medido := CASE v_causa
                WHEN 'CO2'         THEN v_segunda.co2
                WHEN 'PM2.5'       THEN v_segunda.pm25
                WHEN 'PM10'        THEN v_segunda.pm10
                WHEN 'Temperatura' THEN v_segunda.temperatura
                WHEN 'Humedad'     THEN v_segunda.humedad
                ELSE NULL
            END;

            IF v_valor_medido IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM alertas vigente WHERE vigente."salaId"=v_segunda."salaId"
                  AND vigente.variable=v_causa AND vigente.estado='activa'
            ) THEN
                INSERT INTO alertas (
                    "salaId",
                    "nodoId",
                    variable,
                    "valorMedido",
                    nivel,
                    "ventanaConfirmacion",
                    "timestamp",
                    estado
                )
                VALUES (
                    v_segunda."salaId",
                    v_segunda."nodoId",
                    v_causa,
                    v_valor_medido,
                    v_segunda."icgScore",
                    v_segunda."timestamp",
                    NOW(),
                    'activa'
                )
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMIT;
