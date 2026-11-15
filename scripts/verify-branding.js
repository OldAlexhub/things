import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const store = await sharp(
  "../thingstodo/store_assets/app-icon-512.png"
).metadata();
assert.equal(store.width, 512);
assert.equal(store.height, 512);
assert.equal(store.channels, 4);
assert.ok(
  (await readFile("../thingstodo/store_assets/app-icon-512.png")).length <
    1024 * 1024
);
const mark = await sharp("../thingstodo/assets/logo.png").metadata();
assert.equal(mark.hasAlpha, true);
for (const [density, size] of [
  ["mdpi", 48],
  ["hdpi", 72],
  ["xhdpi", 96],
  ["xxhdpi", 144],
  ["xxxhdpi", 192],
]) {
  const base = "../thingstodo/android/app/src/main/res/mipmap-" + density + "/";
  const icon = await sharp(base + "ic_launcher.png").metadata();
  assert.equal(icon.width, size);
  assert.equal(icon.height, size);
  const foreground = await sharp(
    base + "ic_launcher_foreground.png"
  ).metadata();
  assert.equal(foreground.width, size * 2.25);
  assert.equal(foreground.hasAlpha, true);
}
console.log(
  "PASS: transparent logo, 512px RGBA store icon under 1 MB, all five launcher densities and adaptive foregrounds."
);
