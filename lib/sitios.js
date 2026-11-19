// Lista de tiendas. Cada una indica su rubro y cómo se la consulta: la mayoría usa
// un adaptador por plataforma (lib/plataformas.js); unas pocas tienen uno propio.
const {
  vtex, shopify, tiendanube, fichas, magento, magentoPagina, salesforce,
  pedirJson, pedirHtml, decodificarHtml, precioAnterior, MAXIMO_POR_SITIO,
} = require('./plataformas');

const RUBROS = [
  { id: 'farmacia', nombre: 'Farmacias' },
  { id: 'super', nombre: 'Supermercados' },
  { id: 'deportes', nombre: 'Deportes y marcas' },
  { id: 'moda', nombre: 'Calzado y moda' },
  { id: 'perfumeria', nombre: 'Perfumería y cosmética' },
  { id: 'bazar', nombre: 'Bazar y juguetería' },
];

// ---------- Tiendas con adaptador propio ----------

// Drubbit: la plataforma de Farmacia La Esquina y de Farmacias Selma.
const drubbit = (id, base) => async function buscar(consulta) {
  const datos = await pedirJson(`${base}/api/catalog/shop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters: ['shop'], page: 1, limit: MAXIMO_POR_SITIO, search: consulta }),
  });
  const productos = (datos.data && datos.data.shop && datos.data.shop.products) || [];
  return productos.flatMap((producto) => {
    const variante = (producto.variants || [])[0];
    const precio = variante && variante.pvPrice;
    if (!precio) return [];
    const imagen = producto.images && producto.images[0];
    const foto = imagen && (imagen.square || imagen.thumb);
    return [{
      sitio: id,
      nombre: producto.name,
      marca: (producto.brand && producto.brand.name) || '',
      ean: variante.ean || '',
      precio: precio.price,
      precioLista: precio.prevPrice || precio.price,
      stock: !variante.stock || variante.stock.availability === 'InStock',
      url: `${base}/p/${producto.urlName}/${producto.id}`,
      imagen: (foto && foto.fullUrl) || '',
    }];
  });
};

// Farmacia Leloir: la búsqueda se envía como formulario y devuelve la página de resultados.
async function buscarLeloir(consulta) {
  const base = 'https://www.farmacialeloir.com.ar';
  const cuerpo = new URLSearchParams({ _method: 'POST', 'data[Busqueda][string]': consulta });
  const pedir = () => pedirHtml(`${base}/articulos/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo.toString(),
  });
  // Su servidor a veces responde con error 500: se reintenta una vez.
  const html = await pedir().catch(() => pedir());
  const pesos = (texto) => Number(String(texto || '').replace(/[^\d,]/g, '').replace(',', '.'));
  return html.split('ns-item-list-grid card product-card').slice(1, MAXIMO_POR_SITIO + 1).flatMap((bloque) => {
    const titulo = bloque.match(/class="product-title[^"]*">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const precioOferta = bloque.match(/class="ns-off-price">([^<]+)</);
    const precioNormal = bloque.match(/class="product-price">\s*(?:<span[^>]*>)?\s*(\$[\d.,]+)/);
    const precio = pesos((precioOferta || precioNormal || [])[1]);
    if (!titulo || !precio) return [];
    const anterior = bloque.match(/<del[^>]*>([^<]+)<\/del>/);
    const marca = bloque.match(/ns-item-list-brand-name[^"]*">([^<]+)</);
    const imagen = bloque.match(/data-src="(https:[^"]+)"/);
    return [{
      sitio: 'leloir',
      nombre: decodificarHtml(titulo[2]),
      marca: marca ? decodificarHtml(marca[1]) : '',
      ean: '',
      precio,
      precioLista: precioAnterior(anterior && pesos(anterior[1]), precio),
      stock: /js-add-to-cart/.test(bloque),
      url: base + titulo[1],
      imagen: imagen ? imagen[1] : '',
    }];
  });
}

