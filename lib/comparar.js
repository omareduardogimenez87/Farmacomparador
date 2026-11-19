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
// "1 litro", "1 L", "1lt", "1 lts" y "1000 ml" son lo mismo: se pasan todas a "1l".
// Igual con los pesos: "500 g", "500 gr" y "0,5 kg" pasan a "0.5kg".
const UNIDADES = [
  [/(\d+(?:\.\d+)?)\s*(?:mililitros?|ml|cc|cm3)\b/g, 1 / 1000, 'l'],
  [/(\d+(?:\.\d+)?)\s*(?:litros?|lts?|l)\b\.?/g, 1, 'l'],
  [/(\d+(?:\.\d+)?)\s*(?:gramos?|grs?|g)\b\.?/g, 1 / 1000, 'kg'],
  [/(\d+(?:\.\d+)?)\s*(?:kilos?|kgs?)\b\.?/g, 1, 'kg'],
];

function normalizarMedidas(texto) {
  let t = texto.replace(/(\d),(\d)/g, '$1.$2');
  for (const [patron, factor, unidad] of UNIDADES) {
    t = t.replace(patron, (_, cantidad) => ` ${Number((Number(cantidad) * factor).toFixed(4))}${unidad} `);
  }
  return t.replace(/\s+/g, ' ').trim();
}

// Palabras que no dicen qué producto es: no se exigen.
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'en', 'x', 'a', 'por', 'un', 'una', 'al']);

// Formas distintas de decir lo mismo. "dama" encuentra "mujer", pero no "niña".
const GRUPOS_DE_SINONIMOS = [
  ['dama', 'damas', 'mujer', 'mujeres', 'femenino', 'femenina', 'women', 'woman', 'wmns', 'lady', 'ladies'],
  ['hombre', 'hombres', 'caballero', 'caballeros', 'masculino', 'masculina', 'men', 'man', 'varon'],
  ['nino', 'ninos', 'nina', 'ninas', 'kids', 'infantil', 'junior', 'jr', 'nene', 'nena'],
  ['zapatilla', 'zapatillas', 'sneaker', 'sneakers'],
  ['remera', 'remeras', 'camiseta', 'camisetas', 't-shirt', 'tshirt'],
  ['buzo', 'buzos', 'hoodie', 'sudadera'],
];
const SINONIMOS = new Map();
for (const grupo of GRUPOS_DE_SINONIMOS) for (const palabra of grupo) SINONIMOS.set(palabra, grupo);

// Una palabra coincide si aparece ella, su singular o un sinónimo. Las muy cortas
// ("men", "jr") tienen que aparecer como palabra entera: "complemento" no es "men".
function coincidePalabra(texto, palabra) {
  const alternativas = SINONIMOS.get(palabra) || [palabra];
  return alternativas.some((alt) => {
    if (alt.length <= 4) return new RegExp(`(?<![a-z0-9])${alt.replace(/[-]/g, '\\-')}(?![a-z0-9])`).test(texto);
    return variantes(alt).some((v) => texto.includes(v));
  });
}

// "remera de dama talle s" -> { sinTalle: "remera de dama", talle: "S" }.
function separarTalle(consulta) {
  const encontrado = consulta.match(/\btalles?\s+([a-z0-9]{1,4})\b/i);
  if (!encontrado) return { sinTalle: consulta, talle: null };
  return { sinTalle: consulta.replace(encontrado[0], ' ').replace(/\s+/g, ' ').trim(), talle: encontrado[1].toUpperCase() };
}

const esNumero = (palabra) => /^\d+$/.test(palabra);
const esMedida = (palabra) => /^\d+(?:\.\d+)?(?:l|kg)$/.test(palabra);

