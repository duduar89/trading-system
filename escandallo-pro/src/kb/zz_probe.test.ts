import { test } from 'vitest';
import { KB_INGREDIENTS } from './ingredients';
import { writeFileSync } from 'node:fs';

test('dump', () => {
  const lines = KB_INGREDIENTS.map((i) => [i.name, i.category, i.baseUnit, i.wastePct, i.cookingLossPct, i.refPricePerBase, i.unitWeightKg ?? '', i.densityKgPerL ?? '', i.allergens.join(',')].join('|'));
  writeFileSync('/tmp/claude-0/-home-user-trading-system/7b54e571-b78c-56aa-85b3-9cebb531255c/scratchpad/ings.txt', lines.join('\n'));
});
