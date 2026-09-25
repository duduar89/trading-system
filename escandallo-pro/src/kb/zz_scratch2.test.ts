import { test } from 'vitest';
import { proposeDishLocal, findKbRecipe } from './propose';

const DISHES: [string, string?][] = [
  ['Pulpo a la gallega con cachelos'],
  ['Tataki de atún rojo con ajoblanco'],
  ['Hamburguesa de buey con cheddar y bacon'],
  ['Risotto de boletus'],
  ['Tarta de queso al horno'],
  ['Solomillo de ternera con salsa de Oporto y patatas panaderas'],
  ['Ensalada de burrata con tomate raf y pesto'],
  ['Bacalao confitado sobre pisto manchego'],
  ['Bravas'],
  ['Pulpo a feira'],
  ['Croquetas caseras de jamón ibérico'],
  ['Croquetas de gambas'],
  ['Huevos rotos con gulas'],
  ['Risotto de calabaza'],
  ['Poke de atún'],
  ['Secreto ibérico con patatas y pimientos de Padrón'],
  ['Lubina a la brasa con verduras'],
  ['Entrecot de vaca madurada con patatas fritas'],
  ['Melón con jamón'],
  ['Ensalada de gambas'],
  ['Crema de calabaza'],
  ['Carrilleras de ternera al vino tinto con puré de patata'],
  ['Tacos de cochinita pibil'],
  ['Pizza de burrata y mortadela'],
  ['Espaguetis con almejas'],
  ['Merluza a la plancha con verduras'],
  ['Chipirones encebollados'],
  ['Alcachofas a la plancha con jamón'],
  ['Gin tonic de Tanqueray'],
  ['Copa de Ribera del Duero crianza'],
  ['Tarta de chocolate'],
  ['Brownie con helado'],
  ['Especialidad de la casa'],
  ['Tosta de sardina ahumada con tomate'],
  ['Bocadillo de lomo con queso'],
  ['Arroz caldoso de marisco'],
  ['Guiso de ternera con setas'],
  ['Langostinos en tempura con salsa agridulce'],
  ['Tapa de ensaladilla'],
  ['Media ración de croquetas'],
  ['Pulpo', 'a la gallega con cachelos y pimentón de la Vera'],
  ['Pulpo a la gallga'],
  ['Hamburguesa vegana'],
  ['Salmón con salsa de yogur y eneldo'],
  ['Cordero lechal asado con patatas panaderas'],
  ['Revuelto de morcilla con piñones'],
  ['Ensalada de quinoa con aguacate y langostinos'],
  ['Hamburguesa sin pan'],
];

test('scratch proposals', () => {
  for (const [n, d] of DISHES) {
    const t0 = performance.now();
    const p = proposeDishLocal(n, d);
    const dt = performance.now() - t0;
    const r = findKbRecipe(n, d);
    console.log(`\n### ${n}${d ? ' — ' + d : ''}  [${p.source} ${p.confidence} tpl=${p.templateName ?? '-'} best=${r?.recipe.name}:${r?.score} x${p.portions}] ${dt.toFixed(1)}ms`);
    console.log(p.ingredients.map((i) => `  ${i.name} ${i.quantity}${i.unit} ${i.basis}${i.cookingLossPct != null ? ' ck' + i.cookingLossPct : ''}${i.note ? ' (' + i.note + ')' : ''}`).join('\n'));
    console.log('  alérgenos:', p.allergens?.join(','));
    if (p.source === 'heuristica' && p.procedure) console.log(p.procedure.split('\n').map((l) => '  > ' + l).join('\n'));
  }
});
