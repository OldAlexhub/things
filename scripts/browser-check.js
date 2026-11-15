import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const credentials = JSON.parse(
  await readFile(".local/admin-login.json", "utf8")
);
await mkdir(".local/qa", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:3000");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in to your studio" }).click();
  await page.getByRole("heading", { name: "Your studio" }).waitFor();
  await page.screenshot({
    path: ".local/qa/admin-overview.png",
    fullPage: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "Destinations", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.locator("#editor").waitFor({ state: "visible" });
  assert.equal(await page.locator('[name="slug"]').inputValue(), "orlando");
  await page.getByRole("button", { name: "Preview changes" }).click();
  assert.match(await page.locator("#preview").textContent(), /Orlando/);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.locator("#editor").waitFor({ state: "hidden" });
  await page
    .locator("nav")
    .getByRole("button", { name: "Media library", exact: true })
    .click();
  await page.getByRole("heading", { name: "Add photography" }).waitFor();
  await page
    .locator("nav")
    .getByRole("button", { name: "Data sources", exact: true })
    .click();
  await page.getByRole("heading", { name: "Synchronize a city" }).waitFor();
  await page.screenshot({
    path: ".local/qa/admin-sources.png",
    fullPage: true,
  });
  const map = await browser.newPage({ viewport: { width: 500, height: 700 } });
  await map.goto("http://localhost:3000/map.html");
  await map.evaluate(() =>
    window.setExperiences({
      center: [28.54, -81.38],
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap contributors",
      items: [],
    })
  );
  await map.locator(".leaflet-control-attribution").waitFor();
  assert.match(
    await map.locator(".leaflet-control-attribution").textContent(),
    /OpenStreetMap/
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: admin sign-in, overview, city edit/preview/save, media, sources and map attribution."
  );
} finally {
  await browser.close();
}
