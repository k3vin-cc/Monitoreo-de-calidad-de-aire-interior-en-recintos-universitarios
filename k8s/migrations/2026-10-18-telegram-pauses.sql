-- Permite pausar temporalmente los avisos de una sala desde Telegram.
ALTER TABLE telegram_preferencias_salas
    ADD COLUMN IF NOT EXISTS "pausadoHasta" TIMESTAMPTZ;
