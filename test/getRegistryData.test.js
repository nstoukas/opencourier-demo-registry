// Node's built-in test runner (node --test) — no dependencies to install.
const test = require("node:test");
const assert = require("node:assert/strict");

const { getRegistryData } = require("../server");

test("getRegistryData reads values out of the nested details object", () => {
  const result = getRegistryData({
    details: {
      name: "Volos Couriers",
      link: "http://localhost:3000",
      websocketLink: "ws://localhost:3000",
      userCount: 11,
    },
    updatedAt: "2026-07-26T00:00:00.000Z",
  });

  assert.equal(result.name, "Volos Couriers");
  assert.equal(result.link, "http://localhost:3000");
  assert.equal(result.websocketLink, "ws://localhost:3000");
  assert.equal(result.userCount, 11);
  // updatedAt is deliberately read from the top level, not from details.
  assert.equal(result.updatedAt, "2026-07-26T00:00:00.000Z");
});

test("getRegistryData falls back to top-level fields when details is absent", () => {
  // This is the upstream crash: a POST body without `details` used to throw,
  // returning a 500 instead of being handled.
  const result = getRegistryData({
    name: "Flat Instance",
    link: "http://example.test",
  });

  assert.equal(result.name, "Flat Instance");
  assert.equal(result.link, "http://example.test");
});

test("getRegistryData defaults optional fields to null rather than undefined", () => {
  // The columns are nullable; undefined would be written as a missing bind param.
  const result = getRegistryData({ name: "Bare", link: "http://bare.test" });

  assert.equal(result.region, null);
  assert.equal(result.imageUrl, null);
  assert.equal(result.userCount, null);
  assert.equal(result.updatedAt, null);
});

test("details wins over a conflicting top-level field", () => {
  const result = getRegistryData({
    name: "top-level",
    details: { name: "from-details" },
  });

  assert.equal(result.name, "from-details");
});
