/**
 * QR SVG generator for the Worker — wraps `qrcode-generator` (zero deps,
 * Workers-safe, battle-tested). Byte mode is forced so otpauth URLs always
 * encode identically. Output: SVG string / data URL for the 2FA QR image.
 */
// @ts-ignore — no type declarations shipped by the package
import qrcode from "qrcode-generator";

export function qrMatrixText(text: string): string {
  // typeNumber 0 = auto-detect, "M" error correction; force byte mode via addData
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  return qr.createDataURL(6, 4); // cell size 6px, 4-module quiet zone
}

export function qrSvg(text: string, modulePx = 6, quietModules = 4): string {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + quietModules * 2) * modulePx;
  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        rects += `<rect x="${(c + quietModules) * modulePx}" y="${(r + quietModules) * modulePx}" width="${modulePx}" height="${modulePx}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><g fill="#000000">${rects}</g></svg>`;
}

export function svgToDataUrl(svg: string): string {
  let bin = "";
  const bytes = new TextEncoder().encode(svg);
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** Data URL for <img src=...> — SVG keeps it tiny and crisp. */
export function qrDataUrl(text: string): string {
  return svgToDataUrl(qrSvg(text));
}
