import sharp from "sharp";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("../thingstodo"),
  assets = path.join(root, "assets"),
  res = path.join(root, "android/app/src/main/res");
await mkdir(assets, { recursive: true });
await mkdir(path.join(root, "store_assets"), { recursive: true });
await mkdir("public/brand", { recursive: true });
const mark = path.join(assets, "logo.png");
if (process.argv[2]) await copyFile(process.argv[2], mark);
if (process.argv[3])
  await copyFile(process.argv[3], path.join(assets, "logo-lockup.png"));
const art = await sharp(mark).trim({ threshold: 20 }).png().toBuffer();
async function icon(size, round = false) {
  const foreground = await sharp(art)
    .resize(Math.round(size * 0.64), Math.round(size * 0.74), { fit: "inside" })
    .toBuffer();
  let pipeline = sharp({
    create: { width: size, height: size, channels: 4, background: "#101827" },
  }).composite([{ input: foreground, gravity: "centre" }]);
  const buffer = await pipeline.png().toBuffer();
  if (!round) return buffer;
  return sharp(buffer)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${
            size / 2
          }" r="${size / 2}" fill="white"/></svg>`
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}
for (const [density, size] of [
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
]) {
  const folder = path.join(res, `mipmap-${density}`);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "ic_launcher.png"), await icon(size));
  await writeFile(
    path.join(folder, "ic_launcher_round.png"),
    await icon(size, true)
  );
  const foreground = await sharp(art)
    .resize(Math.round(size * 1.12), Math.round(size * 1.25), { fit: "inside" })
    .toBuffer();
  await sharp({
    create: {
      width: Math.round(size * 2.25),
      height: Math.round(size * 2.25),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: foreground, gravity: "centre" }])
    .png()
    .toFile(path.join(folder, "ic_launcher_foreground.png"));
}
await writeFile(
  path.join(root, "store_assets", "app-icon-512.png"),
  await icon(512)
);
await writeFile(path.join(assets, "app-icon-1024.png"), await icon(1024));
await copyFile(mark, "public/brand/logo.png");
await copyFile(
  path.join(assets, "logo-lockup.png"),
  "public/brand/logo-lockup.png"
);
await mkdir(path.join(res, "mipmap-anydpi-v26"), { recursive: true });
for (const name of ["ic_launcher", "ic_launcher_round"])
  await writeFile(
    path.join(res, "mipmap-anydpi-v26", `${name}.xml`),
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/brand_navy"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/><monochrome android:drawable="@drawable/ic_brand_monochrome"/></adaptive-icon>\n'
  );
console.log(
  "Exported logo, store icon, all Android launcher densities and adaptive foregrounds."
);
