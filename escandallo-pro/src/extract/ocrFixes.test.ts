import { describe, expect, it } from 'vitest';
import { fixDigitsInWord, fixOcrDescription, fixPackToken, knownWord, splitGluedTail, splitGluedWords } from './ocrFixes';

describe('ocrFixes', () => {
  it('reconoce palabras del léxico culinario con plural y femenino', () => {
    expect(knownWord('CARRILLERA')).toBe(true);
    expect(knownWord('IBERICA')).toBe(true);
    expect(knownWord('champiñones')).toBe(true);
    expect(knownWord('XYZZY')).toBe(false);
  });

  it.each([
    ['SL', '5L'],
    ['S00G', '500G'],
    ['1O0G', '100G'],
    ['1kKG', '1KG'],
    ['IKG', '1KG'],
  ])('formato mal leído %s → %s', (input, out) => {
    expect(fixPackToken(input)).toBe(out);
  });

  it.each(['5L', 'OL', 'SAL', 'UDS', 'LG', '250G'])('no toca %s', (input) => {
    expect(fixPackToken(input)).toBeUndefined();
  });

  it('separa palabras pegadas sólo si todas las piezas son conocidas', () => {
    expect(splitGluedWords('CARRILLERAIBERICA')).toBe('CARRILLERA IBERICA');
    expect(splitGluedWords('PATATAAGRIASACO')).toBe('PATATA AGRIA SACO');
    expect(splitGluedWords('PEDROÑERAS')).toBeUndefined();
    expect(splitGluedWords('MANTEQUILLA')).toBeUndefined();
    expect(splitGluedWords('PARMIGIANO')).toBeUndefined();
  });

  it('cifras dentro de palabras', () => {
    expect(fixDigitsInWord('CEB0LLA')).toBe('CEBOLLA');
    expect(fixDigitsInWord('P1MIENTO')).toBe('PIMIENTO');
    expect(fixDigitsInWord('6X1L')).toBeUndefined();
    expect(fixDigitsInWord('B52')).toBeUndefined();
  });

  it('limpia descripciones completas', () => {
    expect(fixOcrDescription('ACEITE OLIVA V.E. GARRAFASL')).toBe('ACEITE OLIVA V.E. GARRAFA 5L');
    expect(fixOcrDescription('NATA 35% MG1L')).toBe('NATA 35% MG 1L');
    expect(fixOcrDescription('ARROZ BOMBA 1kKG')).toBe('ARROZ BOMBA 1KG');
    expect(fixOcrDescription('PATATAAGRIASACO25KG')).toBe('PATATA AGRIA SACO 25KG');
    expect(fixOcrDescription('CEB0LLA DULCE  MALLA 5KG')).toBe('CEBOLLA DULCE MALLA 5KG');
    expect(fixOcrDescription('LECHE ENTERA 6X1L')).toBe('LECHE ENTERA 6X1L');
  });

  it('separa una preposición pegada al final de la palabra ("Pulpoa la gallega")', () => {
    expect(splitGluedTail('Pulpoa', 'la')).toBe('Pulpo a');
    expect(splitGluedTail('Merluzaen', 'salsa')).toBe('Merluza en');
    expect(splitGluedTail('Pulpoa', 'Gallega')).toBeUndefined();
    expect(splitGluedTail('Paella', 'de')).toBeUndefined();
    expect(splitGluedTail('Tomate', 'frito')).toBeUndefined();
  });
});

describe('fixTrailingUnitSix: «G» final leída como «6»', () => {
  it('corrige gramajes habituales al final de la descripción', () => {
    expect(fixOcrDescription('PIMENTON DULCE DE LA VERA 756')).toBe('PIMENTON DULCE DE LA VERA 75G');
    expect(fixOcrDescription('BANDEJA CHAMPIÑON 2506')).toBe('BANDEJA CHAMPIÑON 250G');
    expect(fixOcrDescription('HARINA TRIGO 1K6')).toBe('HARINA TRIGO 1KG');
  });
  it('no toca números que no son gramajes, ni códigos, ni tokens intermedios', () => {
    expect(fixOcrDescription('CERVEZA PACK 6')).toBe('CERVEZA PACK 6');
    expect(fixOcrDescription('VINO TINTO COSECHA 2016')).toBe('VINO TINTO COSECHA 2016');
    expect(fixOcrDescription('ACEITE REF 1256')).toBe('ACEITE REF 1256');
    expect(fixOcrDescription('LATA 756 TOMATE')).toBe('LATA 756 TOMATE');
  });
});

