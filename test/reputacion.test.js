const test = require('node:test');
const assert = require('node:assert');
const guia = require('../public/reputacion-tiendas.json');
const { SITIOS } = require('../lib/sitios');

test('la guía de reputación tiene los campos y puntajes válidos', () => {
  assert.ok(Array.isArray(guia));
  for (const t of guia) {
    for (const campo of ['nombre', 'url', 'grupo', 'rubro', 'motivo']) assert.strictEqual(typeof t[campo], 'string', `${t.nombre}: ${campo}`);
    assert.ok(Number.isInteger(t.puntaje) && t.puntaje >= 1 && t.puntaje <= 10, `${t.nombre}: puntaje ${t.puntaje}`);
    assert.ok(t.motivo.length > 0, `${t.nombre}: sin motivo`);
  }
});

test('las tiendas vinculadas a mano existen en la guía', { skip: guia.length === 0 && 'la guía está vacía' }, () => {
  const nombres = new Set(guia.map((t) => t.nombre));
  for (const s of SITIOS.filter((x) => x.reputacion)) assert.ok(nombres.has(s.reputacion), `${s.id} → ${s.reputacion}`);
});
