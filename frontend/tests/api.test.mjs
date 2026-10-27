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
