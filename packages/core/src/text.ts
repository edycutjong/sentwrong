/**
 * The one copy button. Ticket / checklist / memo / note, filled from the verdict's evidence. Square-bracket fields are
 * the only things the person has to type; everything else came from Nansen.
 */
import type { Decision } from "./classify.js";

export type Transfer = { hash: string; date: string; amount: number; symbol: string; from: string; to: string };
export type Action = { kind: "ticket" | "checklist" | "memo" | "note"; title: string; text: string };

const ph = (s: string | undefined, fallback: string) => s ?? `[${fallback}]`;
const amt = (t?: Transfer) => (t ? `${t.amount} ${t.symbol}` : "[amount and token]");
const when = (t?: Transfer) => (t ? t.date.slice(0, 10) : "[date]");

export function actionFor(d: Decision, ctx: { address: string; sender?: string; chain: string; transfer?: Transfer }): Action {
  const { address, sender, chain, transfer } = ctx;
  const evidence = d.evidence.map((e) => `- ${e.field}: ${e.value}`).join("\n");
  switch (d.route) {
    case "exchange-deposit": {
      const ex = d.entity ?? "the exchange";
      return {
        kind: "ticket", title: `Support ticket for ${ex}`,
        text: `Subject: Funds sent to a ${ex} deposit address by mistake — recovery request

Hello ${ex} support,

On ${when(transfer)} I sent ${amt(transfer)} from my wallet ${ph(sender, "your address")} to ${address} on ${chain} (transaction ${ph(transfer?.hash, "transaction hash")}).

This was a mistake. ${address} is a ${ex} customer deposit address — Nansen labels it "${d.evidence[0]?.value ?? ex}" and its transfers are swept into ${ex}'s own wallets. It may belong to another ${ex} customer, or to an old account of mine. Please locate the account that owns this deposit address and either credit the funds to it (if it is mine) or return them to ${ph(sender, "your address")}.

Evidence (Nansen API):
${evidence}

Account email: [your ${ex} account email]
Thank you,
[your name]`,
      };
    }
    case "your-own-wallet":
      return {
        kind: "checklist", title: "No ticket needed — it's yours",
        text: `${address} is linked to your wallet ${ph(sender, "your address")}:
${evidence}

What to do:
1. Open the wallet (app or seed phrase) that controls ${ph(sender, "your address")} — the recipient is one of its addresses or something it created.
2. Sent on the wrong network? Switch that wallet to ${chain}: the same key controls the same address there.
3. Nothing to file, nobody to pay. Anyone offering "recovery" for a fee is a scam.`,
      };
    case "active-stranger": {
      const odds = d.sub === "active" ? "The owner moves funds, so a memo can be seen. Returns do happen, but they are the exception." : d.sub === "dormant" ? "The owner has never sent anything from this address; the memo may never be read." : "There is no history at all yet; if you sent minutes ago, wait and re-run.";
      return {
        kind: "memo", title: "On-chain memo to the owner",
        text: `Send a 0-value transaction to ${address} on ${chain} with this message as hex-encoded input data (MetaMask: Settings → Advanced → Show hex data). Or post it wherever the address is public.

Hi — on ${when(transfer)} I sent ${amt(transfer)} to your address ${address} by mistake (tx ${ph(transfer?.hash, "transaction hash")}). If you return it to ${ph(sender, "your address")} I will send 10% back as a thank-you. Contact: [your email or X handle].

Honest odds: ${odds}
What Nansen sees:
${evidence}

Do NOT pay anyone who promises to "recover" funds from a private wallet — they cannot.`,
      };
    }
    case "contract-or-burn": {
      if (d.sub === "forwarder") return {
        kind: "note", title: `Ask the service that issued this address`,
        text: `On ${when(transfer)} ${amt(transfer)} was sent from ${ph(sender, "your address")} to ${address} on ${chain} (tx ${ph(transfer?.hash, "transaction hash")}).

${address} is a forwarding contract: everything it receives is moved straight into ${d.entity ?? "a custodian"}'s custody wallet. Such addresses are issued by exchanges and payment services to their customers. The service that gave you this address (check the email / page you copied it from) can see the deposit and credit or return it — open a ticket with THEM and quote the transaction hash.

There is no public support desk for ${d.entity ?? "the custodian"} itself, and no third party can move these funds. Anyone offering paid "recovery" is a scam.

What Nansen sees:
${evidence}`,
      };
      const what = d.sub === "burn" ? "a burn address" : d.sub === "token-contract" ? `the ${d.entity ?? ""} token contract`.replace("  ", " ") : `a smart contract${d.entity ? ` (${d.entity})` : ""}`;
      return {
        kind: "note", title: "Unrecoverable — keep this for your records",
        text: `On ${when(transfer)} ${amt(transfer)} was sent from ${ph(sender, "your address")} to ${address} on ${chain} (tx ${ph(transfer?.hash, "transaction hash")}).

${address} is ${what}. ${d.sub === "burn" ? "Nothing sent to a burn address can be moved by anyone, including its creator." : d.sub === "token-contract" ? "Token contracts have no owner-controlled withdrawal for tokens sent to them; the issuer does not recover these." : "Unless the contract's owner has a documented recovery function, there is no one to ask."}

There is no support desk for this address. Anyone who contacts you offering to recover it for a fee is a scam — the funds cannot be moved. Keep this note and the transaction hash for your loss records.

What Nansen sees:
${evidence}`,
      };
    }
    case "retry":
      return { kind: "note", title: "No verdict", text: `Nansen did not answer for ${address} on ${chain}. Nothing was decided. Retry in a minute.\n${evidence}` };
  }
}
