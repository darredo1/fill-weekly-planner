import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const ORIGIN = "http://localhost:8000";

function request(body, options = {}) {
  return new Request(`https://fill-weekly-planner-feedback.darredo1.workers.dev/telemetry`, {
    method: options.method || "POST",
    headers: { Origin: options.origin || ORIGIN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context() {
  const pending = [];
  return { pending, waitUntil: (promise) => pending.push(promise) };
}

test("telemetry accepts only approved aggregate fields", async () => {
  const points = [];
  const env = { TELEMETRY: { writeDataPoint: (point) => points.push(point) } };
  const ctx = context();

  const response = await worker.fetch(request({ event: "step_completed", step: 3 }), env, ctx);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.deepEqual(points, [{ blobs: ["step_completed"], doubles: [3] }]);
  assert.equal(ctx.pending.length, 0);
});

test("telemetry rejects content, identifiers, and invalid event shapes", async () => {
  const env = { TELEMETRY: { writeDataPoint: () => assert.fail("must not write invalid telemetry") } };
  const cases = [
    { event: "planner_open", canDoText: "student text" },
    { event: "planner_open", sessionId: "identifier" },
    { event: "step_completed" },
    { event: "planner_open", step: 1 },
    { event: "unknown" },
  ];

  for (const body of cases) {
    const response = await worker.fetch(request(body), env, context());
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("telemetry enforces origin and method without affecting the feedback route", async () => {
  const env = { TELEMETRY: { writeDataPoint: () => {} } };
  assert.equal((await worker.fetch(request({ event: "planner_open" }, { origin: "https://example.test" }), env, context())).status, 403);
  assert.equal((await worker.fetch(request(undefined, { method: "GET" }), env, context())).status, 405);

  const feedbackRequest = new Request("https://fill-weekly-planner-feedback.darredo1.workers.dev/", {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const feedbackResponse = await worker.fetch(feedbackRequest, env, context());
  assert.equal(feedbackResponse.status, 400);
  assert.deepEqual(await feedbackResponse.json(), { error: "areaId is required" });
});
