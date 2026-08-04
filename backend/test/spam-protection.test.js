import test, { after, before } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.FORM_RATE_LIMIT = "20";

const { app } = await import("../server.js");
let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const validBody = (overrides = {}) => ({
  name: "Test User",
  phone: "+421900000000",
  email: "test@example.com",
  place: "Bratislava",
  gdpr: true,
  formStartedAt: Date.now() - 5000,
  turnstileToken: "test-valid-token",
  ...overrides,
});

async function submit(body) {
  const response = await fetch(`${baseUrl}/api/form`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("honeypot zamietne bota", async () => {
  const result = await submit(validBody({ hp_company: "Spam s.r.o." }));
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("príliš rýchle odoslanie je zamietnuté", async () => {
  const result = await submit(validBody({ formStartedAt: Date.now() }));
  assert.equal(result.status, 400);
  assert.match(result.body.message, /príliš rýchlo/i);
});

test("starý formulár je zamietnutý", async () => {
  const result = await submit(validBody({ formStartedAt: Date.now() - 3 * 60 * 60 * 1000 }));
  assert.equal(result.status, 400);
  assert.match(result.body.message, /vypršal/i);
});

test("neplatný Turnstile token je zamietnutý", async () => {
  const result = await submit(validBody({ turnstileToken: "invalid" }));
  assert.equal(result.status, 400);
  assert.match(result.body.message, /spamu/i);
});

test("platný formulár prejde bez odoslania reálneho emailu", async () => {
  const result = await submit(validBody());
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.ok(result.body.jobId);
});
