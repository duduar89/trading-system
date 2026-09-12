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
$fila = gmdate('Y-m-d H:i:s') . ',' . $origen . ',' . es_movil();
anotar($ARCHIVO, $CARPETA_DATOS, $fila);

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
