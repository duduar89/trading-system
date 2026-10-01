# El porte a PostgreSQL: qué cambió y cómo se escribe el SQL ahora

La app nació sobre MariaDB. Para publicarla en Supabase (PostgreSQL) y Vercel se portó entera; la
última versión sobre MariaDB es el commit `36d3cfc`. Este documento es el contrato: lo que hace la capa
de base de datos (`servidor/db.js`), lo que PostgreSQL hace distinto y cómo se escribe cada cosa.

## 1. `servidor/db.js`: la forma de mysql2 sobre pg

El código sigue escribiendo `const [filas] = await pool.query(sql, params)` con marcadores `?`. Lo que
hay detrás:

| Lo que hace | Cómo |
|---|---|
| `?` → `$1, $2…` | `servidor/db-sql.js` (`adaptarSql`, pura y con caché). Respeta textos `'…'`, identificadores `"…"`, comentarios y `$$…$$`. |
| Listas y filas | `IN (?)` con un array → `IN ($1, $2, $3)`; `VALUES ?` con un array de arrays → `($1, $2), ($3, $4)`. Un array vacío es un error (antes, SQL inválido). |
| `SET ?` con un objeto | `UPDATE t SET ? …` → `"a" = $1, "b" = $2`; `INSERT INTO t SET ?` → `(…) VALUES (…)`. Solo nombres de columna en minúsculas y guiones bajos. |
| `? IS NULL` | pasa a `$1::text IS NULL` (PostgreSQL no sabe el tipo de un parámetro que solo se compara con NULL). |
| Parámetros | `undefined` es un error (usa `null`); faltar o sobrar parámetros, también. Las fechas viajan en ISO 8601 UTC. |
| Resultado de un SELECT | `[filas, campos]`, como siempre. |
| Resultado de INSERT, UPDATE y DELETE | `[{ insertId, affectedRows, changedRows, warningStatus: 0 }]`. `insertId`: db.js añade `RETURNING id` a los INSERT en tablas con columna `id` generada (lo mira en el catálogo una vez por pool); con varias filas, el primero; sin columna `id`, 0. |
| `RETURNING` escrito a mano | devuelve `[filas]`. |
| Tipos | `bigint` → número (error si no cabe); `numeric` → cadena (como DECIMAL); `boolean` → `1` o `0`; `timestamptz` → `Date`; `date` → `Date` a medianoche UTC; `time` → cadena; `json`/`jsonb` → cadena (el código hace `JSON.parse`). |
| Errores | `servidor/db-errores.js`: `23505` → `code: 'ER_DUP_ENTRY', errno: 1062`; `23503` → `ER_ROW_IS_REFERENCED_2` (1451, al borrar un padre) o `ER_NO_REFERENCED_ROW_2` (1452, al apuntar a algo que no existe); `40P01`/`40001` → `ER_LOCK_DEADLOCK`; `55P03` → `ER_LOCK_WAIT_TIMEOUT`; `22001` → `ER_DATA_TOO_LONG`; `23502` → `ER_BAD_NULL_ERROR`. Siempre quedan `pgCode` y `sqlState` con el SQLSTATE original. |
| Transacciones | `getConnection()`, `beginTransaction()`, `commit()`, `rollback()`, `release()` y `db.transaccion(fn)`, igual. Dentro de una transacción cada INSERT, UPDATE o DELETE va en un SAVEPOINT: un error (clave repetida…) se puede capturar y seguir, como en MariaDB (en PostgreSQL, sin esto, la transacción queda rota). Una conexión devuelta con la transacción abierta no vuelve al pool: se cierra y se deshace. |
| Bloqueos | `con.bloquear('clave', …)` = `pg_advisory_xact_lock` (de transacción, en orden fijo). `con.savepoint(fn)` para un trozo que se deshace entero. |
| Conexión | `DATABASE_URL` o `DB_HOST`, `DB_PORT` (5432), `DB_USER`, `DB_PASSWORD`, `DB_NAME`. TLS verificado para cualquier host que no sea localhost (`servidor/db-ssl.js`; la CA de Supabase va en `servidor/certs/`). `DB_SSL=disable` solo vale en localhost. No existe `rejectUnauthorized: false`. |
| Pooler de Supabase | Compatible con el modo transacción (puerto 6543): sin `SET` de sesión, sin sentencias preparadas con nombre, sin bloqueos de sesión. El tiempo máximo por sentencia (`DB_STATEMENT_TIMEOUT_MS`, 30 s) se pone con `SET LOCAL` en cada transacción. Las migraciones usan un bloqueo de sesión: van por conexión directa o por el pooler en modo sesión (`DATABASE_URL_MIGRACIONES`). |

Lo que db.js NO hace: no traduce funciones de MariaDB (`IF()`, `IFNULL`, `FIELD`…), ni
`ON DUPLICATE KEY UPDATE`, ni `INSERT IGNORE`, ni `LAST_INSERT_ID()`. Eso se escribe en PostgreSQL.

