-- 006 · Catálogo consolidado: la sala de procedimientos (cirugía menor) como tipo de sala, para el
-- injerto capilar, el lipoláser y las cirugías íntimas ambulatorias. La clínica dirá si la tiene;
-- mientras, esos tratamientos van en la sala que marque en «Cabinas y tratamientos». El valor nuevo
-- va al final de la lista: los que ya había no cambian.
-- (En PostgreSQL el tipo de sala es TEXT con un CHECK: se cambia la lista del CHECK.)

ALTER TABLE salas
  DROP CONSTRAINT salas_tipo_chk,
  ADD CONSTRAINT salas_tipo_chk CHECK (tipo IN ('consulta_medica','cabina_estetica','cabina_aparatologia','quirofano','sala_capilar','head_spa','otra','sala_procedimientos'));

ALTER TABLE tratamientos
  DROP CONSTRAINT tratamientos_sala_tipo_chk,
  ADD CONSTRAINT tratamientos_sala_tipo_chk CHECK (sala_tipo IN ('consulta_medica','cabina_estetica','cabina_aparatologia','quirofano','sala_capilar','head_spa','otra','sala_procedimientos'));
