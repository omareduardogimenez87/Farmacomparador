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
  const texto = normalizar(`${producto.nombre} ${producto.marca} ${producto.palabrasClave || ''} ${palabrasDeLaDireccion(producto.url)}`);
  const numeros = palabras.filter((palabra) => /^\d+$/.test(palabra));
  const textos = palabras.filter((palabra) => !/^\d+$/.test(palabra));

  const tieneNumero = (numero) => new RegExp(`(?<!\\d)${numero}(?!\\d)`).test(texto);
  if (!numeros.every(tieneNumero)) return 0;

  const aciertos = textos.filter((palabra) => variantes(palabra).some((v) => texto.includes(v))).length;
  if (aciertos === textos.length) return 2;
  return aciertos > 0 || numeros.length > 0 ? 1 : 0;
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
    else if (producto.precio < grupo.ofertas[previa].precio) grupo.ofertas[previa] = producto;
  });

  const lista = [...grupos.values()];
  for (const grupo of lista) {
    grupo.ofertas.sort((a, b) => Number(b.stock) - Number(a.stock) || a.precio - b.precio);
    grupo.ofertas = grupo.ofertas.map(({ ean, eans, imagen, marca, palabrasClave, relevancia, ...oferta }) => oferta);
  }
  // Primero los productos que están en más farmacias, que son los comparables.
  lista.sort((a, b) => b.ofertas.length - a.ofertas.length || a.orden - b.orden);
  return lista.map(({ orden, ...grupo }) => grupo);
}

// Le pregunta a todas las tiendas a la vez. "filtrar" decide qué productos se quedan.
async function consultarSitios(consulta, sitios, filtrar) {
  const estados = [];
  const porSitio = await Promise.all(
    sitios.map(async (sitio) => {
      const inicio = Date.now();
      try {
        // Los productos sin stock no se muestran: no se pueden comprar.
        const encontrados = (await sitio.buscar(consulta)).filter((producto) => producto.precio > 0 && producto.stock !== false && filtrar(producto));
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
async function compararPorTexto(consulta, sitios, minimo = 1) {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  const { estados, productos } = await consultarSitios(consulta, sitios, (producto) => {
    producto.relevancia = relevancia(producto, palabras);
    return producto.relevancia >= minimo;
  });
  // Las coincidencias completas van antes que las parciales.
  productos.sort((a, b) => b.relevancia - a.relevancia);
  // Si ya hay muchas coincidencias completas, las parciales solo agregan ruido
  // (buscando "zapatillas adidas campus", cualquier producto adidas). Cuando la
  // búsqueda tiene un número, las parciales sí sirven: el número ya es obligatorio
  // y Farmalife, por ejemplo, nombra "Actron 400" sin decir "ibuprofeno".
  const tieneNumero = palabras.some((p) => /^\d+$/.test(p));
  const completas = productos.filter((p) => p.relevancia === 2).length;
  if (completas >= 10 && !tieneNumero) productos.splice(completas);
  return { consulta, sitios: estados, grupos: agrupar(productos) };
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

module.exports = { comparar, agrupar, normalizar, claveEan, esCodigo };
