import { test } from 'vitest';
import { KB_INGREDIENTS, kbIngredientIndex, findKbIngredient } from './ingredients';
import { KB_RECIPES } from './recipes';
import { phraseKey } from './text';

test('scratch integrity', () => {
  console.log('ingredients', KB_INGREDIENTS.length, 'recipes', KB_RECIPES.length);
  const owner = new Map<string, string>();
  const problems: string[] = [];
  for (const ing of KB_INGREDIENTS) {
    const keys = [ing.name, ...ing.aliases].map((t) => [t, phraseKey(t)] as const);
    const own = new Set<string>();
    for (const [t, k] of keys) {
      if (!k) { problems.push(`EMPTY ${ing.name}: ${t}`); continue; }
      if (own.has(k)) problems.push(`SELFDUP ${ing.name}: ${t} (${k})`);
      own.add(k);
      const o = owner.get(k);
      if (o && o !== ing.name) problems.push(`COLLISION "${k}": ${o} <> ${ing.name} (${t})`);
      else owner.set(k, ing.name);
    }
  }
  console.log(problems.join('\n'));
  const idx = kbIngredientIndex();
  const unresolved: string[] = [];
  for (const r of KB_RECIPES) for (const it of r.items) {
    if (!idx.byName.has(it.name)) unresolved.push(`${r.name}: ${it.name} -> ${findKbIngredient(it.name)?.name}`);
  }
  console.log('UNRESOLVED\n' + unresolved.join('\n'));
  const names = new Map<string, number>();
  for (const r of KB_RECIPES) names.set(r.name, (names.get(r.name) ?? 0) + 1);
  console.log('DUP RECIPES', [...names].filter(([, n]) => n > 1));
});
