const test = require('node:test');
const assert = require('node:assert');
const { comparar, claveEan } = require('../lib/comparar');

const producto = (sitio, nombre, ean, precio, extra = {}) => ({
  sitio, nombre, marca: '', ean, precio, precioLista: precio, stock: true, url: `https://${sitio}/${nombre}`, imagen: '', ...extra,
});
const sitio = (id, productos) => ({ id, nombre: id, buscar: async () => productos });

test('une el mismo código de barras entre farmacias y ordena por precio', async () => {
  const r = await comparar('actron 400', [
    sitio('a', [producto('a', 'Actron 400 x 20', '7793640992769', 8440)]),
    sitio('b', [producto('b', 'ACTRON Rápida Acción 400 mg', '07793640992769', 5064)]),
  ]);
  assert.strictEqual(r.grupos.length, 1);
  assert.deepStrictEqual(r.grupos[0].ofertas.map((o) => [o.sitio, o.precio]), [['b', 5064], ['a', 8440]]);
});

test('descarta lo que no coincide y deja al final las coincidencias parciales', async () => {
  const r = await comparar('ibuprofeno 400', [
    sitio('a', [
      producto('a', 'Esmalte de uñas 8 ml', '7891182035989', 4850),
      producto('a', 'Actron Rápida Acción 400 mg', '7793640992769', 8440),
      producto('a', 'Ibuprofeno 4000 UI', '7790000000024', 100),
      producto('a', 'Ibuprofeno 400 x 20', '7798420160383', 5570),
    ]),
  ]);
  assert.deepStrictEqual(r.grupos.map((g) => g.nombre), ['Ibuprofeno 400 x 20', 'Actron Rápida Acción 400 mg']);
});

test('con una sola palabra no acepta productos que no la contienen', async () => {
  const r = await comparar('actron', [sitio('a', [producto('a', 'Creatina Monohidrato', '', 100)])]);
  assert.strictEqual(r.grupos.length, 0);
});

test('no une productos sin código de barras confiable', async () => {
  assert.strictEqual(claveEan('10000914'), null);
  assert.strictEqual(claveEan('TH-05S'), null);
  assert.strictEqual(claveEan('2021041330213'), null);
  assert.strictEqual(claveEan('07799228000574'), '7799228000574');
  const r = await comparar('combo', [
    sitio('a', [producto('a', 'Combo uno', '10000914', 100)]),
    sitio('b', [producto('b', 'Combo dos', '10000914', 200)]),
  ]);
  assert.strictEqual(r.grupos.length, 2);
});

test('un sitio caído no rompe la búsqueda y la oferta sin stock va al final', async () => {
  const r = await comparar('crema', [
    { id: 'caido', nombre: 'caido', buscar: async () => { throw new Error('El sitio respondió con error 503'); } },
    sitio('a', [producto('a', 'Crema', '7790000000017', 100, { stock: false })]),
    sitio('b', [producto('b', 'Crema', '7790000000017', 300)]),
  ]);
  assert.deepStrictEqual(r.sitios.map((s) => s.ok), [false, true, true]);
  assert.deepStrictEqual(r.grupos[0].ofertas.map((o) => o.sitio), ['b', 'a']);
});
