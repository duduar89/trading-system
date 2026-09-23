# IO Sistemas Audiovisuales — nueva web

Rediseño de [iosistemasaudiovisuales.com](https://www.iosistemasaudiovisuales.com/), que hoy solo muestra la página «Próximamente».

Es una web estática (HTML, CSS y JavaScript sin dependencias). Funciona en cualquier hosting: el WordPress actual, GitHub Pages, Netlify, un servidor Apache o Nginx, etc.

## Verla en local

```bash
cd io-sistemas-web
python3 -m http.server 8080
# abre http://localhost:8080
```

También se puede abrir `index.html` con doble clic, pero algunas funciones del navegador (copiar el email) solo van con `http://` o `https://`.

## Qué incluye

| Sección | Qué hace |
|---|---|
| **Portada con película** | Una película de 7 s (de escenario a oscuras a show completo) que avanza al bajar y retrocede al subir. Cuatro capítulos de texto: Inicio, Sonido, Luz y Show. El fader «MASTER» de la derecha muestra el progreso, y sus botones saltan a cada capítulo. |
| **Quiénes somos** | La descripción de la propia empresa en Facebook. Sus palabras se van encendiendo con el scroll y se apagan al subir. |
| **Cinta** | Texto que se desplaza al hacer scroll y cambia de sentido según se baje o se suba. Se para sola cuando no hay scroll. |
| **Servicios** | Sonido, iluminación y técnica y producción, con imágenes en parallax. |
| **Eventos** | En pantallas grandes, galería horizontal que se desplaza con el scroll vertical (en ambos sentidos). En móvil, en pantallas bajas o sin animaciones, carrusel deslizable. |
| **Cómo trabajamos** | Cuatro pasos. La línea se llena al bajar y se vacía al subir. |
| **Trabajos** | Fotos reales de la empresa, sacadas de su propia biblioteca de medios. |
| **Contacto** | Email, botón para copiarlo, redes sociales y un formulario. El formulario abre el programa de correo del visitante con el mensaje ya redactado, así que no necesita servidor ni guarda datos. |
| **Aviso legal** | `aviso-legal.html`: aviso legal, privacidad y cookies. La web no usa cookies. |

También funciona con **«reducir movimiento»** activado (se muestra todo el contenido sin película), en pantallas muy bajas o con mucho zoom (texto apilado) y **sin JavaScript** (el formulario usa `mailto:` directamente).

Incluye `robots.txt`, `sitemap.xml`, `favicon.ico`, datos estructurados (JSON-LD), `.htaccess` para Apache y una tarjeta Open Graph/Twitter de 1200×630 (`assets/img/og-image.jpg`), que es la que aparece al compartir el enlace en WhatsApp, Facebook, LinkedIn, X o Telegram.

## Marca

- **Logotipo:** los archivos originales `io1.png` (color) e `io2.png` (blanco) de la web actual.
- **Colores:** muestreados del degradado del logotipo.
  - Ciruela `#863B50`
  - Frambuesa `#D34B6F`
  - Coral `#FB6870`
  - Mandarina `#FF916C`
  - Melocotón `#FFA777`
  - Fondo pizarra `#1A242E`, el de la web actual.
- **Tipografías:** Dela Gothic One y Poppins, las mismas de la web actual. Van alojadas en la propia web: no hay llamadas a Google Fonts.

## Imágenes y película (Higgsfield)

- **Imágenes:** generadas con **GPT Image 2.5**.
  - Fotograma final del show y fotograma inicial a oscuras. El inicial se hizo editando el final para que coincida exactamente.
  - Sonido, iluminación, mesa de control, evento corporativo, boda y montaje.
- **Película:** **Seedance 2.0**, de fotograma inicial a fotograma final, 720p y 7 s. Se exportó a secuencias WebP:
  - `assets/frames/d/`: 169 fotogramas para escritorio.
  - `assets/frames/m/`: 85 fotogramas, recorte vertical para móvil.

  La secuencia se dibuja en un `<canvas>`. Así el avance y el retroceso son fluidos en todos los navegadores, incluido Safari en iOS.
- **Fotos reales:** `real-concierto-acueducto.webp` y `real-cabezas-moviles.webp`, de la biblioteca de medios de la web actual.

## Datos reales usados

Se usaron solo datos verificables. Las fuentes:

- **Email:** info@iosistemasaudiovisuales.com, de la web actual.
- **Facebook:** «I/O Sistemas Audiovisuales», Madrid. Es la misma foto de perfil que el logotipo de la web. De ahí sale la descripción «Dinámicos y constructivos…».
- **LinkedIn:** «I/O Sistemas Audiovisuales». Enlaza a este dominio.
- **Teléfono:** +34 630 90 46 49. Aparece como «Móvil» en la sección de contacto de la página de Facebook de la empresa.
- **«En marcha desde 2015»:** la página de Facebook se creó el 15 de enero de 2015 y el dominio se registró el 7 de enero de 2015.
- **Agradecimientos:** la empresa aparece en los créditos del videoclip «Máscaras del alma» de Maganía (2025) y de tres sesiones de QSessions Project (2017). Todo está comprobado en las descripciones de YouTube.

## Pendiente de confirmar por la empresa

- **NIF del aviso legal:** se ha puesto el facilitado por la empresa (E87123456), pero no cuadra con el dígito de control de los NIF de entidades: con esos dígitos, el control correcto sería 1. Conviene revisarlo por si hay una errata.
- **Teléfono:** se ha publicado el de Facebook. Ese mismo número figura en Páginas Amarillas para otro negocio, así que conviene confirmar que sigue siendo el de contacto.
- **Textos de servicios, tipos de evento y proceso:** son descriptivos y no incluyen cifras, clientes ni garantías inventadas. Las fuentes públicas solo documentan conciertos y música en directo. Conviene confirmar los tipos de evento (bodas, empresa, teatro…) y los servicios que queréis destacar.
- **Nitidez de la película en móviles y tablets de alta densidad:** la película es 720p. Para máxima nitidez se puede generar otra versión vertical a 1080×1920 (requiere créditos de Higgsfield; a día de hoy quedan ~2).

## Publicar desde cPanel con Git

El repositorio incluye `.cpanel.yml` y `deploy/cpanel-deploy.sh`. cPanel los usa para copiar esta carpeta a la carpeta pública del dominio.

Configuración (una sola vez), en **cPanel » Archivos » Git Version Control » Create**:

1. **Clone URL:** `https://github.com/duduar89/trading-system.git`
2. **Repository Path:** `repositories/trading-system`. No debe ser la carpeta pública.
3. En **Manage**, elige la rama `claude/ios-sistemas-redesign-1f3ckf` en **Checked-Out Branch**.

Para cada actualización, en **Manage » Pull or Deploy** pulsa **Update from Remote** y después **Deploy HEAD Commit**.

`SITE_URL` en `.cpanel.yml` indica dónde se publica la web. El script cambia a esa dirección las URL absolutas de la tarjeta para compartir, canonical, sitemap y JSON-LD. Si no es el dominio definitivo, añade además `noindex`. Para pasar a `https://www.iosistemasaudiovisuales.com` basta con cambiar esa línea.

## Estructura

```
io-sistemas-web/
├── index.html
├── aviso-legal.html
└── assets/
    ├── css/styles.css
    ├── js/main.js
    ├── fonts/          (woff2 autoalojadas)
    ├── img/            (logos, favicon, imágenes WebP, og-image.jpg)
    └── frames/d|m/     (secuencia de la película)
```
