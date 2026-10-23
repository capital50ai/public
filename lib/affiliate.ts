import "server-only";

// First-touch attribution: the first invite link someone opens is remembered for 30 days.
export const REF_COOKIE = "c50_ref";
export const REF_DAYS = 30;

export type AffiliateRates = { fee: number; dep: number };

const pct = (x: number) => `${+(x * 100).toFixed(2)}%`;

// The approved page states "15%" in its static text. When the owner changes the rates, every place
// that states the terms is rewritten so the page never misstates them.
export function affiliateCopy(html: string, r: AffiliateRates): string {
  const f = pct(r.fee);
  const dep = r.dep > 0 ? pct(r.dep) : null;
  const swaps: [string, string][] = [
    ['Earn<span class="nb">15%</span>', `Earn<span class="nb">${f}</span>`],
    ['<span class="it">Earn 15% of our fee.</span>', `<span class="it">Earn ${f} of our fee.</span>`],
    [
      "Every month your members make a profit, you get 15% of the 2.5% fee we earn from them.",
      `Every month your members make a profit, you get ${f} of the 2.5% fee we earn from them.` +
        (dep ? ` Plus ${dep} of their deposits, paid by us.` : ""),
    ],
    [
      "You get <b>15% of the 2.5% fee</b> we earn from every member you invite, for as long as they stay.",
      `You get <b>${f} of the 2.5% fee</b> we earn from every member you invite, for as long as they stay.` +
        (dep ? ` Plus <b>${dep} of every deposit</b> they make, paid by Capital 50, never taken from them.` : ""),
    ],
    [
      "<b>You earn 15% of that fee</b><p>Credited when the month closes.",
      `<b>You earn ${f} of that fee${dep ? ` + ${dep} of deposits` : ""}</b><p>Credited when the month closes.`,
    ],
    [
      "15% × 2.5% × your members' profit.",
      `${f} × 2.5% × your members' profit.${dep ? ` Deposit commission (${dep}, once per deposit) is extra and not shown here.` : ""}`,
    ],
    [
      "Preview rows are placeholders. Live rankings are calculated automatically from paid commissions — they can't be edited by hand.",
      "Rankings are calculated automatically from credited commissions — they can't be edited by hand. Names show only if the affiliate turns it on in Profile.",
    ],
  ];
  for (const [from, to] of swaps) {
    if (!html.includes(from)) console.error("affiliateCopy: text not found", from.slice(0, 60));
    html = html.split(from).join(to);
  }
  return html;
}
