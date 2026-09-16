/**
 * Nansen label parsing. Labels arrive as "🏦 Binance: Deposit [0xe46077]", "🤖 🏦 Coinbase [0xa9d1e0]", "Token Billionaire",
 * "sofaking.eth*", "🤖 Tether: USDT Token". The 🏦 prefix marks an exchange entity; the "[0x…]" suffix is the address stub.
 */
export type ParsedLabel = {
  raw: string;
  /** label without emoji, zero-width chars and the [0x…] stub */
  text: string;
  /** "Binance" from "Binance: Deposit" or "Binance 14"; undefined for wealth tags / ENS names */
  entity?: string;
  /** "Deposit", "Hot Wallet", … — the part after the colon */
  role?: string;
  /** carries the 🏦 exchange marker */
  exchange: boolean;
  /** a generic wealth/activity tag, not an identity ("Token Billionaire", "High Activity", …) */
  generic: boolean;
};

const GENERIC = /^(Token|ETH|SOL) (Millionaire|Billionaire)$|^(High Activity|High Balance|Proxy|MultiSig|Multisig|Hot Wallet|Cold Wallet|Whale|Fresh Wallet|Smart Money)$|Trader$|User$/i;
const ENS = /\.(eth|sol)\*?$/i;
const CONTRACT_WORD = /\b(Contract|Router|Proxy|Pool|Bridge|Vault|Factory|Forwarder)\b|\bToken$/;

export function stripLabel(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF\uFFF0-\uFFFF]/g, "")
    .replace(/\s*\[0x[0-9a-fA-F]+\]\s*$/, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLabel(raw: string | null | undefined): ParsedLabel | undefined {
  if (!raw) return undefined;
  const text = stripLabel(raw);
  if (!text) return undefined;
  const exchange = raw.includes("🏦");
  const generic = GENERIC.test(text) || ENS.test(text);
  let entity: string | undefined, role: string | undefined;
  const colon = text.indexOf(":");
  if (colon > 0) { entity = text.slice(0, colon).trim(); role = text.slice(colon + 1).trim(); }
  else if (!generic) entity = text.replace(/\s+\d+$/, "").trim(); // "Binance 14" → "Binance"
  if (entity && (GENERIC.test(entity) || ENS.test(entity))) entity = undefined;
  return { raw, text, entity, role, exchange, generic };
}

/** "<Entity>: Deposit" — Nansen's label for a user-level exchange deposit address. */
export function isDepositLabel(p: ParsedLabel | undefined): p is ParsedLabel & { entity: string } {
  return !!p && !!p.entity && /^Deposit$/i.test(p.role ?? "");
}

/** Label text that names a contract rather than a wallet ("Tether: USDT Token", "Utility Contract", "Uniswap: V2 Router"). */
export function isContractLabel(p: ParsedLabel | undefined): boolean {
  return !!p && !p.generic && CONTRACT_WORD.test(p.text);
}
