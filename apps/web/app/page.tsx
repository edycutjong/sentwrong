import Checker from "./Checker";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return (
    <>
      <p className="hook">Sent crypto to the wrong address?</p>
      <p className="sub">Paste the address. Nansen's labels on its counterparties, funder and transfers decide which of four recovery routes you are on — an exchange deposit address, your own wallet, a stranger, or a contract — and draft the ticket or memo for you.</p>
      <Checker initial={{ address: pick("address"), sender: pick("from"), chain: pick("chain") }} />
    </>
  );
}
