export interface GateEvaluation {
  gatePass: boolean;
  reasons: string[];
  verifiedCoreClaims: number;
  totalCoreClaims: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedHost(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** Recompute the fact-check gate in the trusted hub; ignore agent-supplied gate_pass. */
export function evaluateFactCheckGate(scriptValue: unknown, factCheckValue: unknown): GateEvaluation {
  const script = asRecord(scriptValue);
  const factCheck = asRecord(factCheckValue);
  const claims = Array.isArray(script?.claims) ? script.claims.map(asRecord).filter(Boolean) : [];
  const coreClaims = claims.filter((claim) => claim?.core === true);
  const verdicts = Array.isArray(factCheck?.verdicts) ? factCheck.verdicts.map(asRecord).filter(Boolean) : [];
  const reasons: string[] = [];
  let verifiedCoreClaims = 0;
  if (coreClaims.length === 0) reasons.push("Skrip belum memiliki klaim inti yang dapat diverifikasi.");

  for (const claim of coreClaims) {
    const claimId = typeof claim?.id === "string" ? claim.id : "";
    if (!claimId) {
      reasons.push("Ada klaim inti tanpa ID.");
      continue;
    }
    const verdict = verdicts.find((item) => item?.claim_id === claimId);
    if (!verdict || verdict.verdict !== "verified") {
      reasons.push("Klaim inti " + claimId + " belum berstatus verified.");
      continue;
    }
    const sources = Array.isArray(verdict.sources) ? verdict.sources.map(asRecord).filter(Boolean) : [];
    const independentHosts = new Set(
      sources.filter((source) => source?.independent === true)
        .map((source) => normalizedHost(source?.url))
        .filter((host): host is string => Boolean(host)),
    );
    if (independentHosts.size < 2) {
      reasons.push("Klaim inti " + claimId + " memerlukan minimal dua sumber HTTPS independen.");
      continue;
    }
    verifiedCoreClaims += 1;
  }
  return {
    gatePass: coreClaims.length > 0 && verifiedCoreClaims === coreClaims.length,
    reasons,
    verifiedCoreClaims,
    totalCoreClaims: coreClaims.length,
  };
}

export function validateScriptResult(value: unknown): string[] {
  const result = asRecord(value);
  const errors: string[] = [];
  if (typeof result?.hook !== "string" || !result.hook.trim()) errors.push("hook wajib diisi.");
  if (!Array.isArray(result?.beats) || result.beats.length < 1) errors.push("minimal satu beat wajib tersedia.");
  if (!Array.isArray(result?.claims) || result.claims.length < 1) errors.push("minimal satu klaim wajib tersedia.");
  if (!Number.isInteger(Number(result?.durasi_detik)) || Number(result?.durasi_detik) < 10 || Number(result?.durasi_detik) > 90) errors.push("durasi_detik harus antara 10 dan 90.");
  const claims = Array.isArray(result?.claims) ? result.claims.map(asRecord).filter(Boolean) : [];
  if (claims.some((claim) => typeof claim?.id !== "string" || typeof claim?.text !== "string" || !claim.text.trim())) errors.push("setiap klaim harus memiliki id dan text.");
  return errors;
}

export function validatePackageResult(value: unknown): string[] {
  const result = asRecord(value);
  const errors: string[] = [];
  if (typeof result?.caption !== "string" || !result.caption.trim()) errors.push("caption wajib diisi.");
  if (!Array.isArray(result?.hashtags) || result.hashtags.length < 1 || result.hashtags.length > 8) errors.push("hashtags harus berisi 1 sampai 8 item.");
  if (typeof result?.cover_text !== "string" || !result.cover_text.trim()) errors.push("cover_text wajib diisi.");
  return errors;
}
