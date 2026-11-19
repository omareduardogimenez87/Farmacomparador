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

test('un sitio caído no rompe la búsqueda y la oferta sin stock no se muestra', async () => {
  const r = await comparar('crema', [
    { id: 'caido', nombre: 'caido', buscar: async () => { throw new Error('El sitio respondió con error 503'); } },
    sitio('a', [producto('a', 'Crema', '7790000000017', 100, { stock: false })]),
    sitio('b', [producto('b', 'Crema', '7790000000017', 300)]),
  ]);
  assert.deepStrictEqual(r.sitios.map((s) => s.ok), [false, true, true]);
  assert.deepStrictEqual(r.grupos[0].ofertas.map((o) => o.sitio), ['b']);
});

test('un código de barras busca el producto exacto y lo pone primero', async () => {
  const yerba = (sitio, ean, precio) => producto(sitio, 'Yerba Mate Suave Playadito 500 g', ean, precio);
  const r = await comparar('7793704000911', [
    sitio('a', [yerba('a', '7793704000911', 2690), producto('a', 'Yerba Rosamonte 1 kg', '7790411001514', 4490)]),
    sitio('b', [yerba('b', '', 2550)]),
  ]);
  assert.strictEqual(r.codigo, '7793704000911');
  assert.strictEqual(r.nombre, 'Yerba Mate Suave Playadito 500 g');
  assert.strictEqual(r.grupos[0].ean, '7793704000911');
  assert.ok(r.grupos.every((g) => !/rosamonte/i.test(g.nombre)));
});

test('un código que ninguna tienda tiene devuelve cero resultados', async () => {
  const r = await comparar('7790000000017', [sitio('a', [producto('a', 'Otra cosa', '7791111111116', 100)])]);
  assert.strictEqual(r.grupos.length, 0);
  assert.strictEqual(r.codigo, '7790000000017');
});

test('"zapatillas" encuentra "Zapatilla" y "botines" encuentra "Botín"', async () => {
  const r = await comparar('zapatillas', [sitio('a', [producto('a', 'Zapatilla Topper Boris', '', 100), producto('a', 'Remera Topper', '', 50)])]);
  assert.deepStrictEqual(r.grupos.map((g) => g.nombre), ['Zapatilla Topper Boris']);
  const b = await comparar('botines', [sitio('a', [producto('a', 'Botín Nike Phantom', '', 100)])]);
  assert.strictEqual(b.grupos.length, 1);
});

test('une productos con talles si comparten el código de algún talle', async () => {
  const r = await comparar('campus', [
    sitio('a', [producto('a', 'Zapatillas adidas Campus 00s', '4067906317287', 129999, { eans: ['4067906317287', '4067906317294'] })]),
    sitio('b', [producto('b', 'Zapatilla Adidas Campus 00s Niño', '4067906317294', 119999, { eans: ['4067906317294', '4067906317300'] })]),
  ]);
  assert.strictEqual(r.grupos.length, 1);
  assert.deepStrictEqual(r.grupos[0].ofertas.map((o) => o.sitio), ['b', 'a']);
});

test('con muchas coincidencias completas se descartan las parciales', async () => {
  const completas = Array.from({ length: 10 }, (_, i) => producto('a', `Zapatilla Campus ${i}`, '', 100 + i));
  const r = await comparar('zapatilla campus', [sitio('a', [...completas, producto('a', 'Zapatilla Superstar', '', 50)])]);
  assert.strictEqual(r.grupos.length, 10);
  assert.ok(r.grupos.every((g) => /campus/i.test(g.nombre)));
});

test('usa las palabras de la dirección del producto cuando el nombre no dice qué es', async () => {
  const r = await comparar('zapatillas', [sitio('a', [producto('a', '1300 Waterproof 4E', '', 164849, { url: 'https://www.newbalance.com.ar/hombre-zapatillas-N1T000045080031.html' })])]);
  assert.strictEqual(r.grupos.length, 1);
});

test('ordena los productos del más barato al más caro', async () => {
  const r = await comparar('yerba', [
    sitio('a', [producto('a', 'Yerba Uno', '7790000000017', 5000), producto('a', 'Yerba Dos', '7790000000024', 2000)]),
    sitio('b', [producto('b', 'Yerba Tres', '7790000000031', 3500)]),
  ]);
  assert.deepStrictEqual(r.grupos.map((g) => g.nombre), ['Yerba Dos', 'Yerba Tres', 'Yerba Uno']);
});

test('una promo por cantidad más barata gana el primer lugar', async () => {
  const r = await comparar('shampoo', [
    sitio('a', [producto('a', 'Shampoo Fructis 350', '7791290000017', 10100, { promoCantidad: { unidades: 2, precioUnidad: 6060, texto: 'Llevando 2' } })]),
    sitio('b', [producto('b', 'Shampoo Fructis 350', '7791290000017', 8000)]),
    sitio('c', [producto('c', 'Shampoo Sedal', '7791290000024', 7000)]),
  ]);
  assert.strictEqual(r.grupos[0].nombre, 'Shampoo Fructis 350');
  assert.deepStrictEqual(r.grupos[0].ofertas.map((o) => [o.sitio, o.precioFinal]), [['a', 6060], ['b', 8000]]);
});
