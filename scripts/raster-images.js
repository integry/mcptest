/**
 * PNG resizing at build time with resvg (already used for the Open Graph
 * cards): the image is wrapped in an SVG and rendered at the target width.
 * The catalog keeps 128-512px source logos (scripts/validate-catalog-assets.js);
 * the built site serves them at the size they are displayed (issue #405).
 */
const { Resvg } = require('@resvg/resvg-js');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from the IHDR chunk, or null for anything that is not a PNG. */
function readPngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * `buffer` scaled to `width` pixels wide (aspect ratio kept), or null when the
 * image is already that small or the result would not be smaller in bytes.
 */
function downscalePng(buffer, width) {
  const size = readPngSize(buffer);
  if (!size || size.width <= width) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`
    + `<image width="${size.width}" height="${size.height}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${buffer.toString('base64')}"/></svg>`;
  const output = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  return output.length < buffer.length ? output : null;
}

module.exports = { downscalePng, readPngSize };
