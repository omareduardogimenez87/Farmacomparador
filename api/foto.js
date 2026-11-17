// Reconoce un producto a partir de una foto.
// POST /api/foto  { imagen: '<JPEG en base64>' }
const { identificarFoto } = require('../lib/ia');
const { responder, leerJson, revisarClave, errorDeIa } = require('../lib/http');

module.exports = async function foto(req, res) {
  if (req.method !== 'POST') return responder(res, 405, { error: 'Usá POST.' });
  if (!revisarClave(req, res)) return;

  let imagen;
  try {
    imagen = String((await leerJson(req)).imagen || '').replace(/^data:image\/\w+;base64,/, '');
  } catch (error) {
    return responder(res, 400, { error: error.message.includes('grande') ? error.message : 'La foto no se pudo leer.' });
  }
  if (!imagen || !/^[A-Za-z0-9+/=]+$/.test(imagen)) {
    return responder(res, 400, { error: 'No llegó ninguna foto.' });
  }

  try {
    responder(res, 200, await identificarFoto(imagen));
  } catch (error) {
    errorDeIa(res, error);
  }
};
