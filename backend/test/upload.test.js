import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.UPLOAD_RATE_LIMIT = "12";
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "geotherm-upload-test-"));
const uploadDir = path.join(temporary, "uploads");
process.env.UPLOAD_DIR = uploadDir;
const { app } = await import("../server.js");

test("upload API", async (t) => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  });

  async function upload(content = "%PDF-1.4 test", type = "application/pdf", field = "file") {
    const body = new FormData();
    body.append(field, new Blob([content], { type }), "priloha.pdf");
    const response = await fetch(`${base}/api/upload`, { method: "POST", body });
    return { status: response.status, body: await response.json() };
  }

  await t.test("stores and deletes an attachment", async () => {
    const { status, body } = await upload();
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(await fs.readFile(path.join(uploadDir, body.file.filename), "utf8"), "%PDF-1.4 test");
    const deleted = await fetch(`${base}/api/upload/${body.file.filename}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await fs.readdir(uploadDir), []);
  });
  await t.test("rejects unsupported MIME types with JSON and HTTP 415", async () => {
    const { status, body } = await upload("text", "text/plain");
    assert.equal(status, 415);
    assert.equal(body.success, false);
    assert.match(body.message, /Nepovolený typ/);
  });
  await t.test("returns 413 and cleans up an oversized attachment", async () => {
    const { status, body } = await upload(new Uint8Array(15 * 1024 * 1024 + 1));
    assert.equal(status, 413);
    assert.equal(body.success, false);
    assert.match(body.message, /15 MB/);
    assert.deepEqual(await fs.readdir(uploadDir), []);
  });
  await t.test("returns 400 for missing or unexpected file fields", async () => {
    const missing = await fetch(`${base}/api/upload`, { method: "POST", body: new FormData() });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).success, false);
    assert.equal((await upload("test", "application/pdf", "wrong")).status, 400);
  });
  await t.test("recreates a removed upload directory", async () => {
    await fs.rmdir(uploadDir);
    const { status, body } = await upload();
    assert.equal(status, 200);
    await fetch(`${base}/api/upload/${body.file.filename}`, { method: "DELETE" });
  });
  await t.test("logs storage failures and returns a safe JSON error", async () => {
    await fs.rmdir(uploadDir);
    await fs.writeFile(uploadDir, "block directory creation");
    const logged = t.mock.method(console, "error", () => {});
    try {
      const { status, body } = await upload();
      assert.equal(status, 500);
      assert.equal(body.success, false);
      assert.match(body.message, /Server nedokázal uložiť prílohu/);
      assert.ok(!body.message.includes(temporary));
      assert.equal(logged.mock.calls[0].arguments[0], "Upload error:");
    } finally {
      logged.mock.restore();
      await fs.unlink(uploadDir);
      await fs.mkdir(uploadDir);
    }
  });
  await t.test("keeps the upload rate limit active", async () => {
    let response;
    for (let i = 0; i < 12; i++) {
      response = await fetch(`${base}/api/upload`, { method: "POST", body: new FormData() });
      const body = await response.json();
      if (response.status === 429) {
        assert.equal(body.success, false);
        assert.match(body.message, /Príliš veľa uploadov/);
        return;
      }
      assert.equal(response.status, 400);
    }
    assert.fail("Upload rate limit did not reject repeated requests");
  });
});
