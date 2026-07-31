import { mkdir, stat } from "node:fs/promises";
import sharp from "sharp";

const source = "design/source-sprites/vanta-courier-sheet-chroma.png";
const target = "public/art/sprites/vanta-courier-v1.webp";
const columns = 3;
const rows = 2;
const frameSize = 128;
const contentSize = 108;
const contactBaseline = 118;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const { data, info } = await sharp(source)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

if (info.width % columns !== 0 || info.height % rows !== 0) {
  throw new Error(`Sprite source must divide into a ${columns}x${rows} grid`);
}

const rgba = Buffer.alloc(info.width * info.height * 4);
let transparentPixels = 0;
let softPixels = 0;
let opaquePixels = 0;

for (let sourceOffset = 0, targetOffset = 0; sourceOffset < data.length; sourceOffset += 3, targetOffset += 4) {
  const red = data[sourceOffset] ?? 0;
  const green = data[sourceOffset + 1] ?? 0;
  const blue = data[sourceOffset + 2] ?? 0;
  const dominance = green - Math.max(red, blue);
  const alpha = dominance >= 104
    ? 0
    : dominance <= 18
      ? 255
      : Math.round(((104 - dominance) / 86) * 255);

  rgba[targetOffset] = red;
  rgba[targetOffset + 1] = Math.min(green, Math.max(red, blue) + Math.round(10 * (alpha / 255)));
  rgba[targetOffset + 2] = blue;
  rgba[targetOffset + 3] = alpha;

  if (alpha === 0) transparentPixels += 1;
  else if (alpha === 255) opaquePixels += 1;
  else softPixels += 1;
}

const cellWidth = info.width / columns;
const cellHeight = info.height / rows;
const frameBuffers = [];
const frames = [];

for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const cell = await sharp(rgba, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .extract({ left: column * cellWidth, top: row * cellHeight, width: cellWidth, height: cellHeight })
      .png()
      .toBuffer();
    const trimmed = await sharp(cell)
      .trim({ background: transparent, threshold: 3 })
      .png()
      .toBuffer();

    const fitted = await sharp(trimmed)
      .resize({
        width: contentSize,
        height: contentSize,
        fit: "inside",
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    const fittedMetadata = await sharp(fitted).metadata();
    const fittedWidth = fittedMetadata.width ?? contentSize;
    const fittedHeight = fittedMetadata.height ?? contentSize;
    const normalized = await sharp({
      create: {
        width: frameSize,
        height: frameSize,
        channels: 4,
        background: transparent,
      },
    })
      .composite([{
        input: fitted,
        left: Math.round((frameSize - fittedWidth) / 2),
        top: contactBaseline - fittedHeight,
      }])
      .png()
      .toBuffer();

    const { data: normalizedPixels, info: normalizedInfo } = await sharp(normalized)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let left = frameSize;
    let top = frameSize;
    let right = -1;
    let bottom = -1;
    let alphaPixels = 0;
    let residualKeyPixels = 0;
    for (let y = 0; y < normalizedInfo.height; y += 1) {
      for (let x = 0; x < normalizedInfo.width; x += 1) {
        const offset = (y * normalizedInfo.width + x) * 4;
        const red = normalizedPixels[offset] ?? 0;
        const green = normalizedPixels[offset + 1] ?? 0;
        const blue = normalizedPixels[offset + 2] ?? 0;
        const alpha = normalizedPixels[offset + 3] ?? 0;
        if (alpha > 8) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
          alphaPixels += 1;
        }
        if (alpha > 64 && green - Math.max(red, blue) > 36) residualKeyPixels += 1;
      }
    }
    if (alphaPixels < 300 || right < left || bottom !== contactBaseline - 1) {
      throw new Error(`Frame ${frameBuffers.length} failed subject/contact validation`);
    }
    if (residualKeyPixels > 0) {
      throw new Error(`Frame ${frameBuffers.length} retained opaque chroma pixels`);
    }
    const centroidX = (left + right) / 2;
    if (Math.abs(centroidX - frameSize / 2) > 4) {
      throw new Error(`Frame ${frameBuffers.length} is not horizontally centered`);
    }
    frames.push({
      name: ["run_a", "run_b", "rise", "apex", "fall", "land"][frameBuffers.length],
      bounds: { left, top, right, bottom },
      alphaPixels,
    });
    frameBuffers.push(normalized);
  }
}

await mkdir("public/art/sprites", { recursive: true });
await sharp({
  create: {
    width: columns * frameSize,
    height: rows * frameSize,
    channels: 4,
    background: transparent,
  },
})
  .composite(frameBuffers.map((input, index) => ({
    input,
    left: (index % columns) * frameSize,
    top: Math.floor(index / columns) * frameSize,
  })))
  .webp({ lossless: true, effort: 6 })
  .toFile(target);

const output = await stat(target);
console.log(JSON.stringify({
  source: { width: info.width, height: info.height },
  target: { path: target, width: columns * frameSize, height: rows * frameSize, bytes: output.size },
  matte: { transparentPixels, softPixels, opaquePixels },
  frames,
}, null, 2));
