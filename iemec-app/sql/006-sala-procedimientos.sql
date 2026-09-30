-- 006 · Catálogo consolidado: la sala de procedimientos (cirugía menor) como tipo de sala, para el
-- injerto capilar, el lipoláser y las cirugías íntimas ambulatorias. La clínica dirá si la tiene;
-- mientras, esos tratamientos van en la sala que marque en «Cabinas y tratamientos». El valor nuevo
-- va al final de la lista: los que ya había no cambian.

ALTER TABLE salas
  MODIFY COLUMN tipo ENUM('consulta_medica','cabina_estetica','cabina_aparatologia','quirofano','sala_capilar','head_spa','otra','sala_procedimientos') NOT NULL;

ALTER TABLE tratamientos
  MODIFY COLUMN sala_tipo ENUM('consulta_medica','cabina_estetica','cabina_aparatologia','quirofano','sala_capilar','head_spa','otra','sala_procedimientos') NULL;
