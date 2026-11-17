# Seco y furioso

(Antes se llamaba Farmacomparador. El repositorio, el proyecto de Vercel y la dirección web conservan ese nombre.)

App para el celular que busca un producto y muestra el precio en varias farmacias y supermercados online a la vez.

## Tiendas incluidas

| Tienda | Estado | Código de barras |
| --- | --- | --- |
| Farmacia La Esquina | Funciona | Sí |
| Farmacity | Funciona | Sí |
| Farmalife | Funciona | Sí |
| Farmaonline | Funciona (no vende medicamentos, sí perfumería y dermocosmética) | Sí |
| ENA Sport | Funciona | No |
| MásOnline | Funciona | Sí |
| Vea | Funciona | Sí |
| La Anónima | Funciona | No |
| Las Mil Novedades | Funciona (bazar, juguetería, librería, cotillón, electrónica). Precios mayoristas: la compra online mínima es de $80.000 | En muchos productos |
| Diarco | No incluida: su web no publica precios, y sus ofertas son folletos en imagen | — |
| Farmar | No incluida: su buscador exige una credencial de acceso | — |
| L'Oréal Paris | No incluida: el sitio no publica precios | — |

## Cómo compara

- Le hace la misma búsqueda a cada tienda al mismo tiempo.
- Si dos tiendas publican el **mismo código de barras (EAN)**, la app los junta en una sola tarjeta y marca el más barato. Es la única forma confiable de saber que es exactamente el mismo producto.
- Lo que no se puede emparejar por código (por ejemplo, todo ENA Sport y La Anónima) aparece en una tarjeta propia.
- Tocando la etiqueta de una tienda se ven solo sus productos.
- MásOnline, Vea y La Anónima pueden tener precios distintos según la sucursal o la zona. La app muestra el precio que cada sitio muestra por defecto, sin elegir sucursal.
- Los precios son los publicados en la web. No incluyen promociones bancarias, de obra social ni del tipo 2x1 o "segunda unidad".

## Funciones

- **Buscar** por nombre, o por **código de barras** (escribiendo los números o con la cámara).
- **Micrófono**: buscar o preguntar hablando. Usa el reconocimiento de voz del navegador, sin costo.
- **Cámara**: se saca una foto del producto. Si se ve el código de barras, el celular lo lee al instante (Chrome en Android). Si no, la IA reconoce el producto en la foto.
- **Asistente**: un chat con la IA de Claude que consulta las tiendas y responde, por escrito o en voz alta.
- **Logos** de cada tienda, descargados de su propio sitio y guardados en `public/logos/`.

## Activar la inteligencia artificial

El asistente y el reconocimiento por foto usan la API de Claude, que se paga aparte de la suscripción a Claude (es una cuenta distinta, en console.anthropic.com). Sin configurarla, el resto de la app funciona igual.

1. Crear una clave de API en https://console.anthropic.com (Settings → API Keys) y cargar saldo. Conviene fijar un límite de gasto mensual.
2. En Vercel: proyecto `farmacomparador` → **Settings → Environment Variables**, agregar:
   - `ANTHROPIC_API_KEY`: la clave de API.
   - `CLAVE_IA`: una clave inventada para la familia. La app la pide la primera vez que se usa la IA en cada celular. Sin ella, la IA queda apagada para que nadie con el enlace gaste el saldo.
3. Volver a publicar (**Deployments → … → Redeploy**).

Usa **Claude Haiku 5.5**, el modelo más económico de Claude, con esfuerzo bajo: US$ 0,10 por millón de tokens enviados y US$ 0,50 por millón de respuesta. Estimación: alrededor de una décima de centavo de dólar por pregunta.

## Probarla en la computadora

Hace falta tener instalado [Node.js](https://nodejs.org) versión 20 o superior.

```
npm start
```

Después abrir `http://localhost:3000` en el navegador.

Para correr las pruebas automáticas: `npm test`.

## Publicarla para usarla desde el celular

La app necesita un servidor: el navegador del celular no puede consultar directamente a las tiendas. El proyecto está preparado para [Vercel](https://vercel.com), que tiene plan gratuito:

1. Crear una cuenta en vercel.com entrando con GitHub.
2. Elegir **Add New → Project** e importar el repositorio `Farmacomparador`.
3. Dejar todas las opciones como vienen y tocar **Deploy**.
4. Vercel entrega una dirección del tipo `https://farmacomparador-xxxx.vercel.app`.
5. Abrirla en el celular y, desde el menú del navegador, elegir **Agregar a pantalla de inicio**. Queda con ícono propio, como una app.

## Organización del código

- `public/index.html`: la pantalla que se ve en el celular.
- `api/buscar.js`: recibe la búsqueda de la pantalla y devuelve los resultados.
- `lib/sitios.js`: un bloque por tienda, que sabe cómo consultarla. Para sumar una tienda se agrega acá.
- `lib/comparar.js`: filtra resultados que no corresponden, agrupa por código de barras y busca por código.
- `lib/ia.js`: el asistente y el reconocimiento de fotos con Claude.
- `api/chat.js` y `api/foto.js`: reciben los pedidos de la IA desde la pantalla.
- `server.js`: servidor para probar en la computadora.
- `test/`: pruebas automáticas.
