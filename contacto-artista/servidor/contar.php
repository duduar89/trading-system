<?php
/*
 * contar.php — contador de escaneos y redirección, para hosting compartido (cPanel).
 *
 * Para qué: saber cuántas personas llegan por cada soporte (la tarjeta, la
 * pegatina NFC, el cartel, el enlace de Instagram) sin meter cookies, sin
 * píxeles y sin pedir consentimiento. Se guarda lo justo: fecha, de dónde viene
 * y si era móvil. Ni IP, ni identificadores, ni nada que señale a una persona:
 * por eso no hace falta banner de cookies ni base legal de consentimiento, es un
 * recuento agregado y punto.
 *
 * Dos modos:
 *   /contar.php?f=tarjeta           -> apunta y redirige (302) al destino
 *   /contar.php?f=tarjeta&modo=aviso -> apunta y devuelve 204 (para llamarlo por
 *                                       detrás desde la página puente)
 *
 * Instalación: subir este archivo a la raíz del subdominio y crear al lado una
 * carpeta "datos" con permisos de escritura. El .htaccess que hay en
 * servidor/datos-htaccess.txt impide que nadie lea el registro desde fuera.
 */

// ---------------------------------------------------------------- ajustes
// ESTE BLOQUE LO REESCRIBE herramientas/construir.js DESDE config.js.
// No editarlo a mano aquí: se pierde al regenerar. Los soportes se cambian en
// config.js, que es donde también se generan los QR con esos mismos códigos.
$DESTINO_POR_DEFECTO = 'https://wa.me/34620591728';   /*__DESTINO__*/
$ORIGENES = array('directo', 'otro');                 /*__ORIGENES__*/

$CARPETA_DATOS = __DIR__ . '/datos';
$ARCHIVO = $CARPETA_DATOS . '/escaneos.csv';

// ------------------------------------------------------------- utilidades
function origen_limpio($valor, $permitidos) {
    $v = strtolower(trim((string)$valor));
    if ($v === '' || !in_array($v, $permitidos, true)) {
        return 'otro';
    }
    return $v;
}

/*
 * Lo que NO se cuenta.
 *
 * Cuando alguien pega el enlace en un chat, WhatsApp, Telegram y compañía lo
 * visitan por su cuenta para dibujar la vista previa. Y los navegadores a veces
 * lo piden por adelantado. Si eso se cuenta, el informe de "qué soporte funciona"
 * —que es la única razón de existir de este contador— queda contaminado desde el
 * primer bolo, y encima hacia arriba, que es peor porque nadie sospecha.
 */
function es_robot() {
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
    if ($ua === '') {
        return true;   // un navegador de verdad siempre se identifica
    }
    $patron = '/WhatsApp|facebookexternalhit|facebookcatalog|Twitterbot|TelegramBot|' .
              'Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|Applebot|Googlebot|' .
              'bingbot|DuckDuckBot|YandexBot|Pinterest|redditbot|' .
              'bot|crawler|spider|preview|curl|wget|python-requests|HeadlessChrome/i';
    return (bool) preg_match($patron, $ua);
}

function es_peticion_de_verdad() {
    $metodo = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';
    if ($metodo === 'HEAD') {
        return false;   // nadie mira una página con HEAD
    }
    // Cabeceras de prelectura: el navegador se adelanta y la persona no ha ido.
    foreach (array('HTTP_PURPOSE', 'HTTP_X_PURPOSE', 'HTTP_X_MOZ', 'HTTP_SEC_PURPOSE') as $cabecera) {
        if (isset($_SERVER[$cabecera]) && stripos($_SERVER[$cabecera], 'prefetch') !== false) {
            return false;
        }
        if (isset($_SERVER[$cabecera]) && stripos($_SERVER[$cabecera], 'preview') !== false) {
            return false;
        }
    }
    return true;
}

function es_movil() {
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
    return preg_match('/Android|iPhone|iPad|iPod|Mobile|Opera Mini/i', $ua) ? 'movil' : 'otro';
}

function anotar($archivo, $carpeta, $fila) {
    if (!is_dir($carpeta)) {
        @mkdir($carpeta, 0755, true);
    }
    $nuevo = !file_exists($archivo);
    $f = @fopen($archivo, 'a');
    if ($f === false) {
        // Que no se pueda escribir NUNCA debe impedir la redirección: el fan
        // tiene que acabar en WhatsApp aunque el disco esté lleno.
        return false;
    }
    // Bloqueo exclusivo: dos escaneos a la vez no se pisan.
    if (flock($f, LOCK_EX)) {
        if ($nuevo) {
            fwrite($f, "fecha,origen,dispositivo\n");
        }
        fwrite($f, $fila . "\n");
        flock($f, LOCK_UN);
    }
    fclose($f);
    return true;
}

// ---------------------------------------------------------------- proceso
$origen = origen_limpio(isset($_GET['f']) ? $_GET['f'] : '', $ORIGENES);

// Se cuenta solo si hay una persona detrás. Si no, se sigue redirigiendo igual:
// que no se cuente algo nunca puede impedir que el fan llegue a WhatsApp.
if (es_peticion_de_verdad() && !es_robot()) {
    $fila = gmdate('Y-m-d H:i:s') . ',' . $origen . ',' . es_movil();
    anotar($ARCHIVO, $CARPETA_DATOS, $fila);
}

$modo = isset($_GET['modo']) ? $_GET['modo'] : 'ir';

if ($modo === 'aviso') {
    header('Cache-Control: no-store');
    http_response_code(204);
    exit;
}

// Se admite un destino distinto por parámetro, pero SOLO de una lista blanca:
// un redirector abierto acaba usándose para estafas y tumba la reputación del
// dominio.
$DESTINOS = array(
    'wa'      => $DESTINO_POR_DEFECTO,
    'canal'   => '',   // enlace del canal de WhatsApp, si se usa
    'sitio'   => ''    // la web de la artista
);
$clave = isset($_GET['a']) ? $_GET['a'] : 'wa';
$destino = isset($DESTINOS[$clave]) && $DESTINOS[$clave] !== '' ? $DESTINOS[$clave] : $DESTINO_POR_DEFECTO;

header('Cache-Control: no-store, no-cache, must-revalidate');
header('Location: ' . $destino, true, 302);
exit;
