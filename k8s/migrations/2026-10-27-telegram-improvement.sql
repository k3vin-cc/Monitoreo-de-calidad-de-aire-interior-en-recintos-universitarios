BEGIN;
ALTER TABLE telegram_avisos_enviados DROP CONSTRAINT IF EXISTS telegram_avisos_enviados_tipo_check;
ALTER TABLE telegram_avisos_enviados ADD CONSTRAINT telegram_avisos_enviados_tipo_check
    CHECK (tipo IN ('confirmada', 'mejoria', 'resuelta'));
COMMIT;