## 2. En MariaDB hacías X; ahora haz Y

| MariaDB | PostgreSQL |
|---|---|
| `INSERT … ON DUPLICATE KEY UPDATE a = VALUES(a)` | `INSERT … ON CONFLICT (clave) DO UPDATE SET a = EXCLUDED.a`. Hay que nombrar la clave única (`(codigo)`, `(nombre, idioma)`…). Para referirse a la fila que ya estaba: `tabla.a`. |
| `INSERT IGNORE` | `INSERT … ON CONFLICT DO NOTHING` (`affectedRows` es 0 si no insertó). |
| `ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)` (devolver el id del que ya estaba) | `ON CONFLICT (clave) DO UPDATE SET id = tabla.id` (y `insertId` trae el id gracias al `RETURNING id`). |
| `IF(cond, a, b)` | `CASE WHEN cond THEN a ELSE b END`. |
| `IFNULL(a, b)` | `COALESCE(a, b)`. |
| `a <=> b` | `a IS NOT DISTINCT FROM b`. |
| `FIELD(x, 'a', 'b', 'c')` (orden fijo) | `array_position(ARRAY['a', 'b', 'c'], x)`. |
| `GROUP_CONCAT(x)` | `string_agg(x, ',')` (y `string_agg(x, ',' ORDER BY x)` si el orden importa). |
| `UPDATE t JOIN u ON … SET …` | `UPDATE t SET … FROM u WHERE t.x = u.x AND …`. |
| `DELETE/UPDATE … ORDER BY … LIMIT n` | subconsulta con la clave: `… WHERE id IN (SELECT id FROM t WHERE … ORDER BY … LIMIT n)` (y `FOR UPDATE SKIP LOCKED` en la subconsulta si es una cola). |
| `SELECT … FROM DUAL WHERE NOT EXISTS (…)` | sin `FROM DUAL`. |
| `NOW()`, `CURRENT_TIMESTAMP` | `now()` (instante de la transacción, en UTC al leerlo). Para la lógica de negocio, el código no usa `now()`: la hora entra por el parámetro `ahora`. |
| `DATE_ADD(x, INTERVAL n MINUTE)` | `x + make_interval(mins => n)` o `x + (? \|\| ' minutes')::interval`; mejor, calcular la fecha en JavaScript y pasarla. |
| `TIMESTAMPDIFF(MINUTE, a, b)` | `EXTRACT(EPOCH FROM (b - a)) / 60`. |
| `DATE(x)` en hora de Madrid | nunca en SQL: `motor/tiempo.js` (`fechaMadrid`). |
| `x = 1` sobre un booleano | `x` o `x = TRUE` (comparar un boolean con un entero es un error). |
| `SHOW TABLES`, `DATABASE()`, `@@session.x` | `pg_tables` / `information_schema.tables`, `current_database()`, `current_setting('x')`. |
| `information_schema.COLUMNS … TABLE_SCHEMA = DATABASE()` | `information_schema.columns … table_schema = current_schema()` (minúsculas). |
| Comillas invertidas en identificadores | comillas dobles, o nada (todo va en minúsculas). |
| `JSON_EXTRACT(col, '$.a')` | el JSON es texto: `col::jsonb ->> 'a'`. |
| `LIMIT ?, ?` | `LIMIT ? OFFSET ?`. |
| División de enteros `7 / 2` = 3,5 | en PostgreSQL es 3: `7::numeric / 2` o `7.0 / 2`. |
| `GROUP BY t.id` y leer `t.nombre` | o se agrupa por todas las columnas que se leen, o `GROUP BY t.id` siendo `id` la clave primaria (eso sí vale). |
| `ORDER BY col` con NULL | en MariaDB los NULL salen primero en ASC; en PostgreSQL, al final. Donde importe: `NULLS FIRST` / `NULLS LAST`. |
| `SELECT ?` con un parámetro sin tipo que se opera | a veces hace falta `?::int`, `?::text`, `?::timestamptz`: PostgreSQL no adivina el tipo de `? + 1` o de `? IS NULL`. |

## 3. Mayúsculas y tildes

MariaDB (`utf8mb4_unicode_ci`) comparaba `=`, `IN`, `LIKE` y las claves únicas sin distinguir
mayúsculas ni tildes. PostgreSQL distingue las dos cosas. Decisión por tipo de columna:

