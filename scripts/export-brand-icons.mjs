import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const at = path => new URL("../" + path, import.meta.url);
const source = await readFile(at("assets/brand/signal-purple-source.png"));
await mkdir(at("public/brand/"), { recursive: true });

async function exportPng(path, size, input = source) {
  const png = await sharp(input).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(at(path), png);
  return png;
}
for (const [size, legacy, branded] of [
  [192, "public/icon-192x192.png", "public/brand/signal-purple-192.png"],
  [512, "public/icon-512x512.png", "public/brand/signal-purple-512.png"],
  [180, "public/apple-touch-icon.png", "public/brand/signal-purple-180.png"],
]) {
  const png = await exportPng(legacy, size);
  await writeFile(at(branded), png);
}
await exportPng("public/brand/signal-purple-icon.png", 128);
await exportPng("src/app/icon.png", 64);
const badge = await readFile(at("assets/brand/signal-purple-badge.svg"));
await exportPng("public/brand/signal-purple-badge.png", 96, badge);

// ICO supports PNG-encoded entries, keeping the same approved artwork at each size.
const sizes = [16, 32, 48, 64];
const pngs = await Promise.all(sizes.map(size => sharp(source).resize(size, size).ensureAlpha().png().toBuffer()));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index += 1) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(pngs[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += pngs[index].length;
}
await writeFile(at("src/app/favicon.ico"), Buffer.concat([directory, ...pngs]));
console.log("Exported purple ribbon website, PWA, favicon and notification assets.");
console.log("Source: " + fileURLToPath(at("assets/brand/signal-purple-source.png")));