// La Anónima no tiene un servicio de datos público: los productos se leen de la
// misma página de resultados que ve una persona en el navegador.
function atributo(bloque, nombre) {
  const encontrado = bloque.match(new RegExp(`data-${nombre}\\s*=\\s*"([^"]*)"`));
  return encontrado ? decodificarHtml(encontrado[1]) : '';
}

async function buscarLaAnonima(consulta) {
  const base = 'https://www.laanonima.com.ar';
  const html = await pedirHtml(`${base}/buscar/${encodeURIComponent(consulta)}`);
  return html.split('class="producto-item').slice(1, MAXIMO_POR_SITIO + 1).flatMap((bloque) => {
    const precio = Number(atributo(bloque, 'precio'));
    const enlace = bloque.match(/href="(\/[^"]*\/art_\d+\/)"/);
    const imagen = bloque.match(/data-src="(https:\/\/[^"]+)"/);
    const nombre = atributo(bloque, 'nombre');
    if (!nombre || !precio || !enlace) return [];
    // Precio "Plus": "Llevando 2, pagás $6.060 c/u".
    const plus = bloque.match(/class="precio plus"[\s\S]{0,200}?<span>\s*\$\s*([\d.]+)(?:<span class="decimal">,(\d+))?[\s\S]{0,400}?Llevando\s+(\d+)/);
    const precioPlus = plus ? Number(plus[1].replace(/\./g, '') + '.' + (plus[2] || '0')) : 0;
    const promoCantidad = precioPlus && precioPlus < precio
      ? { unidades: Number(plus[3]), precioUnidad: precioPlus, texto: `Llevando ${plus[3]}, pagás $${plus[1]} c/u` }
      : undefined;
    return [{
      sitio: 'laanonima',
      promoCantidad,
      nombre,
      marca: atributo(bloque, 'marca'),
      palabrasClave: atributo(bloque, 'rutacategorias'),
      ean: '', // este sitio no publica el código de barras
      precio,
      precioLista: precioAnterior(atributo(bloque, 'precio_anterior'), precio),
      stock: atributo(bloque, 'existencia-super') !== 'N',
      url: base + enlace[1],
      imagen: imagen ? imagen[1] : '',
    }];
  });
}

// Las Mil Novedades (Santiago del Estero) usa WooCommerce, que trae un buscador
// público. Su "SKU" muchas veces es el código de barras del producto.
const woocommerce = (id, base) => async function buscar(consulta) {
  const datos = await pedirJson(`${base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(consulta)}&per_page=${MAXIMO_POR_SITIO}`);
  return (Array.isArray(datos) ? datos : []).flatMap((producto) => {
    const precios = producto.prices || {};
    const divisor = 10 ** (Number(precios.currency_minor_unit) || 0);
    const precio = Number(precios.price) / divisor;
    if (!precio) return [];
    return [{
      sitio: id,
      nombre: decodificarHtml(producto.name || ''),
      marca: '',
      palabrasClave: decodificarHtml((producto.categories || []).map((c) => c.name).join(' ')),
      ean: producto.sku || '',
      precio,
      precioLista: precioAnterior(Number(precios.regular_price) / divisor, precio),
      stock: producto.is_in_stock !== false,
      url: producto.permalink || base,
      imagen: (producto.images && producto.images[0] && producto.images[0].src) || '',
    }];
  });
};

// ---------- Lista de tiendas ----------
// [id, nombre, rubro, adaptador, extras]
// extras.reputacion: nombre de la tienda en public/reputacion-tiendas.json, cuando difiere.
// extras.aviso: texto que se muestra junto a cada precio de esa tienda.
const T = (id, nombre, rubro, buscar, extras = {}) => ({ id, nombre, rubro, buscar, ...extras });

