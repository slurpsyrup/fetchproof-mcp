/**
 * Billing sentences shown to MCP clients. Must match the Terms exactly.
 * Never say "failures cost zero" or "a failure costs 0".
 */

export const TERMS_BILLING =
  "Errors, blocked or timed-out requests, invalid requests and cache hits cost nothing. A not-found or empty result is charged only where that operation's published cost says so.";

export function costSentence(cost) {
  const price = cost?.default ?? 1;
  const parts = [`Costs ${price} credit${price === 1 ? "" : "s"} when it succeeds.`];
  for (const rule of cost?.rules || []) {
    const when = rule.when || {};
    const amount = typeof rule.cost === "number"
      ? `${rule.cost} credit${rule.cost === 1 ? "" : "s"}`
      : JSON.stringify(rule.cost);
    if (when.empty) parts.push(`Costs ${amount} when ${when.empty} is empty.`);
    else if (when.nonEmpty) parts.push(`Costs ${amount} when ${when.nonEmpty} is not empty.`);
    else if (when.param) parts.push(`Costs ${amount} when ${when.param} is set.`);
    else if (when.flag) parts.push(`Costs ${amount} when ${when.flag} is true.`);
    else if (when.outcome) parts.push(`Costs ${amount} when the outcome is ${when.outcome}.`);
  }
  parts.push(TERMS_BILLING);
  return parts.join(" ");
}

export const PACKS = [
  { id: "freelance", label: "Freelance", credits: 25000, priceUsd: 27 },
  { id: "business", label: "Business", credits: 500000, priceUsd: 297 },
];

export function packsSentence() {
  return "Prepaid one-time packs, 1 credit per call by default: Freelance $27 for 25,000 credits, Business $297 for 500,000 credits. Credits never expire.";
}
