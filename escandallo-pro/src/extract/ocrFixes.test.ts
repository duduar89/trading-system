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
