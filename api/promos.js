// Promociones bancarias publicadas por las tiendas. GET /api/promos
// No usa inteligencia artificial: no tiene costo.
const { obtenerPromos, hoyEnArgentina } = require('../lib/promos');

module.exports = async function promos(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const datos = await obtenerPromos();
    res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=600');
    res.statusCode = 200;
    res.end(JSON.stringify({ ...datos, hoy: hoyEnArgentina() }));
  } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'No se pudieron cargar las promociones. Probá de nuevo.' }));
  }
};
