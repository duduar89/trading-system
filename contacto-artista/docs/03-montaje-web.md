# Montaje: de este repositorio al subdominio

Quince minutos si el subdominio ya existe. No hace falta instalar nada: el
proyecto no tiene dependencias.

---

## 1. Rellenar `config.js`

Es el único fichero que se toca. Todo lo demás se genera.

Lo que hay que poner y no se puede adivinar:

| Campo | Qué es |
|---|---|
| `artista.nombre`, `apellidos`, `nombreArtistico` | Cómo quiere que aparezca en la agenda de quien la guarde |
| `sitio` | El subdominio donde ya está la landing, sin barra final |
| `redes[].url` | Canal de WhatsApp, Instagram, Spotify… lo que exista. Lo vacío no se pinta |
| `artista.email` | Opcional, pero es el único canal que no depende de Meta |

El teléfono ya está puesto: `34620591728` para los enlaces y `+34 620 591 728`
para enseñarlo. Los mensajes, en `02-mensajes.md`.

Los avisos de `construir.js` no son decorativos: si dice que la URL sale larga,
el QR de la tarjeta pequeña va a costar de leer.

## 2. Generar

```bash
node herramientas/construir.js
```

Si falta algo en `config.js` no genera nada y dice qué falta. Cuando va bien,
escribe:

- `web/ajustes.js` — los textos y el número para la página
- `web/qr.js` — el generador, que la página del móvil necesita
- `web/contacto.vcf` — la ficha de contacto que se descarga
- `imprenta/qr-*.svg` — un QR por soporte, listo para la imprenta
- `imprenta/urls.txt` — las direcciones para grabar en los NFC

## 3. Subir

Todo el contenido de `web/` a una carpeta del subdominio. La carpeta tiene que
llamarse igual que `config.ruta` (por defecto `hola`), colgando de la raíz:

```
public_html/            ← la landing que ya existe, no se toca
└── hola/
    ├── index.html
    ├── estilo.css
    ├── puente.js
    ├── ajustes.js
    ├── qr.js
    ├── qr.html
    ├── privacidad.html
    ├── contacto.vcf
    └── contar.php      ← desde servidor/
```

Y para el contador:

```
hola/datos/            ← crear la carpeta, con permiso de escritura
hola/datos/.htaccess   ← el contenido de servidor/datos-htaccess.txt
```

Que el servidor sirva `.vcf` con el tipo correcto. Si al pulsar «guárdame» el
navegador enseña texto en vez de abrir la ficha de contacto, hay que añadir al
`.htaccess` de la carpeta:

```apache
AddType text/vcard .vcf
```

## 4. Probar, en este orden

0. **Comprobar que el número tiene cuenta activa de WhatsApp y en qué aplicación
   está.** Abrir `https://wa.me/34620591728` desde un móvil que no sea el de ella.
   Si sale «Phone number shared via url is invalid», no hay nada más que probar
   hasta arreglar eso. Parece obvio y es el primer sitio donde falla todo.
1. Abrir `https://SUBDOMINIO/hola/?f=tarjeta` en un móvil. Tiene que verse la página
   entera antes de un segundo.
2. Pulsar el botón verde: debe abrirse WhatsApp **con el mensaje ya escrito** y
   el número correcto.
3. Pulsar «guárdame»: debe ofrecer añadir el contacto.
4. Abrir `https://SUBDOMINIO/hola/qr.html`, escribir una sala y comprobar que sale
   el código.
5. Escanear ese código con **otro** móvil: tiene que llegar a la misma página con
   la sala dentro del mensaje.
6. Comprobar que `hola/datos/escaneos.csv` se ha creado y tiene líneas.
7. Comprobar que `https://SUBDOMINIO/hola/datos/escaneos.csv` da error 403. Si se
   descarga, el `.htaccess` no está puesto.
8. Abrir la página desde el navegador de Instagram (mandándose el enlace por
   mensaje directo y pulsándolo): tiene que salir el aviso de «estás dentro de
   otra aplicación».

Hasta que el punto 8 no salga bien, no se imprime nada.

---

## Si se prefiere servirlo desde el portal Node

El portal ya tiene `/r/:codigo` con conteo en base de datos. Encaja, y la
decisión de no usarlo está razonada en `01-analisis-metodos.md` (resumen: ata el
material impreso de ella a que la aplicación del portal esté levantada un sábado
por la noche).

Si aun así se centraliza:

1. Dar de alta un código por soporte en `tarjetas_qr`, con `destino_url`
   apuntando a `https://SUBDOMINIO/hola/?f=<soporte>` y `listo = 1`.
2. Poner en `config.sitio` y `config.ruta` la URL del redirector, y regenerar los
   QR.
3. Apagar `opciones.medir`: el conteo ya lo hace el portal y contarlo dos veces
   confunde más que no contarlo.

Lo que no se debe hacer nunca es tener unos soportes en un sitio y otros en otro.

---

## Si el QR sale demasiado grande

Ocurre cuando el subdominio es largo. Por orden de eficacia:

1. **Dominio más corto.** Es lo único que reduce de verdad el código. Cambiar
   `ruta` de `/hola/` a `/h/` ahorra tres caracteres y a veces baja una versión.
2. **Rutas en vez de parámetros.** Cambiar `?f=tarjeta` por `/t` quita los
   caracteres `?` y `=`, que obligan al código a usar el modo más pesado. Con la
   URL en mayúsculas (`HTTPS://ANA.ES/H/T`) entra en el modo compacto y el
   símbolo baja notablemente. Exige una carpeta por soporte con un
   `index.html` de una línea que redirija a `../?f=t`, o una regla de reescritura.
3. **Bajar de Q a M** solo si la pieza es pequeña y no lleva logo. Se pierde
   tolerancia a la suciedad y al reflejo.

El propio `construir.js` avisa cuando el código pasa de la versión 5.

---

## Mantenimiento

- **Cambiar el mensaje o un enlace:** tocar `config.js`, `node
  herramientas/construir.js`, subir `web/ajustes.js`. **No hay que reimprimir
  nada.** Eso es exactamente para lo que se montó así.
- **Cambiar el número de teléfono:** igual. Lo impreso sigue valiendo.
- **Cambiar de dominio:** eso sí obliga a reimprimir. La carpeta `/hola/` tiene que
  sobrevivir a cualquier rediseño de la landing: es infraestructura, no parte de
  la web.
