BEGIN;

-- Identificadores internos generados por PostgreSQL; el firmware sigue recibiendo el ID del nodo.
ALTER TABLE sectores ALTER COLUMN id SET DEFAULT gen_random_uuid()::varchar;
ALTER TABLE edificios ALTER COLUMN id SET DEFAULT gen_random_uuid()::varchar;
ALTER TABLE pisos ALTER COLUMN id SET DEFAULT gen_random_uuid()::varchar;
ALTER TABLE salas ALTER COLUMN id SET DEFAULT gen_random_uuid()::varchar;
ALTER TABLE nodos ALTER COLUMN id SET DEFAULT gen_random_uuid()::varchar;

COMMIT;
