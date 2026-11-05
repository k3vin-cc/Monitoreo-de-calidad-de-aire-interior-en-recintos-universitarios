# Migraciones de instalaciones existentes

Los archivos `2026-*.sql` registran cambios sucesivos posteriores a las primeras instalaciones: IDs automáticos, unicidad de nombres activos, retiro de lugares y nodos, firmware persistente, pausas Telegram y deduplicación de alertas. Algunos ya fueron incorporados en `contenido/base de datos/schema_timescaledb.sql`, por lo que **no forman una lista de comandos para ejecutar tras crear una base nueva**.

![Modelo entidad-relación de referencia para las migraciones](../../contenido/base%20de%20datos/diagramas/diagrama_base_datos.png)

Para actualizar: (1) identifica las columnas, índices, funciones y triggers presentes; (2) respalda con `pg_dump -Fc` fuera del repositorio; (3) compara la instalación con la migración candidata; (4) aplícala primero a una copia de prueba con `psql -v ON_ERROR_STOP=1 -f <MIGRACION>`; (5) comprueba las consultas y flujos del API; (6) programa su aplicación a la base objetivo. No edites un SQL ya aplicado: añade otro archivo fechado. Guarda un registro externo de cuáles se aplicaron; este repositorio no incluye una tabla ni un ejecutor automático de versiones de migración.

Una migración con `IF NOT EXISTS` puede depender de columnas previas o redefinir funciones; lee el archivo completo antes de ejecutarlo. Los respaldos y volcados de telemetría contienen información operacional y no deben subirse a Git.
