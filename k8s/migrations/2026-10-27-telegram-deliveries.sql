-- Estado exclusivo del bot. No modifica las reglas de alertas ni la telemetría.
BEGIN;
CREATE TABLE IF NOT EXISTS telegram_aviso_control (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    "desdeEn" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO telegram_aviso_control (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS telegram_avisos_enviados (
    "alertaId" VARCHAR(36) NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
    "chatId" BIGINT NOT NULL,
    tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('confirmada', 'mejoria', 'resuelta')),
    "enviadoEn" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY ("alertaId", "chatId", tipo)
);
COMMIT;
