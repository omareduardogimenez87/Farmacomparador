const { SITIOS } = require('./sitios');

// "Ibuprofeno 400mg" y "IBUPROFENO 400 MG" tienen que poder compararse:
// se pasa todo a minúsculas y se quitan los acentos.
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

// Algunos buscadores devuelven productos que no tienen nada que ver.
// Devuelve 2 si el producto contiene todas las palabras buscadas, 1 si contiene
// solo algunas (por ejemplo "Actron 400" cuando se buscó "ibuprofeno 400") y
// 0 si hay que descartarlo. Los números (400, 50) son obligatorios, y "50" no
// vale como coincidencia dentro de "500".
function relevancia(producto, palabras) {
  const texto = normalizar(`${producto.nombre} ${producto.marca} ${producto.palabrasClave || ''}`);
  const numeros = palabras.filter((palabra) => /^\d+$/.test(palabra));
  const textos = palabras.filter((palabra) => !/^\d+$/.test(palabra));

  const tieneNumero = (numero) => new RegExp(`(?<!\\d)${numero}(?!\\d)`).test(texto);
  if (!numeros.every(tieneNumero)) return 0;

  const aciertos = textos.filter((palabra) => texto.includes(palabra)).length;
  if (aciertos === textos.length) return 2;
  return aciertos > 0 || numeros.length > 0 ? 1 : 0;
}

// El código de barras es lo único que garantiza que dos productos son el mismo.
// Se descartan los códigos internos cortos que usan algunos sitios para combos.
function claveEan(ean) {
  const digitos = String(ean || '').replace(/\D/g, '').replace(/^0+/, '');
  return digitos.length >= 12 && digitos.length <= 14 ? digitos : null;
}

function agrupar(productos) {
  const grupos = new Map();
  productos.forEach((producto, orden) => {
    const ean = claveEan(producto.ean);
    const clave = ean || `${producto.sitio}:${producto.url}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        ean,
        nombre: producto.nombre,
        marca: producto.marca,
        imagen: producto.imagen,
        orden,
        ofertas: [],
      });
    }
    const grupo = grupos.get(clave);
    if (!grupo.imagen) grupo.imagen = producto.imagen;
    // Si un sitio repite el mismo código, se conserva su precio más bajo.
    const previa = grupo.ofertas.findIndex((oferta) => oferta.sitio === producto.sitio);
    if (previa === -1) grupo.ofertas.push(producto);
    else if (producto.precio < grupo.ofertas[previa].precio) grupo.ofertas[previa] = producto;
  });

  const lista = [...grupos.values()];
  for (const grupo of lista) {
    grupo.ofertas.sort((a, b) => Number(b.stock) - Number(a.stock) || a.precio - b.precio);
    grupo.ofertas = grupo.ofertas.map(({ ean, imagen, marca, palabrasClave, relevancia, ...oferta }) => oferta);
  }
  // Primero los productos que están en más farmacias, que son los comparables.
  lista.sort((a, b) => b.ofertas.length - a.ofertas.length || a.orden - b.orden);
  return lista.map(({ orden, ...grupo }) => grupo);
}

async function comparar(consulta, sitios = SITIOS) {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  const estados = [];
  const porSitio = await Promise.all(
    sitios.map(async (sitio) => {
      const inicio = Date.now();
      try {
        const encontrados = (await sitio.buscar(consulta))
          .map((producto) => ({ ...producto, relevancia: relevancia(producto, palabras) }))
          .filter((producto) => producto.precio > 0 && producto.relevancia > 0);
        estados.push({ id: sitio.id, nombre: sitio.nombre, ok: true, cantidad: encontrados.length, ms: Date.now() - inicio });
        return encontrados;
      } catch (error) {
        const motivo = error.name === 'TimeoutError' ? 'El sitio tardó demasiado en responder' : error.message;
        estados.push({ id: sitio.id, nombre: sitio.nombre, ok: false, cantidad: 0, error: motivo, ms: Date.now() - inicio });
        return [];
      }
    })
  );

  // Se intercalan los resultados para respetar el orden de relevancia de cada sitio.
  const intercalados = [];
  const maximo = Math.max(0, ...porSitio.map((lista) => lista.length));
  for (let i = 0; i < maximo; i++) {
    for (const lista of porSitio) if (lista[i]) intercalados.push(lista[i]);
  }

  // Las coincidencias completas van antes que las parciales.
  intercalados.sort((a, b) => b.relevancia - a.relevancia);

  estados.sort((a, b) => sitios.findIndex((s) => s.id === a.id) - sitios.findIndex((s) => s.id === b.id));
  return { consulta, sitios: estados, grupos: agrupar(intercalados) };
}

module.exports = { comparar, agrupar, normalizar, claveEan };