const SITIOS = [
  // Farmacias
  T('laesquina', 'La Esquina', 'farmacia', drubbit('laesquina', 'https://farmacialaesquina.com.ar'), { reputacion: 'Farmacia La Esquina' }),
  T('selma', 'Farmacias Selma', 'farmacia', drubbit('selma', 'https://selmadigital.com')),
  T('leloir', 'Farmacia Leloir', 'farmacia', buscarLeloir),
  T('farmacity', 'Farmacity', 'farmacia', vtex('farmacity', 'https://www.farmacity.com')),
  T('farmalife', 'Farmalife', 'farmacia', vtex('farmalife', 'https://www.farmalife.com.ar')),
  T('farmaonline', 'Farmaonline', 'farmacia', vtex('farmaonline', 'https://www.farmaonline.com')),
  // Supermercados
  T('masonline', 'MásOnline', 'super', vtex('masonline', 'https://www.masonline.com.ar')),
  T('vea', 'Vea', 'super', vtex('vea', 'https://www.vea.com.ar')),
  T('laanonima', 'La Anónima', 'super', buscarLaAnonima),
  // Perfumería y cosmética
  T('beauty24', 'Beauty24', 'perfumeria', vtex('beauty24', 'https://www.beauty24.com.ar')),
  T('todoperfumes', 'Todoperfumes', 'perfumeria', tiendanube('todoperfumes', 'https://www.todoperfumes.net'), { aviso: 'NO ORIGINAL: inspirado en' }),
  T('mixperfume', 'Mixperfume', 'perfumeria', shopify('mixperfume', 'https://www.mixperfume.com.ar'), { aviso: 'Decant: perfume original fraccionado' }),
  T('juleriaque', 'Juleriaque', 'perfumeria', vtex('juleriaque', 'https://www.juleriaque.com.ar')),
  T('rouge', 'Rouge', 'perfumeria', vtex('rouge', 'https://www.perfumeriasrouge.com')),
  T('pigmento', 'Pigmento', 'perfumeria', vtex('pigmento', 'https://www.perfumeriaspigmento.com.ar')),
  T('loccitane', "L'Occitane", 'perfumeria', shopify('loccitane', 'https://ar.loccitane.com')),
  // Bazar y juguetería
  T('lasmilnovedades', 'Las Mil Novedades', 'bazar', woocommerce('lasmilnovedades', 'https://lasmilnovedades.com'), { aviso: 'Mayorista: compra online mínima de $80.000' }),

  // Deportes y marcas oficiales
  T('enasport', 'ENA Sport', 'deportes', shopify('enasport', 'https://www.enasport.com')),
  T('puma', 'Puma', 'deportes', fichas('puma', 'https://ar.puma.com', '/search?q=')),
  T('topper', 'Topper', 'deportes', vtex('topper', 'https://www.topper.com.ar')),
  T('fila', 'Fila', 'deportes', vtex('fila', 'https://tienda.fila.com.ar')),
  T('reebok', 'Reebok', 'deportes', shopify('reebok', 'https://reebok.com.ar')),
  T('underarmour', 'Under Armour', 'deportes', vtex('underarmour', 'https://www.underarmour.com.ar')),
  T('saucony', 'Saucony', 'deportes', tiendanube('saucony', 'https://saucony.com.ar')),
  T('crocs', 'Crocs', 'deportes', shopify('crocs', 'https://www.crocs.com.ar')),
  T('columbia', 'Columbia', 'deportes', shopify('columbia', 'https://columbiasportswear.com.ar')),
  T('dcshoes', 'DC Shoes', 'deportes', magento('dcshoes', 'https://www.dcshoes.com.ar')),
  T('kappa', 'Kappa', 'deportes', shopify('kappa', 'https://www.kappastore.com.ar')),
  T('decathlon', 'Decathlon', 'deportes', shopify('decathlon', 'https://decathlon.com.ar')),
  T('atomik', 'Atomik', 'deportes', vtex('atomik', 'https://www.atomik.com.ar')),
  T('asics', 'Asics', 'deportes', vtex('asics', 'https://www.asics.com.ar')),
  T('newbalance', 'New Balance', 'deportes', salesforce('newbalance', 'https://www.newbalance.com.ar', '/search?q=')),
  T('dexter', 'Dexter', 'deportes', salesforce('dexter', 'https://www.dexter.com.ar')),
  T('stockcenter', 'Stock Center', 'deportes', salesforce('stockcenter', 'https://www.stockcenter.com.ar')),
  T('moov', 'Moov', 'deportes', salesforce('moov', 'https://www.moov.com.ar')),
  T('puntodeportivo', 'Punto Deportivo', 'deportes', vtex('puntodeportivo', 'https://www.puntodeportivo.com.ar')),
  T('mccenter', 'Mc Center Deportes', 'deportes', tiendanube('mccenter', 'https://mccenter.com.ar')),
  T('kavak', 'Kavak Deportes', 'deportes', woocommerce('kavak', 'https://kavak.com.ar')),
  T('sporting', 'Sporting', 'deportes', vtex('sporting', 'https://www.sporting.com.ar')),
  T('ferreira', 'Ferreira Sport', 'deportes', vtex('ferreira', 'https://www.ferreirasport.com')),
  T('woker', 'Woker', 'deportes', vtex('woker', 'https://www.wokerbysporting.com.ar')),
  T('septimo', 'Séptimo Store', 'deportes', vtex('septimo', 'https://www.septimostore.com'), { reputacion: 'Septimo' }),
  T('newsport', 'New Sport', 'deportes', vtex('newsport', 'https://www.newsport.com.ar')),
  T('fuencarral', 'Fuencarral', 'deportes', vtex('fuencarral', 'https://www.tiendafuencarral.com.ar')),
  T('cero26', 'Cero26', 'deportes', vtex('cero26', 'https://www.cero26.com.ar')),
  T('mateu', 'Mateu Sports', 'deportes', vtex('mateu', 'https://www.mateusports.com.ar')),
  T('rossetti', 'Rossetti', 'deportes', vtex('rossetti', 'https://www.rossettideportes.com')),
  T('solodeportes', 'Solo Deportes', 'deportes', magentoPagina('solodeportes', 'https://www.solodeportes.com.ar')),
  T('sportline', 'Sportline', 'deportes', vtex('sportline', 'https://www.sportline.com.ar')),
  T('marathon', 'Marathon', 'deportes', shopify('marathon', 'https://marathon.com.ar')),
  T('victoria', 'Victoria Deportes', 'deportes', tiendanube('victoria', 'https://www.victoriadeportes.com')),
  T('vandalia', 'Vandalia', 'deportes', tiendanube('vandalia', 'https://www.vandalia.com.ar')),
  T('somosdeportes', 'Somos Deportes', 'deportes', tiendanube('somosdeportes', 'https://www.somosdeportes.com.ar')),

  // Calzado y moda
  T('grid', 'Grid', 'moda', vtex('grid', 'https://www.grid.com.ar')),
  T('solourbano', 'Solo Urbano', 'moda', magentoPagina('solourbano', 'https://www.solourbano.com')),
  T('pacogarcia', 'Paco García', 'moda', vtex('pacogarcia', 'https://www.pacogarcia.com.ar')),
  T('indonesia', 'Indonesia Shop', 'moda', tiendanube('indonesia', 'https://www.indonesiashop.com.ar')),
  T('vallejo', 'Vallejo Calzados', 'moda', vtex('vallejo', 'https://www.vallejocalzados.com.ar'), { reputacion: 'Calzados Vallejo' }),
  T('aurelius', 'Aurelius', 'moda', vtex('aurelius', 'https://www.aurelius.com.ar')),
  T('gostore', 'Go Store', 'moda', magento('gostore', 'https://gostore.com.ar')),
  T('47street', '47 Street', 'moda', vtex('47street', 'https://www.47street.com.ar')),
  T('cuestablanca', 'Cuesta Blanca', 'moda', vtex('cuestablanca', 'https://www.cuestablanca.com')),
  T('mimo', 'Mimo & Co', 'moda', vtex('mimo', 'https://www.mimo.com.ar'), { reputacion: 'Mimo' }),
  T('briganti', 'Briganti', 'moda', shopify('briganti', 'https://briganti.com.ar')),
  T('tejano', 'Tejano', 'moda', tiendanube('tejano', 'https://www.tejano.com.ar')),
  T('burgues', 'Burgues', 'moda', magento('burgues', 'https://burgues.com')),
  T('anation', 'Anation', 'moda', tiendanube('anation', 'https://www.anation.com.ar')),
];

module.exports = { SITIOS, RUBROS };
