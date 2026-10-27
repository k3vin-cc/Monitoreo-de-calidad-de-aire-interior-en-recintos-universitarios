-- =============================================================================
-- SISTEMA DE MONITOREO DE CALIDAD DEL AIRE INTERIOR EN RECINTOS UNIVERSITARIOS
-- Motor: PostgreSQL 16 + Extensión TimescaleDB
-- Basado en: Sección 6.4 de main.tex + Correcciones, Mejoras y Migraciones
--            de Producción para el Dashboard Web (React 18 + FastAPI) y Bot Telegram
-- =============================================================================

BEGIN;

-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- Para gen_random_uuid() y funciones hash
CREATE EXTENSION IF NOT EXISTS timescaledb;  -- Motor de hipertablas de series temporales

-- =============================================================================
-- 1. JERARQUÍA ESPACIAL UNIVERSITARIA (Sección 6.4.2 de main.tex)
--    Soporta navegación en cascada: Sector -> Edificio -> Piso -> Sala
--    Vistas: /dashboard, /sectores/:id, /edificios/:id, /pisos/:id, /salas/:id
--    Incluye soporte para baja lógica (soft delete) y nombres descriptivos únicos.
-- =============================================================================

-- 1.1. Tabla `sectores` (Campus o predios universitarios)
CREATE TABLE IF NOT EXISTS sectores (
    id              VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    nombre          VARCHAR(100) NOT NULL,
    descripcion     TEXT,
    "retiradoEn"    TIMESTAMPTZ,
    "retiroContexto" JSONB,
    "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE sectores ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE sectores ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;
ALTER TABLE sectores DROP CONSTRAINT IF EXISTS sectores_nombre_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sectores_nombre_activo ON sectores(LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE INDEX IF NOT EXISTS idx_sectores_retirado_en ON sectores("retiradoEn");

-- 1.2. Tabla `edificios` (Inmuebles pertenecientes a un sector)
CREATE TABLE IF NOT EXISTS edificios (
    id              VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    "sectorId"      VARCHAR(36)  NOT NULL REFERENCES sectores(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    nombre          VARCHAR(100) NOT NULL,
    direccion       VARCHAR(200),
    "retiradoEn"    TIMESTAMPTZ,
    "retiroContexto" JSONB,
    "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_edificio_sector_nombre UNIQUE ("sectorId", nombre)
);

ALTER TABLE edificios ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE edificios ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;
ALTER TABLE edificios DROP CONSTRAINT IF EXISTS uq_edificio_sector_nombre;
CREATE UNIQUE INDEX IF NOT EXISTS uq_edificio_sector_nombre_activo ON edificios("sectorId", LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE INDEX IF NOT EXISTS idx_edificios_retirado_en ON edificios("retiradoEn");
CREATE INDEX IF NOT EXISTS idx_edificios_sector ON edificios("sectorId");

-- 1.3. Tabla `pisos` (Niveles arquitectónicos de cada edificio)
CREATE TABLE IF NOT EXISTS pisos (
    id              VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    "edificioId"    VARCHAR(36)  NOT NULL REFERENCES edificios(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    nombre          VARCHAR(50)  NOT NULL,
    nivel           INTEGER      NOT NULL,
    "retiradoEn"    TIMESTAMPTZ,
    "retiroContexto" JSONB,
    "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_piso_edificio_nivel UNIQUE ("edificioId", nivel)
);

ALTER TABLE pisos ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE pisos ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;
ALTER TABLE pisos DROP CONSTRAINT IF EXISTS uq_piso_edificio_nivel;
CREATE UNIQUE INDEX IF NOT EXISTS uq_piso_edificio_nivel_activo ON pisos("edificioId", nivel) WHERE "retiradoEn" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_piso_edificio_nombre_activo ON pisos("edificioId", LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE INDEX IF NOT EXISTS idx_pisos_retirado_en ON pisos("retiradoEn");
CREATE INDEX IF NOT EXISTS idx_pisos_edificio ON pisos("edificioId");

-- 1.4. Tabla `salas` (Aulas y laboratorios monitoreados)
CREATE TABLE IF NOT EXISTS salas (
    id                   VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    "pisoId"             VARCHAR(36)  NOT NULL REFERENCES pisos(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    nombre               VARCHAR(100) NOT NULL,
    "capacidadOcupantes" INTEGER      NOT NULL CHECK ("capacidadOcupantes" > 0),
    "retiradoEn"         TIMESTAMPTZ,
    "retiroContexto"     JSONB,
    "createdAt"          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sala_piso_nombre UNIQUE ("pisoId", nombre)
);

ALTER TABLE salas ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE salas ADD COLUMN IF NOT EXISTS "retiroContexto" JSONB;
ALTER TABLE salas DROP CONSTRAINT IF EXISTS uq_sala_piso_nombre;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sala_piso_nombre_activa ON salas("pisoId", LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE INDEX IF NOT EXISTS idx_salas_piso ON salas("pisoId");
CREATE INDEX IF NOT EXISTS idx_salas_retirado_en ON salas("retiradoEn");


-- =============================================================================
-- 2. GESTIÓN DE USUARIOS, SESIONES Y CONTROL DE ACCESO RBAC
--    Vistas: /login, /usuarios, /perfil y autorización transversal en API REST
-- =============================================================================

-- 2.1. Tabla `usuarios` (Sección 6.4.2 de main.tex + Mejoras RBAC)
CREATE TABLE IF NOT EXISTS usuarios (
    id                  VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    nombre              VARCHAR(100) NOT NULL,
    email               VARCHAR(100) NOT NULL UNIQUE,
    telefono            VARCHAR(20), -- Informativo; NO autoriza por sí solo el Bot de Telegram
    rol                 VARCHAR(20)  NOT NULL CHECK (rol IN ('ADMIN', 'ANALISTA', 'VIEWER', 'GUEST')),
    estado              VARCHAR(20)  NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
    password            TEXT         NOT NULL, -- Hash seguro bcrypt
    "assignedEdificios" TEXT[]       NOT NULL DEFAULT '{}',
    "createdAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_rol_estado ON usuarios(rol, estado);

-- 2.2. Tabla `usuario_edificios` (AMPLIACIÓN para integridad referencial FK de permisos)
CREATE TABLE IF NOT EXISTS usuario_edificios (
    "usuarioId"     VARCHAR(36) NOT NULL REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE CASCADE,
    "edificioId"    VARCHAR(36) NOT NULL REFERENCES edificios(id) ON UPDATE CASCADE ON DELETE CASCADE,
    "asignadoEn"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("usuarioId", "edificioId")
);

CREATE INDEX IF NOT EXISTS idx_usuario_edificios_edificio ON usuario_edificios("edificioId");

-- Trigger para sincronizar `usuario_edificios` -> `usuarios.assignedEdificios`
CREATE OR REPLACE FUNCTION fn_sync_assigned_edificios()
RETURNS TRIGGER AS $$
DECLARE
    v_uid VARCHAR(36);
BEGIN
    v_uid := COALESCE(NEW."usuarioId", OLD."usuarioId");
    UPDATE usuarios
       SET "assignedEdificios" = COALESCE(
               ARRAY(
                   SELECT "edificioId"
                     FROM usuario_edificios
                    WHERE "usuarioId" = v_uid
                    ORDER BY "edificioId"
               ),
               '{}'::TEXT[]
           ),
           "updatedAt" = NOW()
     WHERE id = v_uid;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_assigned_edificios ON usuario_edificios;
CREATE TRIGGER trg_sync_assigned_edificios
AFTER INSERT OR UPDATE OR DELETE ON usuario_edificios
FOR EACH ROW EXECUTE FUNCTION fn_sync_assigned_edificios();

-- 2.3. Tabla `sesiones_usuario` (AMPLIACIÓN para renovación y revocación inmediata en /login y /usuarios)
CREATE TABLE IF NOT EXISTS sesiones_usuario (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    "usuarioId"         VARCHAR(36) NOT NULL REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE CASCADE,
    "refreshTokenHash"  CHAR(64)    NOT NULL UNIQUE, -- SHA-256 del token de renovación
    "expiraEn"          TIMESTAMPTZ NOT NULL,
    revocada            BOOLEAN     NOT NULL DEFAULT FALSE,
    "ultimaActividadEn" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_activas ON sesiones_usuario("usuarioId", revocada, "expiraEn");


-- =============================================================================
-- 3. GESTOR DE VERSIONES DE FIRMWARE Y NODOS SENSORES IoT
--    Vista: /nodos (Exclusivo ADMIN: Subida .bin, Ordenamiento Viejo->Nuevo,
--           Descarga .bin, Flasheo por USB Web Serial API y Baja Lógica)
-- =============================================================================

-- 3.1. Tabla `firmwares` (AMPLIACIÓN para el Gestor de Versiones de Firmware en /nodos)
CREATE TABLE IF NOT EXISTS firmwares (
    id              VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    version         VARCHAR(20)  NOT NULL UNIQUE, -- Ej: 'v1.0.0', 'v1.1.0'
    "versionReglas" VARCHAR(20)  NOT NULL,        -- Ej: 'reglas-2026.1' (trazable con telemetria.versionReglas)
    "nombreArchivo" VARCHAR(150) NOT NULL,        -- Ej: 'firmware_esp32_v1.1.0.bin'
    "rutaArchivo"   TEXT         NOT NULL,        -- Ruta heredada en el PVC para instalaciones anteriores
    "tamanoBytes"   INTEGER      NOT NULL CHECK ("tamanoBytes" > 0 AND "tamanoBytes" <= 1572864), -- Máx 1.5 MB (partición app0/app1)
    sha256          CHAR(64)     NOT NULL UNIQUE, -- Verificación de integridad antes de flashear por Web Serial
    "contenido"     BYTEA,                       -- Binario persistente en PostgreSQL para descarga/flasheo
    estado          VARCHAR(20)  NOT NULL DEFAULT 'oficial' CHECK (estado IN ('oficial', 'prueba', 'obsoleta')),
    changelog       TEXT,                         -- Notas de versión / cambios incluidos
    "subidoPor"     VARCHAR(36)  REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL,
    "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE firmwares ADD COLUMN IF NOT EXISTS "contenido" BYTEA;

CREATE INDEX IF NOT EXISTS idx_firmwares_created_at ON firmwares("createdAt" ASC, version);
CREATE INDEX IF NOT EXISTS idx_firmwares_estado ON firmwares(estado);

-- 3.2. Tabla `nodos` (Sección 6.4.2 de main.tex + Mejoras para Web Serial API y Retiro)
CREATE TABLE IF NOT EXISTS nodos (
    id                  VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    nombre              VARCHAR(100) NOT NULL,
    "salaId"            VARCHAR(36) UNIQUE REFERENCES salas(id) ON UPDATE CASCADE ON DELETE SET NULL,
    "macAddress"        VARCHAR(17) UNIQUE,      -- Leída por Web Serial USB durante el aprovisionamiento
    estado              VARCHAR(20) NOT NULL DEFAULT 'desconectado' CHECK (estado IN ('conectado', 'desconectado')),
    firmware            VARCHAR(20) NOT NULL DEFAULT 'v1.0.0', -- Versión actual instalada
    "firmwareId"        VARCHAR(36) REFERENCES firmwares(id) ON UPDATE CASCADE ON DELETE SET NULL,
    "wifiSsid"          VARCHAR(50),
    "jwtToken"          TEXT,                    -- Token JWT o identificador de credencial del dispositivo
    "ultimaTelemetria"  TIMESTAMPTZ,
    "ultimoFlasheoEn"   TIMESTAMPTZ,
    "flasheadoPor"      VARCHAR(36) REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL,
    "retiradoEn"        TIMESTAMPTZ,
    "salaIdReserva"     VARCHAR(36),
    "retiroUbicacion"   JSONB,
    "historialRetiros"  JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotencia para esquemas preexistentes
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS nombre VARCHAR(100);
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "retiradoEn" TIMESTAMPTZ;
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "salaIdReserva" VARCHAR(36);
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "retiroUbicacion" JSONB;
ALTER TABLE nodos ADD COLUMN IF NOT EXISTS "historialRetiros" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nodo_sala_nombre_activo
    ON nodos (COALESCE("salaId", ''), LOWER(BTRIM(nombre))) WHERE "retiradoEn" IS NULL;
CREATE INDEX IF NOT EXISTS idx_nodos_estado ON nodos(estado);
CREATE INDEX IF NOT EXISTS idx_nodos_retirado_en ON nodos("retiradoEn");
CREATE INDEX IF NOT EXISTS idx_nodos_firmware ON nodos(firmware);


-- =============================================================================
-- 4. SERIES TEMPORALES DE TELEMETRÍA E ÍNDICES AMBIENTALES (ICAI, ICT, ICG)
--    Vistas: /dashboard, /sectores/:id, /edificios/:id, /pisos/:id,
--            /salas/:id y /historico (consultas y exportación CSV/JSON)
-- =============================================================================

-- 4.1. Hipertabla `telemetria` (Sección 6.4.2 de main.tex + Columnas simétricas y de resiliencia)
CREATE TABLE IF NOT EXISTS telemetria (
    id                    UUID             NOT NULL DEFAULT gen_random_uuid(),
    "salaId"              VARCHAR(36)      NOT NULL REFERENCES salas(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    "nodoId"              VARCHAR(36)      NOT NULL REFERENCES nodos(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    "timestamp"           TIMESTAMPTZ      NOT NULL, -- Fin verificable de la ventana de 5 min (UTC vía NTP)
    "recibidoEn"          TIMESTAMPTZ      NOT NULL DEFAULT NOW(), -- Hora de llegada al backend (para medir latencia)
    "conteosValidos"      JSONB            NOT NULL, -- Ej: {"co2":30,"pm25":30,"pm10":30,"temperatura":30,"humedad":30}
    "versionReglas"       VARCHAR(20)      NOT NULL, -- Versión de reglas aplicada por el ESP32
    "ventanasDescartadas" INTEGER          NOT NULL DEFAULT 0 CHECK ("ventanasDescartadas" >= 0),
    "esRetransmision"     BOOLEAN          NOT NULL DEFAULT FALSE,
    "ventanaId"           VARCHAR(80),
    "ventanaInicio"       TIMESTAMPTZ,
    "ventanaFinReal"      TIMESTAMPTZ,
    "ordenRegistro"       BIGINT,
    "firmwareVersion"     VARCHAR(20),
    "mediasClasificacion" JSONB,
    subniveles            JSONB,
    persistencia          JSONB,
    invalidaciones        JSONB,
    calibracion           JSONB,

    -- Medias físicas de 5 minutos (sin corrección previa en PM2.5/PM10 según RF-12)
    co2                   DOUBLE PRECISION CHECK (co2 IS NULL OR (co2 >= 0 AND co2 <= 40000)),
    pm25                  DOUBLE PRECISION CHECK (pm25 IS NULL OR pm25 >= 0),
    pm10                  DOUBLE PRECISION CHECK (pm10 IS NULL OR pm10 >= 0),
    temperatura           DOUBLE PRECISION CHECK (temperatura IS NULL OR (temperatura >= -20 AND temperatura <= 60)),
    humedad               DOUBLE PRECISION CHECK (humedad IS NULL OR (humedad >= 0 AND humedad <= 100)),

    -- Dominio 1: Índice de Calidad del Aire Interior (ICAI)
    "icaiScore"           SMALLINT         CHECK ("icaiScore" IS NULL OR ("icaiScore" BETWEEN 0 AND 4)),
    "icaiCategoria"       VARCHAR(20)      CHECK ("icaiCategoria" IS NULL OR "icaiCategoria" IN ('Optimo', 'Precaucion', 'Deficiente', 'Malo', 'Critico')),
    "icaiEstado"          VARCHAR(20)      NOT NULL CHECK ("icaiEstado" IN ('completo', 'parcial', 'dato_insuficiente')),
    "causasICAI"          TEXT[],          -- Variables que empatan en el máximo de aire

    -- Dominio 2: Índice de Condición Termohigrométrica (ICT)
    "ictScore"            SMALLINT         CHECK ("ictScore" IS NULL OR ("ictScore" BETWEEN 0 AND 4)),
    "ictCategoria"        VARCHAR(20)      CHECK ("ictCategoria" IS NULL OR "ictCategoria" IN ('Optimo', 'Precaucion', 'Deficiente', 'Malo', 'Critico')),
    "ictEstado"           VARCHAR(20)      NOT NULL CHECK ("ictEstado" IN ('completo', 'parcial', 'dato_insuficiente')),
    "causasICT"           TEXT[],          -- Variables que empatan en el máximo térmico

    -- Índice de Calidad General (ICG = max(S_aire, S_termico)) y Diagnóstico 5x5
    "icgScore"            SMALLINT         CHECK ("icgScore" IS NULL OR ("icgScore" BETWEEN 0 AND 4)),
    "icgCategoria"        VARCHAR(20)      CHECK ("icgCategoria" IS NULL OR "icgCategoria" IN ('Optimo', 'Precaucion', 'Deficiente', 'Malo', 'Critico')),
    "icgEstado"           VARCHAR(20)      NOT NULL CHECK ("icgEstado" IN ('completo', 'parcial', 'dato_insuficiente')),
    "causasICG"           TEXT[],          -- Variables causales globales (vacío si ICG=0, NULL si incompleto)
    "celdaMatriz"         VARCHAR(5),      -- Ej: 'O', 'A1'..'A4', 'T1'..'T4', 'M1'..'M4' (Tabla 6.6 del .tex)
    recomendaciones       TEXT[],          -- Mensajes breves orientativos (Tablas 6.7 y 6.8 del .tex)

    -- Clave primaria compuesta exigida por TimescaleDB: admite una sola ventana por sala e instante
    PRIMARY KEY ("salaId", "timestamp")
);

-- Conversión a Hipertabla de TimescaleDB con particionado automático de 7 días (Sección 6.4.3)
SELECT create_hypertable(
    'telemetria',
    'timestamp',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_telemetria_nodo_time ON telemetria("nodoId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_telemetria_nodo_orden ON telemetria("nodoId", "ordenRegistro") WHERE "ordenRegistro" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telemetria_icg_score ON telemetria("salaId", "timestamp" DESC) WHERE "icgScore" >= 3;

-- 4.2. Tabla `telemetria_tiempo_incierto` (Sección 6.4.2, línea 1316 de main.tex)
CREATE TABLE IF NOT EXISTS telemetria_tiempo_incierto (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    "nodoId"              VARCHAR(36) NOT NULL REFERENCES nodos(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    "salaId"              VARCHAR(36) REFERENCES salas(id) ON UPDATE CASCADE ON DELETE SET NULL,
    "ordenRegistro"       BIGINT      NOT NULL, -- Secuencia monotónica interna del nodo ESP32
    "recibidoEn"          TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- NO sustituye a la hora de medición
    "ventanasDescartadas" INTEGER     NOT NULL DEFAULT 0,
    "paqueteOriginal"     JSONB       NOT NULL,
    "timestampResuelto"   TIMESTAMPTZ,
    "migradoATelemetria"  BOOLEAN     NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_incierto_nodo_orden UNIQUE ("nodoId", "ordenRegistro", "recibidoEn")
);

CREATE INDEX IF NOT EXISTS idx_telemetria_incierta_pendiente
    ON telemetria_tiempo_incierto("nodoId", "recibidoEn" DESC)
    WHERE "migradoATelemetria" = FALSE;


-- =============================================================================
-- 5. HISTORIAL DE ALERTAS Y TRIGGER DE CONFIRMACIÓN (Sección 6.4.2 y 6.4.3)
--    Vistas: /alertas, banner de /dashboard, /salas/:id y notificaciones Telegram
-- =============================================================================

-- 5.1. Tabla `alertas`
CREATE TABLE IF NOT EXISTS alertas (
    id                    VARCHAR(36)      PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
    "salaId"              VARCHAR(36)      NOT NULL REFERENCES salas(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    "nodoId"              VARCHAR(36)      NOT NULL REFERENCES nodos(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    variable              VARCHAR(20)      NOT NULL CHECK (variable IN ('CO2', 'PM2.5', 'PM10', 'Temperatura', 'Humedad')),
    "valorMedido"         DOUBLE PRECISION NOT NULL,
    nivel                 SMALLINT         NOT NULL CHECK (nivel IN (3, 4)),
    "ventanaConfirmacion" TIMESTAMPTZ      NOT NULL, -- Fin de la 2da ventana válida consecutiva en orden temporal
    "timestamp"           TIMESTAMPTZ      NOT NULL DEFAULT NOW(), -- Momento en que el trigger registró el aviso
    estado                VARCHAR(20)      NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'resuelta')),
    "resueltaEn"          TIMESTAMPTZ,               -- Fecha/hora en que la condición dejó de persistir
    -- Restricción única del .tex para evitar duplicados ante retransmisiones o llegadas fuera de orden
    CONSTRAINT uq_alerta_sala_ventana_variable UNIQUE ("salaId", "ventanaConfirmacion", variable)
);

CREATE INDEX IF NOT EXISTS idx_alertas_sala_confirmacion ON alertas("salaId", "ventanaConfirmacion" DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_estado_activa ON alertas(estado, "ventanaConfirmacion" DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_nodo ON alertas("nodoId");
-- Una condición continua conserva una sola alerta activa por sala y variable (deduplicación estricta).
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_activa_sala_variable ON alertas("salaId", variable) WHERE estado = 'activa';

-- 5.2. Trigger `trg_confirmar_aviso_ambiental` (Sección 6.4.3 de main.tex + Deduplicación)
CREATE OR REPLACE FUNCTION fn_procesar_ventana_telemetria()
RETURNS TRIGGER AS $$
DECLARE
    v_pareja       RECORD;
    v_primera      RECORD;
    v_segunda      RECORD;
    v_causa        TEXT;
    v_valor_medido DOUBLE PRECISION;
BEGIN
    -- A. Actualizar marca de última telemetría del nodo
    UPDATE nodos
       SET "ultimaTelemetria" = GREATEST(COALESCE("ultimaTelemetria", NEW."timestamp"), NEW."timestamp"),
           estado = 'conectado',
           "updatedAt" = NOW()
     WHERE id = NEW."nodoId";

    -- B. Si la ventana insertada es completa y es la más reciente, verificar si resuelve alertas activas previas
    IF NEW."icgEstado" = 'completo' AND NOT EXISTS (
        SELECT 1 FROM telemetria posterior
        WHERE posterior."salaId" = NEW."salaId" AND posterior."timestamp" > NEW."timestamp"
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

    -- C. Evaluar confirmación de avisos sólo si la ventana insertada tiene ICG completo y nivel >= 3,
    --    y además no existe una telemetría posterior ya insertada para la misma sala.
    IF NEW."icgEstado" <> 'completo' OR NEW."icgScore" IS NULL OR NEW."icgScore" < 3
       OR EXISTS (SELECT 1 FROM telemetria posterior
                  WHERE posterior."salaId" = NEW."salaId" AND posterior."timestamp" > NEW."timestamp") THEN
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

            -- Solo registrar si no existe ya una alerta activa para esta sala y variable
            IF v_valor_medido IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM alertas vigente
                 WHERE vigente."salaId" = v_segunda."salaId"
                   AND vigente.variable = v_causa
                   AND vigente.estado = 'activa'
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

DROP TRIGGER IF EXISTS trg_confirmar_aviso_ambiental ON telemetria;
CREATE TRIGGER trg_confirmar_aviso_ambiental
AFTER INSERT ON telemetria
FOR EACH ROW EXECUTE FUNCTION fn_procesar_ventana_telemetria();


-- =============================================================================
-- 6. INTEGRACIÓN CON BOT DE TELEGRAM (Sección 6.4.2, línea 1343 y HU-18A)
--    Vista: /telegram y endpoints /telegram/vinculo y /telegram/preferencias
-- =============================================================================

-- 6.1. Tabla `telegram_vinculos` (Vínculo 1:1 entre cuenta web `usuarios` y chat de Telegram)
CREATE TABLE IF NOT EXISTS telegram_vinculos (
    "usuarioId"        VARCHAR(36)  PRIMARY KEY REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE CASCADE,
    "chatId"           BIGINT       UNIQUE, -- ID del chat de Telegram confirmado desde el bot
    "telegramUsername" VARCHAR(100),
    "chatVinculado"    BOOLEAN      NOT NULL DEFAULT FALSE,
    "avisosActivos"    BOOLEAN      NOT NULL DEFAULT FALSE,
    "codigoTemporal"   VARCHAR(32)  UNIQUE, -- Generado por POST /telegram/vinculo
    "codigoExpiraEn"   TIMESTAMPTZ,
    "vinculadoEn"      TIMESTAMPTZ,
    "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 6.2. Tabla `telegram_preferencias_salas` (Salas seleccionadas por el usuario en /telegram)
CREATE TABLE IF NOT EXISTS telegram_preferencias_salas (
    "usuarioId"     VARCHAR(36) NOT NULL REFERENCES telegram_vinculos("usuarioId") ON UPDATE CASCADE ON DELETE CASCADE,
    "salaId"        VARCHAR(36) NOT NULL REFERENCES salas(id) ON UPDATE CASCADE ON DELETE CASCADE,
    "pausadoHasta"  TIMESTAMPTZ,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("usuarioId", "salaId")
);

ALTER TABLE telegram_preferencias_salas ADD COLUMN IF NOT EXISTS "pausadoHasta" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_telegram_pref_sala ON telegram_preferencias_salas("salaId");


-- =============================================================================
-- 7. VISTAS SQL OPTIMIZADAS PARA LAS PÁGINAS DE LA WEB
-- =============================================================================

-- 7.1. Vista `vw_estado_actual_salas`
-- Selecciona siempre la ventana con hora verificable (`timestamp`) MÁS RECIENTE de cada sala activa,
-- ignorando entidades retiradas lógicamente y paquetes atrasados retransmitidos.
-- Alimenta: /dashboard, /sectores/:id, /edificios/:id, /pisos/:id y GET /salas/{salaId}/estado
CREATE OR REPLACE VIEW vw_estado_actual_salas AS
SELECT
    sec.id              AS "sectorId",
    sec.nombre          AS "sectorNombre",
    edf.id              AS "edificioId",
    edf.nombre          AS "edificioNombre",
    p.id                AS "pisoId",
    p.nombre            AS "pisoNombre",
    p.nivel             AS "pisoNivel",
    s.id                AS "salaId",
    s.nombre            AS "salaNombre",
    s."capacidadOcupantes",
    n.id                AS "nodoId",
    n.estado            AS "nodoEstado",
    n.firmware          AS "nodoFirmware",
    n."ultimaTelemetria",
    t."timestamp"       AS "ventanaTimestamp",
    t."versionReglas",
    t."conteosValidos",
    t.co2,
    t.pm25,
    t.pm10,
    t.temperatura,
    t.humedad,
    t."icaiScore",
    t."icaiCategoria",
    t."icaiEstado",
    t."causasICAI",
    t."ictScore",
    t."ictCategoria",
    t."ictEstado",
    t."causasICT",
    t."icgScore",
    t."icgCategoria",
    t."icgEstado",
    t."causasICG",
    t."celdaMatriz",
    t.recomendaciones
FROM salas s
JOIN pisos p        ON p.id = s."pisoId"
JOIN edificios edf  ON edf.id = p."edificioId"
JOIN sectores sec   ON sec.id = edf."sectorId"
LEFT JOIN nodos n   ON n."salaId" = s.id
LEFT JOIN LATERAL (
    SELECT *
      FROM telemetria tl
     WHERE tl."salaId" = s.id
     ORDER BY tl."timestamp" DESC
     LIMIT 1
) t ON TRUE
WHERE s."retiradoEn" IS NULL AND p."retiradoEn" IS NULL
  AND edf."retiradoEn" IS NULL AND sec."retiradoEn" IS NULL;

-- 7.2. Vista `vw_catalogo_firmwares`
-- Alimenta el Gestor de Versiones en `/nodos` mostrando cada versión (ordenable de la más vieja
-- a la más nueva por `createdAt`) junto con la cantidad de nodos que la tienen instalada.
CREATE OR REPLACE VIEW vw_catalogo_firmwares AS
SELECT
    f.id,
    f.version,
    f."versionReglas",
    f."nombreArchivo",
    f."rutaArchivo",
    f."tamanoBytes",
    f.sha256,
    f.estado,
    f.changelog,
    f."subidoPor",
    u.nombre AS "subidoPorNombre",
    f."createdAt",
    COUNT(n.id)::INTEGER AS "nodosInstalados"
FROM firmwares f
LEFT JOIN usuarios u ON u.id = f."subidoPor"
LEFT JOIN nodos n    ON n."firmwareId" = f.id OR n.firmware = f.version
GROUP BY f.id, u.nombre;

-- 7.3. Vista `vw_particulas_24h_oms`
-- Alimenta la tarjeta informativa separada en `/salas/:salaId` (Sección 6.5.3.5 y 6.6.3):
-- Calcula la media de las últimas 24 horas de PM2.5 y PM10 por sala y verifica si cuenta
-- con al menos el 80 % de las 288 ventanas teóricas de 5 minutos (>= 230 ventanas válidas),
-- comparando de forma informativa con las guías OMS de 24 h (15 ug/m3 y 45 ug/m3).
CREATE OR REPLACE VIEW vw_particulas_24h_oms AS
SELECT
    s.id AS "salaId",
    COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL)::INTEGER AS "ventanasValidasPm25_24h",
    COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL)::INTEGER AS "ventanasValidasPm10_24h",
    CASE
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL) >= 230
        THEN ROUND(AVG(t.pm25)::numeric, 2)::DOUBLE PRECISION
        ELSE NULL
    END AS "media24hPm25",
    CASE
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL) >= 230
        THEN ROUND(AVG(t.pm10)::numeric, 2)::DOUBLE PRECISION
        ELSE NULL
    END AS "media24hPm10",
    15.0::DOUBLE PRECISION AS "referenciaOms24hPm25",
    45.0::DOUBLE PRECISION AS "referenciaOms24hPm10",
    CASE
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL) >= 230
         AND COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL) >= 230
        THEN 'completo'
        WHEN COUNT(t."timestamp") FILTER (WHERE t.pm25 IS NOT NULL) >= 230
          OR COUNT(t."timestamp") FILTER (WHERE t.pm10 IS NOT NULL) >= 230
        THEN 'parcial'
        ELSE 'dato_insuficiente'
    END AS "estadoSerie24h"
FROM salas s
LEFT JOIN telemetria t
       ON t."salaId" = s.id
      AND t."timestamp" > NOW() - INTERVAL '24 hours'
GROUP BY s.id;

COMMIT;
