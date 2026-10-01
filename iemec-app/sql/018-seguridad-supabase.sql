-- 018 · Seguridad para Supabase: la API de datos de Supabase (PostgREST, con los roles anon y
-- authenticated) no puede ver ni tocar nada de esta base. La app entra con el rol propietario de la
-- conexión, que se salta RLS y tiene todos los permisos; la API de datos no se usa y tiene que quedar
-- cerrada, porque en Supabase las tablas de public nacen abiertas a esos dos roles.
--
-- 1. RLS activado en TODAS las tablas del esquema public (también _migraciones), sin ninguna política:
--    para un rol que no es propietario, sin política no hay filas visibles ni escribibles.
-- 2. Quitados a anon y authenticated todos los permisos sobre tablas, secuencias y funciones de public,
--    y lo mismo para lo que se cree después (ALTER DEFAULT PRIVILEGES). Las funciones, además, sin el
--    EXECUTE que PostgreSQL da a PUBLIC (que incluye a esos roles).
--
-- Esos roles solo existen en Supabase: en un PostgreSQL normal (el del portátil, el de las pruebas) el
-- punto 2 no hace nada y no falla. Cada REVOKE se protege solo contra un rol que desaparezca en medio.
-- Quien añada una tabla nueva en una migración tiene que ponerle ENABLE ROW LEVEL SECURITY (test/migraciones.test.js
-- lo comprueba para todas las tablas).

DO $$
DECLARE
  tabla record;
BEGIN
  FOR tabla IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla.relname);
  END LOOP;
END
$$;

DO $$
DECLARE
  rol text;
  sentencia text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol);
    FOREACH sentencia IN ARRAY ARRAY[
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I',
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I',
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I'
    ] LOOP
      BEGIN
        EXECUTE format(sentencia, rol);
      EXCEPTION WHEN undefined_object THEN
        NULL; -- el rol se ha borrado entre la comprobación y el REVOKE
      END;
    END LOOP;
  END LOOP;

  -- PostgreSQL da EXECUTE a PUBLIC (todos los roles, también anon y authenticated) sobre cada función
  -- nueva: sin quitarlo, la API de datos podría llamarlas (RPC). El propietario no lo necesita.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) THEN
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  END IF;
END
$$;
