<?php
/**
 * Recibe el cuestionario de diagnóstico y:
 *  1) guarda una copia en JSON en la carpeta protegida respuestas/
 *  2) envía las respuestas por correo a DESTINATARIO
 * Compatible con PHP 7.4 o superior.
 */

// ---- Configuración ------------------------------------------------------
const DESTINATARIO = 'info@brainstormersagency.es';
const REMITENTE    = 'no-reply@brainstormersagency.es'; // debe ser del mismo dominio que el hosting
const CARPETA      = __DIR__ . '/respuestas';
const MAX_BYTES    = 200000;   // tamaño máximo del envío
const MAX_POR_HORA = 5;        // envíos por IP y hora
// -------------------------------------------------------------------------

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

function responder(int $code, array $data): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function limpiar($v, int $max = 4000): string {
    $v = is_scalar($v) ? (string) $v : '';
    $v = preg_replace('/[^\P{C}\n\t]/u', '', $v);   // quita caracteres de control salvo saltos de línea
    return mb_substr(trim($v), 0, $max, 'UTF-8');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    responder(405, ['ok' => false, 'error' => 'Método no permitido']);
}

$raw = file_get_contents('php://input', false, null, 0, MAX_BYTES + 1);
if ($raw === false || strlen($raw) > MAX_BYTES) {
    responder(413, ['ok' => false, 'error' => 'Envío demasiado grande']);
}
$data = json_decode($raw, true);
if (!is_array($data) || !isset($data['items']) || !is_array($data['items'])) {
    responder(400, ['ok' => false, 'error' => 'Datos no válidos']);
}

// Trampa para robots: el campo oculto "website" debe llegar vacío
if (!empty($data['website'])) {
    responder(200, ['ok' => true]);
}

if (!is_dir(CARPETA) && !@mkdir(CARPETA, 0750, true)) {
    responder(500, ['ok' => false, 'error' => 'No se puede guardar']);
}

// Límite de envíos por IP (sin guardar la IP en claro)
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$huella = CARPETA . '/.limite-' . substr(hash('sha256', $ip . date('YmdH')), 0, 16);
$contador = is_file($huella) ? (int) file_get_contents($huella) : 0;
if ($contador >= MAX_POR_HORA) {
    responder(429, ['ok' => false, 'error' => 'Demasiados envíos, inténtalo más tarde']);
}
@file_put_contents($huella, (string) ($contador + 1), LOCK_EX);

// Normalizar respuestas
$items = [];
foreach (array_slice($data['items'], 0, 200) as $it) {
    if (!is_array($it)) continue;
    $items[] = [
        'section'  => limpiar($it['section'] ?? '', 200),
        'id'       => preg_replace('/[^a-z0-9_]/i', '', (string) ($it['id'] ?? '')),
        'question' => limpiar($it['question'] ?? '', 500),
        'answer'   => limpiar($it['answer'] ?? '', 4000),
    ];
}
$nombre = limpiar($data['respondent']['name'] ?? '', 120);
$email  = filter_var(limpiar($data['respondent']['email'] ?? '', 200), FILTER_VALIDATE_EMAIL) ?: '';

$registro = [
    'form'         => limpiar($data['form'] ?? 'diagnostico-io', 60),
    'version'      => limpiar($data['version'] ?? '', 20),
    'received_at'  => date('c'),
    'started_at'   => limpiar($data['started_at'] ?? '', 40),
    'submitted_at' => limpiar($data['submitted_at'] ?? '', 40),
    'respondent'   => ['name' => $nombre, 'email' => $email],
    'items'        => $items,
];

// 1) Copia en el servidor
$fichero = CARPETA . '/' . date('Ymd-His') . '-' . substr(bin2hex(random_bytes(4)), 0, 8) . '.json';
$guardado = @file_put_contents($fichero, json_encode($registro, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) !== false;

// 2) Correo legible
$lineas = ['Nuevo diagnóstico de IO Sistemas Audiovisuales', 'Recibido: ' . date('d/m/Y H:i'), ''];
$seccion = '';
foreach ($items as $it) {
    if ($it['section'] !== $seccion) {
        $seccion = $it['section'];
        $lineas[] = '';
        $lineas[] = '== ' . $seccion . ' ==';
    }
    $lineas[] = '• ' . $it['question'];
    $lineas[] = '  ' . str_replace("\n", "\n  ", $it['answer'] !== '' ? $it['answer'] : 'Sin responder');
}
if ($guardado) {
    $lineas[] = '';
    $lineas[] = 'Copia guardada en el servidor: respuestas/' . basename($fichero);
}
$cuerpo = implode("\n", $lineas);

$asuntoTexto = 'Diagnóstico IA · IO Sistemas Audiovisuales' . ($nombre !== '' ? ' · ' . $nombre : '');
$asunto = '=?UTF-8?B?' . base64_encode(str_replace(["\r", "\n"], ' ', $asuntoTexto)) . '?=';
$cabeceras = [
    'From: =?UTF-8?B?' . base64_encode('Diagnóstico IO') . '?= <' . REMITENTE . '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
];
if ($email !== '') {
    $cabeceras[] = 'Reply-To: ' . $email;
}
$enviado = @mail(DESTINATARIO, $asunto, $cuerpo, implode("\r\n", $cabeceras), '-f' . REMITENTE);

if (!$guardado && !$enviado) {
    responder(500, ['ok' => false, 'error' => 'No se ha podido registrar el envío']);
}
responder(200, ['ok' => true, 'mail' => $enviado, 'saved' => $guardado]);
