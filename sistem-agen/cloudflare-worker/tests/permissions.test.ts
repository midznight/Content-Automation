import assert from "node:assert/strict";
import test from "node:test";
import {
  FORBIDDEN_TOOLS,
  ROLES,
  TASK_ROUTING_MATRIX,
  validateTaskRoute,
  validateToolAccess,
} from "../src/permissions";

test("known roles are unique and complete", () => {
  assert.equal(new Set(ROLES).size, ROLES.length);
  assert.deepEqual([...ROLES], [
    "pm",
    "ceo",
    "strategist",
    "fact_checker",
    "animator",
    "animator_backup",
    "analyst",
    "social",
  ]);
});

test("every allowed task route passes", () => {
  for (const [taskType, route] of Object.entries(TASK_ROUTING_MATRIX)) {
    for (const sender of route.senders) {
      for (const receiver of route.receivers) {
        assert.doesNotThrow(() => validateTaskRoute(sender, receiver, taskType));
      }
    }
  }
});

test("invalid task types, senders, and receivers are rejected", () => {
  assert.throws(() => validateTaskRoute("ceo", "strategist", "unknown"));
  assert.throws(() => validateTaskRoute("strategist", "fact_checker", "script"));
  assert.throws(() => validateTaskRoute("ceo", "animator", "script"));
});

test("worker roles cannot dispatch tasks", () => {
  for (const role of ["strategist", "fact_checker", "animator", "animator_backup", "analyst", "social"] as const) {
    assert.throws(() => validateToolAccess(role, "send_task"));
  }
  assert.doesNotThrow(() => validateToolAccess("ceo", "send_task"));
});

test("approval and publication stay reserved for the human PM", () => {
  for (const role of ROLES) {
    for (const tool of FORBIDDEN_TOOLS) {
      assert.throws(() => validateToolAccess(role, tool));
    }
  }
});

test("pipeline tools are restricted to intended roles", () => {
  assert.doesNotThrow(() => validateToolAccess("ceo", "create_video"));
  assert.doesNotThrow(() => validateToolAccess("ceo", "request_approval"));
  for (const role of ["strategist", "fact_checker", "animator", "animator_backup", "analyst", "social"] as const) {
    assert.doesNotThrow(() => validateToolAccess(role, "request_upload"));
    assert.throws(() => validateToolAccess(role, "create_video"));
    assert.throws(() => validateToolAccess(role, "request_approval"));
  }
  assert.throws(() => validateToolAccess("pm", "request_upload"));
});
