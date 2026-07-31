import { stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import sharp from "sharp";

const sources = [
  "design/source-backdrops/glass-horizon.png",
  "design/source-backdrops/phase-bloom.png",
  "design/source-backdrops/null-circuit.png",
];

for (const source of sources) {
  const target = join("public/art/backdrops", `${basename(source, extname(source))}.webp`);
  await sharp(source)
    .webp({ quality: 84, effort: 6, smartSubsample: true })
    .toFile(target);
  const [before, after] = await Promise.all([stat(source), stat(target)]);
  console.log(`${target}: ${before.size} -> ${after.size} bytes`);
}

const shareSource = "design/concept-menu.png";
const shareTarget = "public/art/vanta-pulse-share.webp";
await sharp(shareSource)
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .webp({ quality: 86, effort: 6, smartSubsample: true })
  .toFile(shareTarget);
const [shareBefore, shareAfter] = await Promise.all([stat(shareSource), stat(shareTarget)]);
console.log(`${shareTarget}: ${shareBefore.size} -> ${shareAfter.size} bytes`);

const markSource = "public/vanta-mark.svg";
const iconTargets = [
  ["public/vanta-icon-192.png", 192],
  ["public/vanta-icon-512.png", 512],
  ["public/apple-touch-icon.png", 180],
];
for (const [target, size] of iconTargets) {
  await sharp(markSource).resize(size, size).png({ compressionLevel: 9 }).toFile(target);
  console.log(`${target}: ${(await stat(target)).size} bytes`);
}

const maskableTarget = "public/vanta-maskable-512.png";
await sharp(markSource)
  .resize(410, 410)
  .extend({ top: 51, bottom: 51, left: 51, right: 51, background: "#03040a" })
  .png({ compressionLevel: 9 })
  .toFile(maskableTarget);
console.log(`${maskableTarget}: ${(await stat(maskableTarget)).size} bytes`);
