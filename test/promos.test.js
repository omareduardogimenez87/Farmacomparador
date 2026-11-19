const test = require('node:test');
const assert = require('node:assert');
const { diasDelTexto, leerLaAnonima, leerFarmacity } = require('../lib/promos');

test('reconoce los días de una promoción', () => {
  assert.deepStrictEqual(diasDelTexto('Todos los martes, 25% de descuento'), [2]);
  assert.deepStrictEqual(diasDelTexto('Viernes y Sábado 30% de reintegro'), [5, 6]);
  assert.deepStrictEqual(diasDelTexto('Miércoles 30% de descuento'), [3]);
  assert.deepStrictEqual(diasDelTexto('De jueves a sábado 15%'), [4, 5, 6]);
  assert.deepStrictEqual(diasDelTexto('Todos los días, 4 cuotas sin interés'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(diasDelTexto('3 cuotas sin interés'), [0, 1, 2, 3, 4, 5, 6]);
});

test('lee las tarjetas de promoción de La Anónima', () => {
  const html = `<div class="promo-card" data-day="|2|"><h3><strong> Martes 25% con Banco Hipotecario MODO </strong></h3>
    <div class="px-5 py-1 rounded-btn"><strong>Martes</strong></div>
    <div class="promo-card-legal"><p class="text-center">Tope de reintegro $10.000 por mes.</p></div></div>`;
  assert.deepStrictEqual(leerLaAnonima(html), [
    { titulo: 'Martes 25% con Banco Hipotecario MODO', detalle: 'Tope de reintegro $10.000 por mes.', dias: [2] },
  ]);
});

test('lee la lista de promociones de Farmacity', () => {
  const html = '{\\"Tarjeta\\": \\"TARJETA NARANJA\\", \\"Tienda\\": \\"SUCURSAL\\", \\"Promoción\\": \\"Miércoles 30% de descuento. Tope $15.000\\"}';
  const [promo] = leerFarmacity(html);
  assert.strictEqual(promo.titulo, 'TARJETA NARANJA (sucursal)');
  assert.deepStrictEqual(promo.dias, [3]);
});

test('reconoce promos por cantidad en los nombres de colecciones', () => {
  const { unidadesDePromo } = require('../lib/plataformas');
  assert.strictEqual(unidadesDePromo('Ofertas 2x1'), 2);
  assert.strictEqual(unidadesDePromo('PROMO 3X2 SURTIDO'), 3);
  assert.strictEqual(unidadesDePromo('Promo 2do al 80%'), 2);
  assert.strictEqual(unidadesDePromo('PROMO 2DA AL 70 ELVIVE'), 2);
  assert.strictEqual(unidadesDePromo('2DA50'), 2);
  assert.strictEqual(unidadesDePromo('Hasta 2x1 en Bebidas'), 0);
  assert.strictEqual(unidadesDePromo('Últimas oportunidades'), 0);
  assert.strictEqual(unidadesDePromo('Pack 6x4 cm'), 0);
});