describe('unidades en minúscula leídas como cifras', () => {
  it('la «l» de litros leída como «1» en productos líquidos', () => {
    expect(fixOcrDescription('Aceite de girasol garrafa 11')).toBe('Aceite de girasol garrafa 1l');
    expect(fixOcrDescription('Aceite oliva virgen extra 51')).toBe('Aceite oliva virgen extra 5l');
    expect(fixOcrDescription('Leche entera brik 6x11')).toBe('Leche entera brik 6x1l');
    expect(fixOcrDescription('Agua mineral 1,51')).toBe('Agua mineral 1,5l');
    expect(fixOcrDescription('Barril cerveza 301')).toBe('Barril cerveza 30l');
  });
  it('no toca cifras sin contexto de líquido o en mayúsculas', () => {
    expect(fixOcrDescription('Tomate calibre 11')).toBe('Tomate calibre 11');
    expect(fixOcrDescription('ACEITE GIRASOL 11')).toBe('ACEITE GIRASOL 11');
    expect(fixOcrDescription('Vino tinto crianza 2011')).toBe('Vino tinto crianza 2011');
  });
  it('la «g» de gramos leída como «9»', () => {
    expect(fixOcrDescription('Tomate cherry bandeja 2509')).toBe('Tomate cherry bandeja 250g');
    expect(fixOcrDescription('Azafrán en hebra 19')).toBe('Azafrán en hebra 1g');
    expect(fixOcrDescription('Harina de trigo 1k9')).toBe('Harina de trigo 1kg');
    expect(fixOcrDescription('Huevos camperos 19')).toBe('Huevos camperos 19');
  });
  it('centilitros, kilos y milímetros mal leídos', () => {
    expect(fixOcrDescription('Vino blanco verdejo 75c1')).toBe('Vino blanco verdejo 75cl');
    expect(fixOcrDescription('Arroz redondo lkg')).toBe('Arroz redondo 1kg');
    expect(fixOcrDescription('Film transparente 9nm')).toBe('Film transparente 9mm');
  });
});

describe('otras confusiones del OCR en descripciones', () => {
  it('"rn" y "m" sólo hacia palabras conocidas', () => {
    expect(fixOcrDescription('Carme picada de vacuno')).toBe('Carne picada de vacuno');
    expect(fixOcrDescription('Carmen del Mar')).toBe('Carmen del Mar');
  });
  it('quita basura pegada al principio', () => {
    expect(fixOcrDescription('tGARBANZO COCIDO 400G')).toBe('GARBANZO COCIDO 400G');
    expect(fixOcrDescription('tCroqueta de jamón')).toBe('Croqueta de jamón');
    expect(fixOcrDescription('¡Nata para montar')).toBe('Nata para montar');
    expect(fixOcrDescription('eXtra')).toBe('eXtra');
  });
});

describe('vocales duplicadas y categorías en romanos', () => {
  it('quita la vocal leída dos veces con y sin tilde', () => {
    expect(fixOcrDescription('FRESOÓN')).toBe('FRESÓN');
    expect(fixOcrDescription('Melón piel de sapo')).toBe('Melón piel de sapo');
    expect(fixOcrDescription('JAMOÓN IBÉRICO')).toBe('JAMÓN IBÉRICO');
  });
  it('categoría comercial I / II leída como cifra', () => {
    expect(fixOcrDescription('PLÁTANO DE CANARIAS CATEGORÍA 1')).toBe('PLÁTANO DE CANARIAS CATEGORÍA I');
    expect(fixOcrDescription('Manzana golden cat. 11')).toBe('Manzana golden cat. II');
    expect(fixOcrDescription('Huevos camperos 1 docena')).toBe('Huevos camperos 1 docena');
  });
});
