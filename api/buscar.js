// Punto de entrada que usa la página: /api/buscar?q=ibuprofeno
// En Vercel, cada archivo dentro de /api se publica solo como una función.
const { comparar } = require('../lib/comparar');

module.exports = async function buscar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const consulta = (url.searchParams.get('q') || '').trim().slice(0, 80);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (consulta.length < 3) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Escribí al menos 3 letras para buscar.' }));
    return;
  }

  try {
    const resultado = await comparar(consulta);
    // La misma búsqueda se guarda 5 minutos para no consultar de más a las farmacias.
    res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');
    res.statusCode = 200;
    res.end(JSON.stringify(resultado));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'No se pudo completar la búsqueda. Probá de nuevo.' }));
  }
};
