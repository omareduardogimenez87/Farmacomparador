# Farmacomparador

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
- `lib/comparar.js`: filtra resultados que no corresponden y agrupa por código de barras.
- `server.js`: servidor para probar en la computadora.
- `test/`: pruebas automáticas.
