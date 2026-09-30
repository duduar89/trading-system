# Aviso legal

> **Borrador para revisión** (abogado sanitario y delegado de protección de datos) · 30-09-2026.
> Los huecos `[PENDIENTE: …]` se rellenan con la clínica; qué es imprescindible y qué se publica
> mientras tanto con una redacción neutra está en `web/datos/lanzamiento.json`
> (`node web/construir.js --publicar` no publica nada imprescindible sin rellenar).
> Lo que va entre llaves dobles (correo, profesionales, fechas) lo pone el generador desde
> `web/datos/sitio.json`, `web/datos/equipo.json` y `web/datos/lanzamiento.json`.
> Fuentes de los datos: [aviso legal de iemec-clinic.com](https://iemec-clinic.com/aviso-legal)
> (10-05-2024), `iemec-app/semillas/iemec/clinica.json`, el
> [Registro de centros sanitarios de la Comunidad de Madrid](https://gestiona.comunidad.madrid/cyes_web_reg/TipoCentro.icm)
> (ficha CS17886, consultada el 30-09-2026: «Avenida Siglo Xxi Nº 13, Piso/Puerta PTA 35 -36») y el
> BORME (constitución: núm. 49, 11-03-2020, anuncio 112305, «Domicilio: CALLE MORELLA Número6 2
> (BOADILLA DEL MONTE)… Datos registrales. T 40334, F 7, S 8, H M 716525, I/A 1»; sin cambios de
> domicilio publicados en los actos de 2021 y 2025).
> Lo que cambia respecto al aviso actual: quita la web ajena que cita hoy como titular y el
> Gmail, corrige el prefijo del teléfono y el «local 35 y 35», y añade el domicilio social y los datos
> del Registro Mercantil, la autorización sanitaria, las profesiones reguladas y la ayuda del FSE+.

---

## 1. Quiénes somos

En cumplimiento del artículo 10 de la Ley 34/2002, de servicios de la sociedad de la información y
de comercio electrónico (LSSI), estos son los datos del titular de esta web:

| | |
|---|---|
| **Titular** | Aneco AP Consulting, S.L.U. (sociedad limitada unipersonal) |
| **Nombre comercial** | Instituto Europeo de Medicina Estética y Capilar (IEMEC) |
| **NIF** | B88613492 |
| **Domicilio social** | Calle Morella, 6, 2, Boadilla del Monte (Madrid) |
| **Centro sanitario** | Avenida Siglo XXI, 13, local 35, 28660 Boadilla del Monte (Madrid). En el Registro de centros sanitarios figura como puerta 35-36 |
| **Teléfono y WhatsApp** | +34 722 83 32 85 |
| **Correo electrónico** | {{correo}} |
| **Registro Mercantil** | Inscrita en el Registro Mercantil de Madrid, tomo 40334, folio 7, sección 8.ª, hoja M-716525, inscripción 1.ª |
| **Web** | https://iemec-clinic.com |

## 2. Centro sanitario autorizado

IEMEC es un **centro sanitario autorizado por la Consejería de Sanidad de la Comunidad de Madrid**
e inscrito en el Registro de Centros, Servicios y Establecimientos Sanitarios de la Comunidad de
Madrid con el **número CS17886**, como «otros centros especializados» (C.2.5.90).

Su oferta asistencial autorizada comprende: U.46 Cirugía plástica y reparadora, U.47 Cirugía
estética, U.48 Medicina estética, U.64 Cirugía menor ambulatoria, U.84 Depósito de medicamentos y
U.900 Otras unidades asistenciales `[PENDIENTE: qué actividad concreta cubre la U.900 según la resolución de autorización]`.

Órgano competente y de supervisión: Consejería de Sanidad de la Comunidad de Madrid, Dirección
General de Inspección y Ordenación Sanitaria. Puedes comprobar la autorización en el
[buscador de centros sanitarios autorizados](https://www.comunidad.madrid/salud/registro-centros-servicios-establecimientos-sanitarios)
de la Comunidad de Madrid.

{{responsable_asistencial}}

## 3. Profesiones sanitarias

La medicina y las demás profesiones sanitarias son profesiones reguladas. Los profesionales
sanitarios de IEMEC están sujetos a:

- la [Ley 44/2003, de ordenación de las profesiones sanitarias](https://www.boe.es/buscar/act.php?id=BOE-A-2003-21340);
- la [Ley 41/2002, básica reguladora de la autonomía del paciente](https://www.boe.es/buscar/act.php?id=BOE-A-2002-22188);
- el [Código de Deontología Médica](https://www.cgcom.es/sites/main/files/files/2022-03/codigo_deontologia_medica.pdf)
  del Consejo General de Colegios Oficiales de Médicos (2022);
- los estatutos de su Colegio de Médicos `[PENDIENTE: enlace a los estatutos del colegio de cada médico, p. ej. el de Madrid]`.

Título académico oficial, colegio y número de colegiado de cada profesional sanitario que nombra
esta web (también en la página «Equipo»):

{{profesionales}}

> Nota para quien rellena: «especialista» solo se escribe si la persona tiene el título oficial de
> especialista (Ley 44/2003, art. 16.3). La medicina estética no es una especialidad oficial: se
> indica como formación («máster en Medicina Estética por…»). Los datos de cada persona van en
> `web/datos/equipo.json` (título, especialidad, colegio, número y, si el título es extranjero, el
> Estado que lo expidió y su homologación o reconocimiento).

Códigos de conducta: `[PENDIENTE: indicar si IEMEC está adherida a alguno y cómo consultarlo]` (LSSI, art. 10.1.g).

## 4. Uso de la web

Esta web informa sobre los servicios de IEMEC y permite pedir información o cita. Usarla no te
cuesta nada, salvo tu conexión. Al usarla te comprometes a hacerlo de forma lícita y a no
dañar su funcionamiento.

**La información de esta web es general y no sustituye la valoración de un profesional
sanitario.** Cada tratamiento se indica, o no, tras una consulta, y los resultados dependen de cada
persona. **Esta web y sus formularios no son un canal de urgencias: si tienes una urgencia médica,
llama al 112.**

Podemos cambiar el contenido de la web cuando haga falta. La fecha de la última versión de este
aviso figura al final.

## 5. Propiedad intelectual

Los textos, el diseño, el logotipo y las imágenes propias de esta web son de Aneco AP Consulting,
S.L.U. o se usan con licencia. Puedes consultarlos e imprimirlos para uso personal; para cualquier
otro uso necesitas nuestra autorización por escrito. Las marcas de terceros, si aparecen, son de sus
titulares. El emblema de la Unión Europea se usa conforme a las normas de la Comisión Europea para
los beneficiarios de sus fondos.

## 6. Enlaces

La web enlaza con servicios de terceros (por ejemplo, WhatsApp o Google Maps) que tienen sus
propias condiciones y políticas de privacidad. IEMEC no controla esos servicios. Si detectas un
enlace que lleve a un contenido ilícito, avísanos y lo retiraremos.

## 7. Protección de datos y cookies

Cómo tratamos tus datos: [Política de privacidad](./privacidad.md). Qué guarda esta web en tu
dispositivo: [Política de cookies](./cookies.md).

## 8. Ayudas públicas

> Mientras dure la obligación de publicidad de la ayuda (Reglamento (UE) 2021/1060, arts. 47 y 50 y
> anexo IX), con el emblema oficial «Cofinanciado por la Unión Europea» en el pie de todas las
> páginas (`web/emblemas/`).

**FSE+ · Fondo Social Europeo Plus · «Cofinanciado por la Unión Europea».** De acuerdo con las
obligaciones de publicidad de la subvención recibida, informamos de que Aneco AP Consulting, S.L.U.
ha sido beneficiaria de una ayuda destinada a la contratación de una joven trabajadora, para
fomentar el empleo juvenil y mejorar sus oportunidades de inserción laboral.
`[PENDIENTE: convocatoria, organismo que concede la ayuda y fecha hasta la que hay que mantener este aviso]`

## 9. Reclamaciones, ley aplicable y tribunales

Si no estás conforme con algún servicio, puedes escribirnos a {{correo}} o pedir en la clínica una
hoja de reclamaciones. `[PENDIENTE: si IEMEC está adherida al arbitraje de consumo o a otra entidad de resolución alternativa de litigios]`

Este aviso se rige por la ley española. Si actúas como consumidor, serán competentes los juzgados
y tribunales de tu domicilio; en los demás casos, los que correspondan conforme a la ley.

> La plataforma europea de resolución de litigios en línea (ODR) se suprimió el 20-07-2025
> ([Reglamento (UE) 2024/3228](https://www.boe.es/buscar/doc.php?id=DOUE-L-2024-81952)): ya no
> hay que enlazarla.

## 10. Compra de tarjetas regalo

`[PENDIENTE: condiciones de compra de las tarjetas regalo, solo si vuelven a venderse en la web: precio final con impuestos, forma de pago, validez y canje, desistimiento de 14 días (TRLGDCU, arts. 97, 98, 102 y 103), confirmación del pedido (LSSI, arts. 27 y 28) y que no se canjean por medicamentos ni productos sanitarios como obsequio ni con ventajas de precio (RDLeg 1/2015, art. 80.5-80.6)]`

---

Última actualización: {{fecha_textos}}

---

## Anexo · Texto para la página «Accesibilidad» (recomendado)

**Accesibilidad.** Queremos que cualquier persona pueda usar esta web. La hemos diseñado para
cumplir las pautas WCAG 2.2 de nivel AA: textos con buen contraste, navegación con teclado,
formularios con etiquetas claras, imágenes con texto alternativo y diseño adaptado al móvil. Si
encuentras alguna barrera o necesitas la información en otro formato, escríbenos a {{correo}} o
llámanos al +34 722 83 32 85 y te ayudaremos. Última revisión: {{fecha_accesibilidad}}.
