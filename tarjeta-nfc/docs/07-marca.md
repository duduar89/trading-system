# 7 · Aplicar el manual de marca

Toda la identidad vive en **un único fichero**: [`../web/marca.css`](../web/marca.css),
más el símbolo en [`../web/marca-simbolo.svg`](../web/marca-simbolo.svg). El resto
del código no sabe de qué color es nada: pide `var(--marca-primario)` y ya está.

Cambiar de marca son 10 minutos y no toca ni una línea de lógica.

> **Lo que hay ahora es provisional.** La paleta de costa (verde marea, coral,
> arena) y el pájaro están puestos a ojo a partir del nombre, sin haber visto el
> manual. Sirve para ver la forma, no para publicar.

---

## 7.1 Lo que hace falta del manual

| # | Qué | Dónde va | Si no lo tienes |
|---|---|---|---|
| 1 | **Color principal** (HEX) | `--marca-primario` | el más oscuro del logo |
| 2 | **Color de acento** (HEX) | `--marca-acento` | uno cálido que contraste; se usa solo para "tienes premio" |
| 3 | **Color de texto** | `--marca-tinta` | casi negro, nunca `#000` puro |
| 4 | **Color de fondo** | `--marca-papel` | blanco roto |
| 5 | **Tipografía de títulos** | `--marca-tipo-titulo` | — |
| 6 | **Tipografía de texto** | `--marca-tipo-texto` | — |
| 7 | **Símbolo en SVG**, monocromo y sin texto | `marca-simbolo.svg` | se recorta del logo |
| 8 | **Qué hace la marca en oscuro** | los tokens `--marca-*-osc` | se aclara el primario hasta que contraste |

Con el manual en PDF basta: de ahí salen los siete primeros.

---

## 7.2 Cómo se aplica

**Color y formas** — se editan los valores en `marca.css`. Nada más.

**Tipografías** — si son de Google Fonts, el `<link>` va en el `<head>` de
[`../web/tarjeta.html`](../web/tarjeta.html) y el nombre en `--marca-tipo-*`.
Si te pasan los `.woff2`, se meten en `web/` con un `@font-face` en `marca.css`.

**Símbolo** — se sustituye el contenido de `marca-simbolo.svg`. Dos requisitos:

- **Monocromo**, usando `fill="currentColor"`. El mismo trazo se pinta blanco en
  la cabecera y en color dentro de cada sello, así que no puede llevar colores
  propios.
- **Sin texto.** A 26 px dentro de un sello, un logotipo con letras es una
  mancha. Si la marca es solo tipográfica, vale una inicial o un monograma.

---

## 7.3 Por qué el símbolo va dentro de los sellos

Es la decisión de diseño que más trabaja: cada sello conseguido lleva el
símbolo de la marca, ligeramente girado, como un tampón puesto a mano. Convierte
una fila de círculos genéricos en *la tarjeta de este sitio*, y repite la marca
diez veces sin que parezca publicidad.

Si el manual prohíbe rotar el símbolo, se quita el `transform: rotate(-8deg)` de
`.sello .marca-sello` en [`../web/tarjeta.css`](../web/tarjeta.css).

---

## 7.4 Lo que conviene no tocar

- **Los sellos, de cinco en cinco.** Diez caben en dos filas limpias en cualquier
  móvil. Con seis por fila se salen en pantallas de 360 px.
- **El contraste del aviso de premio.** Es lo único naranja de la pantalla a
  propósito: si todo destaca, no destaca nada.
- **El tamaño del texto del cuerpo (16 px).** Por debajo, Safari en iOS hace zoom
  solo al tocar y descoloca la página.