// Devuelve 3 si el producto tiene todas las palabras buscadas y su nombre empieza con
// la primera ("Leche Descremada" para "leche", y no "Alfajor de dulce de leche"),
// 2 si tiene todas, 1 si tiene solo algunas (por ejemplo "Actron 400" cuando se buscó
// "ibuprofeno 400") y 0 si hay que descartarlo. Números y medidas (400, 1l, 500g)
// son obligatorios, y "50" no vale como coincidencia dentro de "500".
function relevancia(producto, palabras) {
  const texto = normalizarMedidas(normalizar(`${producto.nombre} ${producto.marca} ${producto.palabrasClave || ''} ${palabrasDeLaDireccion(producto.url)}`));
  const obligatorias = palabras.filter((p) => esNumero(p) || esMedida(p));
  const textos = palabras.filter((p) => !esNumero(p) && !esMedida(p) && !PALABRAS_VACIAS.has(p));

  const tiene = (valor) => new RegExp(`(?<![\\d.])${valor.replace('.', '\\.')}(?![\\d.])`).test(texto);
  if (!obligatorias.every(tiene)) return 0;

  const aciertos = textos.filter((palabra) => coincidePalabra(texto, palabra)).length;
  if (aciertos === textos.length) {
    // Solo para búsquedas de una palabra ("leche"): en las más largas ("ibuprofeno
    // 400") muchas tiendas ponen la marca primero y manda el precio.
    if (textos.length !== 1 || obligatorias.length) return 2;
    const nombre = normalizar(producto.nombre).trim();
    return variantes(textos[0]).some((v) => nombre.startsWith(v)) ? 3 : 2;
  }
  return aciertos > 0 || obligatorias.length > 0 ? 1 : 0;
}

// Algunas tiendas nombran los productos sin decir qué son ("1300 Waterproof 4E" en
// New Balance), pero la dirección sí lo dice: /hombre-zapatillas-N1T000045080031.html
function palabrasDeLaDireccion(url) {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/\.html?$/, '').replace(/[-_/]+/g, ' ');
  } catch {
    return '';
  }
}

// "zapatillas" tiene que encontrar "Zapatilla Topper" y "botines" a "Botín Nike":
// se prueba la palabra tal cual, sin la "s" final y sin el "es" final.
function variantes(palabra) {
  return [palabra, palabra.replace(/s$/, ''), palabra.replace(/es$/, '')].filter((v, i, todas) => v.length >= 4 && todas.indexOf(v) === i);
}

// El código de barras es lo único que garantiza que dos productos son el mismo.
// Se descartan los códigos internos cortos que usan algunos sitios para combos,
// y los que tienen letras (como "TH-05S"), que no son códigos de barras.
// También se descartan los que empiezan con 2: son códigos que cada comercio
// inventa para uso propio, y dos tiendas pueden usar el mismo para cosas distintas.
function claveEan(ean) {
  const texto = String(ean || '').trim();
  if (!/^\d+$/.test(texto)) return null;
  const digitos = texto.replace(/^0+/, '');
  if (digitos.length < 12 || digitos.length > 14) return null;
  if (digitos.length === 13 && digitos.startsWith('2')) return null;
  return digitos;
}

// Precio por unidad que realmente se paga: si llevando 2 (o más) cada unidad sale
// más barata, se usa ese precio para decidir cuál es la oferta más barata.
function precioEfectivo(oferta) {
  const promo = oferta.promoCantidad;
  return promo && promo.precioUnidad > 0 && promo.precioUnidad < oferta.precio ? promo.precioUnidad : oferta.precio;
}

