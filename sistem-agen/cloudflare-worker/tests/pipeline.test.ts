import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFactCheckGate,
  validatePackageResult,
  validateScriptResult,
} from "../src/pipeline";

const script = {
  hook: "Tahukah kamu?",
  beats: [{ t: "0-3", narasi: "Fakta", visual: "Visual", teks_layar: "Fakta" }],
  claims: [{ id: "c1", text: "Klaim utama", core: true }],
  durasi_detik: 42,
};

test("script result requires hook, beats, claims and bounded duration", () => {
  assert.deepEqual(validateScriptResult(script), []);
  assert.ok(validateScriptResult({ hook: "", beats: [], claims: [], durasi_detik: 2 }).length >= 4);
});

test("fact-check gate passes only with two independent HTTPS domains for every core claim", () => {
  const result = evaluateFactCheckGate(script, {
    gate_pass: true,
    verdicts: [{
      claim_id: "c1",
      verdict: "verified",
      sources: [
        { url: "https://example.org/evidence", independent: true },
        { url: "https://research.example.net/paper", independent: true },
      ],
    }],
  });
  assert.equal(result.gatePass, true);
  assert.equal(result.verifiedCoreClaims, 1);
});

test("agent-supplied gate_pass cannot override a missing independent source", () => {
  const result = evaluateFactCheckGate(script, {
    gate_pass: true,
    verdicts: [{
      claim_id: "c1",
      verdict: "verified",
      sources: [{ url: "https://example.org/evidence", independent: true }],
    }],
  });
  assert.equal(result.gatePass, false);
  assert.ok(result.reasons.some((reason) => reason.includes("dua sumber")));
});

test("fact-check gate rejects contradicted or unverifiable core claims", () => {
  const result = evaluateFactCheckGate(script, {
    verdicts: [{
      claim_id: "c1",
      verdict: "contradicted",
      sources: [
        { url: "https://example.org/a", independent: true },
        { url: "https://example.net/b", independent: true },
      ],
    }],
  });
  assert.equal(result.gatePass, false);
});

test("package result requires caption, hashtags, and cover text", () => {
  assert.deepEqual(validatePackageResult({ caption: "Caption", hashtags: ["#fakta"], cover_text: "Tahu gak?" }), []);
  assert.ok(validatePackageResult({ caption: "", hashtags: [], cover_text: "" }).length >= 3);
});
