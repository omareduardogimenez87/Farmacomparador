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

test('muestra solo las promos que valen en Santiago del Estero', () => {
  const { valeEnSantiago } = require('../lib/promos');
  const p = (titulo, detalle = '') => valeEnSantiago({ titulo, detalle });
  // Valen en Santiago
  assert.ok(p('20% de reintegro pagando con MODO', 'Promoción válida en todas las sucursales del pais.'));
  assert.ok(p('Martes 20% con Banco Columbia', 'Promoción válida en todas las sucursales físicas en del país.'));
  assert.ok(p('3 cuotas con Credimas', 'sucursales físicas ubicada en: Salta, Tucumán, Santiago del Estero.'));
  assert.ok(p('Naranja', 'Especial Sgo +La Rioja+Formosa - Lunes 10% de descuento'));
  assert.ok(p('Martes 25% con Banco Hipotecario MODO', 'Promoción válida en todas las sucursales físicas desde el 01/09/26.'));
  // No valen en Santiago
  assert.ok(!p('Viernes 30% de reintegro con Banco Santa Cruz MODO', 'Tope $18.000.'));
  assert.ok(!p('30% con Banco Santa Fe MODO', 'Viernes y Sábado en Sucursales de la Pcia de Santa Fe.'));
  assert.ok(!p('CORDOBA · VISA · Banco de Córdoba (online)', 'Lunes 30% de descuento. TIENDA ON LINE Y SUCURSALES'));
  assert.ok(!p('Lunes 15% con Mercado Pago', 'Promoción válida en todas las sucursales físicas en las regiones: La pampa- Buenos aires - Santa fe'));
  assert.ok(!p('Jueves 20% con ICBC MODO', 'Promoción válida en todas las sucursales físicas sólo para Rio Gallegos- Laboulaye'));
  assert.ok(!p('3 CSI con Favacard', 'Promoción válida en todas las sucursales físicas en: Trenque Lauquen - Azul.'));
  assert.ok(!p('Miércoles 10% con cuenta DNI', 'Tope $5000.'));
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
