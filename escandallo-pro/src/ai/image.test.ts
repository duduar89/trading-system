import { describe, expect, it } from 'vitest';
import { fitWithin, jpegOrientation, prepareImage, sniffImageType } from './image';

const bytes = (...b: number[]) => new Uint8Array(b);

/** JPEG mínimo con un segmento APP1/EXIF que declara la orientación dada. */
function jpegWithOrientation(orientation: number, little = true): Uint8Array {
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 0xff, ...payload, 0xff, 0xda, 0, 2]);
}

describe('image', () => {
  it('detecta el tipo real por la cabecera', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp');
    expect(sniffImageType(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63))).toBe('image/heic');
    expect(sniffImageType(bytes(0x42, 0x4d, 0, 0))).toBe('image/bmp');
    expect(sniffImageType(bytes(1, 2, 3))).toBe('unknown');
  });

  it('ajusta el lado largo a 2000 px sin ampliar', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500, scale: 2000 / 4032 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1500, height: 2000, scale: 2000 / 4032 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800, scale: 1 });
    expect(fitWithin(3000, 10, 1000).height).toBe(3);
  });

  it('lee la orientación EXIF de un JPEG (little y big endian)', () => {
    expect(jpegOrientation(jpegWithOrientation(6))).toBe(6);
    expect(jpegOrientation(jpegWithOrientation(3, false))).toBe(3);
    expect(jpegOrientation(jpegWithOrientation(1))).toBe(1);
    expect(jpegOrientation(bytes(0xff, 0xd8, 0xff, 0xda, 0, 2))).toBe(1);
    expect(jpegOrientation(bytes(0x89, 0x50))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(6).subarray(0, 20))).toBe(1);
  });

  it('sin decodificador (entorno sin canvas): envía tal cual si el formato es compatible', async () => {
    const png = new Blob([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3)], { type: '' });
    const out = await prepareImage(png);
    expect(out.mediaType).toBe('image/png');
    expect(out.data).toBe(Buffer.from(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3)).toString('base64'));
    await expect(prepareImage(new Blob([bytes(0x42, 0x4d, 0, 0)], { type: 'image/bmp' }))).rejects.toMatchObject({ kind: 'invalid' });
  });
});
