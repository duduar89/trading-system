import { describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_SETTINGS } from '../../db';
import {
  backupFileName,
  backupSummary,
  confirmNameMatches,
  draftDiffers,
  draftFromBusiness,
  fmtBytes,
  hasErrors,
  looksLikeAnthropicKey,
  maskApiKey,
  parseBackup,
  slugify,
  validateBusinessDraft,
} from './settingsLogic';

describe('validateBusinessDraft', () => {
  it('acepta los valores por defecto', () => {
    expect(hasErrors(validateBusinessDraft(draftFromBusiness(DEFAULT_BUSINESS_SETTINGS)))).toBe(false);
  });
  it('exige umbral de atención ≥ objetivo', () => {
    const e = validateBusinessDraft({ ...draftFromBusiness(DEFAULT_BUSINESS_SETTINGS), targetFoodCostPct: 32, warningFoodCostPct: 30 });
    expect(e.warningFoodCostPct).toMatch(/mayor que el objetivo/);
    expect(e.targetFoodCostPct).toBeUndefined();
  });
  it('detecta campos vacíos y fuera de rango', () => {
    const e = validateBusinessDraft({
      targetFoodCostPct: undefined,
      warningFoodCostPct: 120,
      defaultSaleVatPct: 45,
      priceAlertPct: -1,
      priceRounding: 0.3,
    });
    expect(e.targetFoodCostPct).toBeTruthy();
    expect(e.warningFoodCostPct).toMatch(/95/);
    expect(e.defaultSaleVatPct).toMatch(/30/);
    expect(e.priceAlertPct).toBeTruthy();
    expect(e.priceRounding).toBeTruthy();
  });
  it('rechaza objetivos poco realistas', () => {
    expect(validateBusinessDraft({ ...draftFromBusiness(DEFAULT_BUSINESS_SETTINGS), targetFoodCostPct: 2 }).targetFoodCostPct).toBeTruthy();
    expect(validateBusinessDraft({ ...draftFromBusiness(DEFAULT_BUSINESS_SETTINGS), targetFoodCostPct: 81 }).targetFoodCostPct).toBeTruthy();
  });
  it('draftDiffers detecta cambios', () => {
    const d = draftFromBusiness(DEFAULT_BUSINESS_SETTINGS);
    expect(draftDiffers(d, DEFAULT_BUSINESS_SETTINGS)).toBe(false);
    expect(draftDiffers({ ...d, priceRounding: 1 }, DEFAULT_BUSINESS_SETTINGS)).toBe(true);
    expect(draftDiffers({ ...d, targetFoodCostPct: undefined }, DEFAULT_BUSINESS_SETTINGS)).toBe(true);
  });
});

describe('parseBackup', () => {
  const valid = {
    format: 'escandallo-pro-backup',
    version: 1,
    exportedAt: '2026-09-25T10:00:00.000Z',
    workspace: { id: 'w1', name: 'Taberna', createdAt: '', updatedAt: '' },
    data: {
      products: [{ id: 'p1' }],
      pricePoints: [],
      suppliers: [],
      invoices: [],
      dishes: [{ id: 'd1' }, { id: 'd2' }],
      yieldTests: [],
      menuScans: [],
      business: [],
    },
  };
  it('acepta una copia válida (también con BOM) y la resume', () => {
    const b = parseBackup('﻿' + JSON.stringify(valid));
    expect(backupSummary(b)).toMatchObject({ name: 'Taberna', products: 1, dishes: 2, invoices: 0 });
  });
  it('rechaza JSON inválido', () => {
    expect(() => parseBackup('{no')).toThrow(/JSON válido/);
  });
  it('rechaza otros formatos', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, format: 'otra-app' }))).toThrow(/no es una copia/);
    expect(() => parseBackup('null')).toThrow(/vacío/);
  });
  it('rechaza versiones futuras', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 2 }))).toThrow(/versión más reciente/);
  });
  it('rechaza tablas dañadas o registros sin id', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, data: { ...valid.data, dishes: {} } }))).toThrow(/dishes/);
    expect(() => parseBackup(JSON.stringify({ ...valid, data: { ...valid.data, products: [{ name: 'x' }] } }))).toThrow(/sin identificador/);
    expect(() => parseBackup(JSON.stringify({ ...valid, workspace: { name: '  ' } }))).toThrow(/nombre/);
  });
});

describe('utilidades de texto', () => {
  it('slugify', () => {
    expect(slugify('Taberna La Lonja')).toBe('taberna-la-lonja');
    expect(slugify('  Açaí & Piñones — Málaga ')).toBe('acai-pinones-malaga');
    expect(slugify('***')).toBe('restaurante');
  });
  it('backupFileName', () => {
    expect(backupFileName('Casa Pepe', new Date(2026, 8, 5))).toBe('escandallo-pro_casa-pepe_2026-09-05.json');
    expect(backupFileName('Casa Pepe', new Date(2026, 8, 5), 'xlsx')).toMatch(/\.xlsx$/);
  });
  it('confirmNameMatches ignora mayúsculas, tildes y espacios', () => {
    expect(confirmNameMatches('  taberna   la lonja ', 'Taberna La Lonja')).toBe(true);
    expect(confirmNameMatches('Cafe Oriente', 'Café Oriente')).toBe(true);
    expect(confirmNameMatches('Taberna', 'Taberna La Lonja')).toBe(false);
    expect(confirmNameMatches('', '')).toBe(false);
  });
  it('claves de IA', () => {
    expect(looksLikeAnthropicKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123')).toBe(true);
    expect(looksLikeAnthropicKey('sk-123')).toBe(false);
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123')).toBe('sk-ant-api…0123');
    expect(maskApiKey(undefined)).toBe('');
    expect(maskApiKey('corta')).toBe('•••••');
  });
  it('fmtBytes', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1536)).toBe('1,5 KB');
    expect(fmtBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(fmtBytes(undefined)).toBe('—');
  });
});
