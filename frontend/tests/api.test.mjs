import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { resolveApiBaseUrl } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("builds upload, form and polling URLs with one API prefix", () => {
  for (const configured of ["/api", "/api/", "/api///", "", undefined]) {
    for (const endpoint of ["upload", "upload/example.pdf", "form", "form-status/example"]) {
      assert.equal(`${resolveApiBaseUrl(configured, false)}/${endpoint}`, `/api/${endpoint}`);
    }
  }
});
test("supports both an origin and an API base URL", () => {
  for (const configured of ["https://formular.geotherm.sk", "https://formular.geotherm.sk/", "https://formular.geotherm.sk/api", " https://formular.geotherm.sk/api/ "]) {
    assert.equal(resolveApiBaseUrl(configured, false), "https://formular.geotherm.sk/api");
  }
  assert.equal(resolveApiBaseUrl(undefined, true), "http://localhost:4000/api");
  assert.equal(resolveApiBaseUrl("/api", true), "/api");
});
test("integrates GTM once and preserves dataLayer", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal((html.match(/GTM-PC774CDD/g) || []).length, 2);
  assert.match(html, /googletagmanager\.com\/gtm\.js/);
  assert.match(html, /googletagmanager\.com\/ns\.html/);
  assert.match(html, /'dataLayer'/);
});
test("redirect occurs only after successful API response", async () => {
  const source = await readFile(new URL("../src/components/QuoteForm.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!res\.ok \|\| !data\?\.success\)/);
  assert.match(source, /window\.location\.replace\(THANK_YOU_URL\)/);
  assert.match(source, /, 1500\)/);
  assert.match(source, /Prosím, nezatvárajte stránku\./);
  assert.match(source, /Vašu správu sme úspešne prijali/);
  assert.doesNotMatch(source, /OK, rozumiem/);
});