function agrupar(productos) {
  const grupos = new Map();
  // Un producto con talles tiene un código por talle: si dos tiendas comparten
  // cualquiera de esos códigos, es el mismo producto.
  const grupoDeCodigo = new Map();
  productos.forEach((producto, orden) => {
    const codigos = [...new Set([producto.ean, ...(producto.eans || [])].map(claveEan).filter(Boolean))];
    const existente = codigos.map((c) => grupoDeCodigo.get(c)).find(Boolean);
    const ean = claveEan(producto.ean) || codigos[0] || null;
    const clave = existente || ean || `${producto.sitio}:${producto.url}`;
    for (const codigo of codigos) if (!grupoDeCodigo.has(codigo)) grupoDeCodigo.set(codigo, clave);
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
    else if (precioEfectivo(producto) < precioEfectivo(grupo.ofertas[previa])) grupo.ofertas[previa] = producto;
  });

  const lista = [...grupos.values()];
  for (const grupo of lista) {
    grupo.ofertas.sort((a, b) => Number(b.stock) - Number(a.stock) || precioEfectivo(a) - precioEfectivo(b));
    grupo.relevancia = Math.max(0, ...grupo.ofertas.map((o) => o.relevancia || 0));
    grupo.precioMinimo = precioEfectivo(grupo.ofertas[0]);
    grupo.ofertas = grupo.ofertas.map(({ ean, eans, imagen, marca, palabrasClave, relevancia, ...oferta }) => ({
      ...oferta,
      precioFinal: precioEfectivo(oferta),
    }));
  }
  // Primero lo que coincide con todas las palabras buscadas, y dentro de eso, del
  // precio más barato al más caro (contando las promos por cantidad).
  lista.sort((a, b) => b.relevancia - a.relevancia || a.precioMinimo - b.precioMinimo || a.orden - b.orden);
  return lista.map(({ orden, relevancia, ...grupo }) => grupo);
}

// Le pregunta a todas las tiendas a la vez. "filtrar" decide qué productos se quedan.
// Los buscadores de las tiendas a veces entienden peor una medida ("leche 1 litro")
// que la palabra sola ("leche"). Con una medida en la búsqueda se pregunta de las dos
// formas, se juntan los resultados y la app filtra por la medida.
function consultasParaTiendas(consulta) {
  const sinMedidas = consulta
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:mililitros?|ml|cc|litros?|lts?|l|gramos?|grs?|gr|g|kilos?|kgs?|kg)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sinMedidas && sinMedidas.length >= 3 && sinMedidas !== consulta.trim() ? [consulta, sinMedidas] : [consulta];
}

