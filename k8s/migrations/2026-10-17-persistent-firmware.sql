-- Conserva los binarios de firmware en el PVC ya asignado a PostgreSQL.
-- El backfill de archivos existentes se hace por separado y se verifica con SHA-256.
ALTER TABLE firmwares ADD COLUMN IF NOT EXISTS "contenido" BYTEA;
