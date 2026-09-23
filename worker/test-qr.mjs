import { qrSvg, qrDataUrl } from "./qr";
import jsQR from "jsqr";

const url = "otpauth://totp/AnvioTalk:kartiksingh7870n%40gmail.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AnvioTalk";
const shortUrl = "otpauth://totp/AnvioTalk:k%40x.com?secret=JBSWY3DPEHPK3PXP&issuer=AnvioTalk";

function svgToMatrix(svg) {
  // parse rects from the svg
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g)].map((m) => m.slice(1).map(Number));
  const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const total = Number(viewBox[1]);
  const mod = rects[0] ? rects[0][3] : 6;
  const quiet = rects.length ? rects[0][0] / mod : 4;
  const n = Math.round(total / mod) - quiet * 2;
  const grid = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const [x, y, , h] of rects) {
    const c = Math.round(x / mod) - quiet;
    const r = Math.round(y / mod) - quiet;
    if (r >= 0 && r < n && c >= 0 && c < n && h === mod) grid[r][c] = true;
  }
  return grid;
}

let allOk = true;
for (const urlCase of [url, shortUrl]) {
  const svg = qrSvg(urlCase);
  const mat = svgToMatrix(svg);
  const n = mat.length;
  const q = 4;
  const size = n + q * 2;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c]) {
        const i = ((r + q) * size + (c + q)) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
    }
  }
  const res = jsQR(data, size, size);
  const ok = !!res && res.data === urlCase;
  console.log(ok ? "PASS" : "FAIL", `(${n}x${n})`, "->", ok ? "decoded ok" : `got: ${res ? res.data.slice(0, 60) : "null"}`);
  if (!ok) allOk = false;
}
const dataUrl = qrDataUrl(url);
console.log("dataUrl ok:", dataUrl.startsWith("data:image/svg+xml;base64,"));
if (!dataUrl.startsWith("data:image/svg+xml;base64,")) allOk = false;
process.exit(allOk ? 0 : 1);
