-- Baseline migration (Phase 1).
-- Intentionally contains no schema objects: it proves the migration pipeline
-- (`prisma migrate deploy`) works against PostgreSQL before any model exists.
-- The first real schema change is Phase 2 (User, Session).
SELECT 1;