| Columna | Decisión |
|---|---|
| Emails (`usuarios.email`, `pacientes.email`, `leads.email`, `invitaciones.email`) | Se guardan en minúsculas (lo normaliza el código al guardar) y la clave única y los índices van sobre `lower(email)` (`usuario_email`, `paciente_email`, `lead_email`). Al buscar: `lower(email) = lower(?)`. |
| Teléfonos | Siempre normalizados a E.164 (`+34…`) antes de guardar y de buscar: comparación exacta. |
| Códigos (`tratamientos.id`, `salas.codigo`, `profesionales.codigo`, `equipos.codigo`, `familias.codigo`, `ofertas.codigo`, `plantillas.nombre`, estados, tipos) | Son identificadores que escribe el código o las semillas, siempre en minúsculas y con guiones: comparación exacta. |
| Textos que ve una persona y se buscan (`tratamientos.nombre`, `pacientes.nombre` y `apellidos`, preguntas de `respuestas_aprobadas`) | Al buscar: `lower(col) LIKE lower(?)`, o `unaccent(lower(col))` si la búsqueda es con tildes (la extensión `unaccent` está en Supabase y en PostgreSQL: `CREATE EXTENSION IF NOT EXISTS unaccent` en la migración que la necesite). Hoy ninguna consulta de la app busca por nombre de persona con LIKE; las de tratamientos pasan por el motor (JavaScript). |
| Tokens, huellas y claves (`citas.token_hash` (la huella del token de «Tu cita», en BYTEA), `passkeys.credencial_id`, `webhooks.id_externo`, `clave_unica` de la cola) | Exactos, y así tiene que ser: una huella en mayúsculas no es la misma. En MariaDB era un riesgo (dos tokens que solo cambian en mayúsculas chocaban); en PostgreSQL no. |

## 4. Concurrencia

PostgreSQL no tiene bloqueos de hueco (gap locks) y trabaja en `READ COMMITTED`. Donde en MariaDB
bastaba `REPEATABLE READ` para que dos reservas del mismo hueco no se cruzaran, ahora se serializa a
propósito:

- **Un hueco de agenda** (sala, profesional y aparato en un rango de horas): dentro de la transacción,
  `con.bloquear('sala:ID', 'profesional:ID', 'equipo:ID')` (orden fijo, sin interbloqueo) y después
  comprobar solapes e insertar. La prueba «diez reservas a la vez → una» lo cubre con conexiones reales.
- **Lista de espera** (un hueco nunca a dos personas): `SELECT … FOR UPDATE` de la fila del hueco
  ofrecido, o `bloquear('espera:TRATAMIENTO')`.
- **Retos de passkeys**: `DELETE … WHERE reto = ?` y mirar `affectedRows` (quien borra, gana).
- **Cola y candados**: `FOR UPDATE SKIP LOCKED` y `INSERT … ON CONFLICT`, igual que antes.
- **Interbloqueos**: PostgreSQL los detecta (`40P01`) y db.js los traduce a `ER_LOCK_DEADLOCK`: los
  reintentos que ya había (`acceso.js`, `leads.js`) siguen valiendo.

## 5. El esquema

- Fechas y horas: `TIMESTAMPTZ`, siempre en UTC. Un día suelto, `DATE`; la hora del reloj, `TIME`.
- `ENUM` → `TEXT` con `CHECK (col IN (…))`. `JSON` → `TEXT` con `CHECK` de JSON válido.
- `AUTO_INCREMENT` → `GENERATED BY DEFAULT AS IDENTITY`, con un disparador (`avanzar_identidad`) que
  sube la secuencia cuando se inserta un id a mano (semillas y pruebas), como hacía MariaDB.
- `ON UPDATE CURRENT_TIMESTAMP` → disparador `set_actualizado_en()`.
- Índices con nombre único en todo el esquema (prefijo de la tabla) y los de las claves ajenas escritos.
- RLS activada en todas las tablas y sin políticas (`sql/018-seguridad-supabase.sql`): la app entra con
  el rol propietario, que se salta RLS; los roles `anon` y `authenticated` de la API de datos de
  Supabase no pueden leer ni escribir nada, tampoco en tablas creadas después. Toda tabla nueva lleva
  `ENABLE ROW LEVEL SECURITY` en su migración (`test/migraciones.test.js` lo exige).

## 6. El reloj en las pruebas

MariaDB permitía `SET timestamp` para fijar `NOW()` en una sesión. En PostgreSQL no existe. Cada base
de pruebas lleva un reloj propio (`test/ayuda-bd.js`): los `DEFAULT now()` y `set_actualizado_en()`
leen `reloj.ahora()`, que da la hora real mientras nadie la fije; `fijarRelojBd(pool, fecha)` la
congela para todas las conexiones y `liberarRelojBd(pool)` la suelta. La regla sigue siendo que la
lógica de negocio no mira `now()`: la hora entra por el parámetro `ahora`.

## 7. Qué comprobar al portar una consulta

1. Ejecutar la prueba que la cubre; si no la cubre ninguna, escribirla.
2. Pasar la lista de la sección 2 sobre el texto.
3. Mirar si compara texto que una persona escribe (sección 3).
4. Mirar si dos peticiones a la vez podrían cruzarse (sección 4).
5. `ORDER BY` con columnas que pueden ser NULL, divisiones y `GROUP BY`.
6. `node --test` del fichero y `npx eslint` sobre lo tocado.