async function buscarEnSitio(sitio, consulta) {
  const consultas = consultasParaTiendas(consulta);
  if (consultas.length === 1) return sitio.buscar(consulta);
  const resultados = await Promise.allSettled(consultas.map((c) => sitio.buscar(c)));
  if (resultados.every((r) => r.status === 'rejected')) throw resultados[0].reason;
  const vistos = new Set();
  return resultados.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).filter((p) => {
    const clave = p.url || `${p.nombre}|${p.precio}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

async function consultarSitios(consulta, sitios, filtrar) {
  const estados = [];
  const porSitio = await Promise.all(
    sitios.map(async (sitio) => {
      const inicio = Date.now();
      try {
        // Los productos sin stock no se muestran: no se pueden comprar.
        const encontrados = (await buscarEnSitio(sitio, consulta)).filter((producto) => producto.precio > 0 && producto.stock !== false && filtrar(producto));
        estados.push({ id: sitio.id, nombre: sitio.nombre, rubro: sitio.rubro, ok: true, cantidad: encontrados.length, ms: Date.now() - inicio });
        return encontrados;
      } catch (error) {
        const motivo = error.name === 'TimeoutError' ? 'El sitio tardó demasiado en responder' : error.message;
        estados.push({ id: sitio.id, nombre: sitio.nombre, rubro: sitio.rubro, ok: false, cantidad: 0, error: motivo, ms: Date.now() - inicio });
        return [];
      }
    })
  );
  estados.sort((a, b) => sitios.findIndex((s) => s.id === a.id) - sitios.findIndex((s) => s.id === b.id));

  // Se intercalan los resultados para respetar el orden de relevancia de cada sitio.
  const intercalados = [];
  const maximo = Math.max(0, ...porSitio.map((lista) => lista.length));
  for (let i = 0; i < maximo; i++) {
    for (const lista of porSitio) if (lista[i]) intercalados.push(lista[i]);
  }
  return { estados, productos: intercalados };
}

// minimo 1 acepta coincidencias parciales; minimo 2 exige todas las palabras.
async function compararPorTexto(consultaOriginal, sitios, minimo = 1) {
  const { sinTalle, talle } = separarTalle(consultaOriginal);
  const consulta = sinTalle || consultaOriginal;
  const palabras = normalizarMedidas(normalizar(consulta)).split(/\s+/).filter(Boolean);
  const { estados, productos } = await consultarSitios(consulta, sitios, (producto) => {
    // Con talle pedido, solo cuentan los productos que tienen ese talle con stock.
    // Las tiendas que no informan talles quedan afuera: no se puede asegurar que lo tengan.
    if (talle && !(producto.talles && producto.talles.includes(talle))) return false;
    producto.relevancia = relevancia(producto, palabras);
    return producto.relevancia >= minimo;
  });
  // Las coincidencias completas van antes que las parciales.
  productos.sort((a, b) => b.relevancia - a.relevancia);
  // Si hay productos con todo lo que se pidió, se muestran solo esos. Las
  // coincidencias parciales aparecen únicamente cuando no hay ninguna completa.
  const completas = productos.filter((p) => p.relevancia >= 2).length;
  const parciales = completas === 0 && productos.length > 0;
  if (completas > 0) productos.splice(completas);
  // Cada tienda muestra cuántos productos quedaron de verdad después de filtrar.
  for (const estado of estados) {
    if (estado.ok) estado.cantidad = productos.filter((p) => p.sitio === estado.id).length;
  }
  return { consulta: consultaOriginal, talle, parciales, sitios: estados, grupos: agrupar(productos) };
}

// Un nombre de producto largo ("Yerba Mate Suave Playadito 500 Gr") se achica a
// sus palabras útiles para buscarlo en las tiendas que no publican el código.
function nombreParaBuscar(nombre) {
  return normalizar(nombre)
    .replace(/[^a-z0-9ñ ]/g, ' ')
    .split(/\s+/)
    .filter((palabra) => palabra.length > 2 && !/^\d+$/.test(palabra))
    .slice(0, 4)
    .join(' ');
}

// Búsqueda por código de barras (lo que devuelve el escáner del celular).
// Primero se busca el código exacto; con el nombre encontrado se buscan también
// las tiendas que no publican el código, y el producto exacto queda primero.
async function compararPorCodigo(codigo, sitios) {
  const ean = claveEan(codigo);
  const exacto = await consultarSitios(codigo, sitios, (producto) => claveEan(producto.ean) === ean);
  const nombre = exacto.productos[0] && exacto.productos[0].nombre;
  if (!nombre) {
    return { consulta: codigo, codigo: ean, sitios: exacto.estados, grupos: [] };
  }
  const porNombre = await compararPorTexto(nombreParaBuscar(nombre), sitios, 2);
  const productos = [...exacto.productos, ...porNombre.grupos.flatMap((grupo) => grupo.ofertas.map((oferta) => ({ ...oferta, ean: grupo.ean || '', imagen: grupo.imagen, marca: grupo.marca })))];
  const grupos = agrupar(productos);
  grupos.sort((a, b) => Number(b.ean === ean) - Number(a.ean === ean));
  // Cada tienda cuenta lo que aportó en cualquiera de las dos búsquedas.
  const estados = exacto.estados.map((estado) => {
    const otro = porNombre.sitios.find((s) => s.id === estado.id);
    const cantidad = grupos.filter((g) => g.ofertas.some((o) => o.sitio === estado.id)).length;
    return { ...estado, ok: estado.ok || (otro && otro.ok), cantidad };
  });
  return { consulta: codigo, codigo: ean, nombre, sitios: estados, grupos };
}

function esCodigo(consulta) {
  return /^\d{8,14}$/.test(consulta.trim()) && claveEan(consulta) !== null;
}

async function comparar(consulta, sitios = SITIOS) {
  const limpia = String(consulta).trim();
  return esCodigo(limpia) ? compararPorCodigo(limpia, sitios) : compararPorTexto(limpia, sitios);
}

module.exports = { consultasParaTiendas, comparar, agrupar, normalizar, claveEan, esCodigo };
