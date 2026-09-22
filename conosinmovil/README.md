# Con o sin móvil — web

Rediseño de [conosinmovil.com](https://www.conosinmovil.com/): servicio técnico de reparación de móviles, ordenadores y tablets en Boadilla del Monte (Madrid).

Es una web **estática** (HTML + CSS + JS sin dependencias ni paso de compilación). Se puede subir tal cual a cualquier hosting (IONOS, Netlify, Cloudflare Pages, GitHub Pages…).

## Qué incluye

| Sección | Contenido |
|---|---|
| Hero | Película que se controla con el scroll: al bajar, el móvil se desarma pieza a pieza y se vuelve a armar; al subir, hace el recorrido inverso. Tres mensajes: cambio de pantalla en 1 hora, pantallas originales, garantía de 3 meses + protector de regalo. |
| Cifras | +11 años de experiencia, +15k reparaciones, 1 h (iPhone), 3 meses de garantía. |
| Servicios | Móviles (la pantalla rota se repara), ordenadores (el portátil se abre y se enciende), tablets (la pantalla se asienta y se enciende) —cada clip se anima con el scroll— y accesorios. |
| Precios | Los 44 precios reales de cambio de pantalla (iPhone, Samsung, Xiaomi, Oppo) con pestañas y buscador. |
| Por qué nosotros | Rapidez, garantía, calidad, protector de regalo y cómo funciona. |
| Contacto | Formulario (abre el correo del cliente con el mensaje preparado para conosinmovil@gmail.com), teléfono, email, dirección y mapa de Google que solo se carga con el consentimiento del usuario. |
| Legal | `politica-de-privacidad/` con el texto de la web original. |

Las URL antiguas `/reparacion-movil/` y `/contacto/` redirigen a su sección nueva, así que no se pierden enlaces ni posicionamiento.

## Imágenes y vídeos

Generados con Higgsfield:

- **GPT Image 2.5** (calidad alta, 2K): móvil con la pantalla rota, el mismo móvil reparado, despiece de un móvil, portátil, tablet abierta y accesorios.
- **Seedance 2.0** (modo *fast*, 720p): el despiece del móvil que se ensambla (5 s), la pantalla rota que se repara (12 s, usando las dos imágenes como fotograma inicial y final), el portátil y la tablet (5 s cada uno).
- La película del hero (móvil que se desarma y se arma, 10 s) se monta a partir del clip del despiece: primero invertido y después hacia delante, sobre un lienzo 16:9 (escritorio) y 4:5 (móvil) con bordes difuminados.

Cada vídeo está codificado dos veces (`.mp4` H.264 y `.webm` VP9), en versión escritorio y móvil, con fotogramas clave muy seguidos para que avanzar y retroceder con el scroll sea fluido. El navegador elige el formato automáticamente.

## Probar en local

```bash
cd conosinmovil
python3 -m http.server 8080
# abrir http://localhost:8080
```

(Abrir `index.html` directamente con doble clic también funciona, pero es mejor con un servidor.)

## Publicar

1. Sube **todo el contenido** de la carpeta `conosinmovil/` a la raíz del dominio (donde ahora está el WordPress de IONOS), incluido el archivo oculto `.htaccess`.
2. `.htaccess` (servidores Apache, como IONOS) hace redirecciones permanentes 301 de las direcciones antiguas (`/reparacion-movil/`, `/contacto/`, `/wp-sitemap.xml`), declara los tipos de archivo de vídeo, imagen y tipografía y activa la caché. En otros hostings, las carpetas `reparacion-movil/` y `contacto/` redirigen igualmente desde el navegador.
3. En Google Search Console, retira el sitemap antiguo de WordPress y envía `https://www.conosinmovil.com/sitemap.xml`.

## Formulario y privacidad

- El formulario no necesita servidor: al enviarlo se abre la aplicación de correo del cliente con el mensaje ya escrito para `conosinmovil@gmail.com` (y se ofrece copiarlo si no tiene correo configurado). Si más adelante quieres recibirlo directamente, se puede conectar a un servicio de formularios.
- La web no usa cookies de seguimiento ni analítica. El mapa de Google solo se carga si el visitante lo pide, y puede ocultarlo de nuevo.
- La política de privacidad conserva el texto de la web anterior, que cita la antigua LOPD 15/1999. Conviene que un asesor la actualice al RGPD y a la LOPDGDD 3/2018; ya se ha añadido un apartado con los derechos del usuario.

## Editar contenidos

- Textos y precios: `index.html` (los precios están en la sección `id="precios"`, una línea por modelo).
- Colores y tipografías: variables al principio de `assets/css/styles.css`.
- Teléfono / email: buscar `693852019`, `693 85 20 19` y `conosinmovil@gmail.com` en `index.html` y `politica-de-privacidad/index.html`.
