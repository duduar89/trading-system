# 3 · Hardware: qué comprar

---

## 3.1 El problema que hay que resolver primero: el iPhone

Es la limitación que condiciona todo el diseño, así que va primero.

| Quién | Qué necesita hacer | ¿Puede? |
|---|---|---|
| **Empleado, Android** | leer la tarjeta del cliente desde el navegador | **Sí.** Chrome en Android implementa Web NFC |
| **Empleado, iPhone** | lo mismo | **No.** Safari no tiene Web NFC, y en iOS todos los navegadores son Safari por dentro |
| **Cliente, iPhone** | acercar su tarjeta a su propio móvil y ver sus puntos | **Sí.** iOS lee etiquetas NDEF de fondo desde el iPhone XS |
| **Cliente, Android** | lo mismo | Sí |

Traducido:

- **El móvil del mostrador tiene que ser Android.** No es una preferencia, es un
  requisito. Un iPhone detrás de la barra no puede leer las tarjetas desde el
  navegador; haría falta una app nativa con Core NFC, que son semanas de trabajo
  más 99 $/año de cuenta de desarrollador más revisión de la App Store.
- **El móvil del cliente da igual.** Como en el chip va grabada una URL, quien
  acerque la tarjeta a su propio teléfono —Android o iPhone— ve su saldo. Esa es
  la parte que hace que la tarjeta parezca moderna, y sale gratis.

Y una trampa cara: **la mayoría de tablets baratas no llevan NFC.** Parece la
compra obvia para el mostrador y casi nunca funciona. Comprueba la ficha técnica
antes; si dudas, compra un móvil.

---

## 3.2 Las tarjetas

| Chip | Precio orientativo | Qué aporta | Para qué |
|---|---|---|---|
| **NTAG213** (144 B) | 0,15–0,45 €/ud en pack de 100 | UID fijo + URL grabable | **empieza aquí** |
| NTAG215 (504 B) | 0,50–0,90 € | más memoria | no la necesitas |
| **NTAG424 DNA** | 1,20–2,50 € | firma criptográfica en cada lectura | anticlonado, ver [`05`](05-seguridad-y-fraude.md) |

Formatos: tarjeta PVC tamaño carné (la que la gente espera), llavero (se pierde
menos, cabe en el llavero de casa) o pegatina. Para empezar, tarjeta.

**Personalizar la impresión** (tu logo, a todo color) sale por 0,80–1,50 €/ud a
partir de 500 unidades. No lo hagas en el piloto. Compra 100 blancas, pon una
pegatina si quieres, y encarga las bonitas cuando sepas que el programa se usa.

> Los precios son órdenes de magnitud a fecha de escribir esto, no presupuestos.
> Pide dos o tres antes de comprar: el rango entre proveedores es enorme.

**Imprime o graba un número visible en cada tarjeta.** Cuesta nada y salva el día
cuando el NFC falla, la tarjeta está rayada o el móvil se queda sin batería: el
empleado teclea el número en el formulario de respaldo que ya trae el mostrador.

---

## 3.3 El lector

| Opción | Coste | Ventaja | Inconveniente |
|---|---|---|---|
| **Android que ya tenéis** | 0 € | inmediato | ocupa un móvil del equipo |
| **Android de segunda mano** | 70–120 € | dedicado, con su soporte en la barra | hay que comprarlo |
| Lector USB tipo ACR122U | 35–45 € | va con un PC | necesita drivers y un puente local: más piezas que se rompen |

Casi siempre gana el móvil Android dedicado, con un soporte y el cargador puesto.
Sin drivers, sin PC, sin nada que instalar más allá de abrir una página.

---

## 3.4 Grabar la URL en las tarjetas

Al dar de alta, el sistema devuelve una dirección tipo
`https://puntos.tulocal.es/t/Rrb4h6a91LWsBkjytZzEHg`. Se graba en el chip con la
app **NFC Tools** (gratis, Android e iOS) → *Escribir* → *Añadir un registro* →
*URL*.

Son unos 20 segundos por tarjeta. Para 100 tarjetas es una tarde con la tele
puesta — o no lo hagas: **el sistema funciona igual sin grabar nada**, porque
identifica la tarjeta por su UID. Grabar la URL solo sirve para que el cliente
pueda consultar sus puntos con su propio móvil. Es lo que más gusta y es lo
último que hace falta.

Si las grabas, **bloquea el chip** (`NFC Tools` → *Otros* → *Bloquear etiqueta*)
para que nadie reescriba la URL. Es irreversible: asegúrate de que la dirección
es la definitiva y de que tu dominio no va a cambiar.

---

## 3.5 HTTPS no es opcional

Web NFC solo funciona en un **contexto seguro**: `https://` o `localhost`. Si
sirves la página por `http://192.168.1.40:8080`, el móvil de la barra no leerá
nada y el error es poco claro.

Tres caminos:

1. **Dominio + VPS** (unos 5 €/mes + 10 €/año de dominio) con Caddy o nginx
   delante haciendo Let's Encrypt. Es lo que quieres para producción, porque la
   página del cliente tiene que ser accesible desde fuera del local.
2. **Túnel** (Cloudflare Tunnel, tailscale funnel) apuntando al servidor del
   local. Vale para probar.
3. **Certificado autofirmado** para el piloto, aceptando el aviso del navegador
   una vez en el móvil del mostrador:

   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
     -keyout clave.pem -out cert.pem -subj "/CN=puntos.local"
   node servidor/servidor.js --cert cert.pem --clave clave.pem --puerto 8443
   ```

   Sirve para el mostrador, **no** para la página del cliente: nadie va a aceptar
   un aviso de seguridad para ver sus sellos.

---

## 3.6 Presupuesto de arranque

| Concepto | Coste |
|---|---|
| 100 tarjetas NTAG213 blancas | 20–45 € |
| Móvil Android de segunda mano con NFC (si no tenéis uno libre) | 0–120 € |
| Soporte de barra + cargador | ~15 € |
| Dominio (1 año) | ~10 € |
| VPS pequeño (1 año) | ~60 € |
| **Total del piloto** | **≈ 45 € si reutilizas un móvil · ≈ 250 € montándolo entero** |

Recurrente después: unos **6 €/mes** de servidor y dominio, más las tarjetas que
repongas.
