import type { Metadata } from "next";
import { formatPrice, PLANS } from "@/lib/billing/plans";
import { grantList, listPriceMrr, planCounts, referralTotals, requireAdmin, usersById } from "@/lib/server/admin";
import { adminPromoCodes, adminRevenue, adminWebhookCheck, billingEnabled } from "@/lib/server/billing";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../admin-shell";
import { count, when } from "../format";
import { UserLink } from "../tables";
import styles from "../admin.module.css";

export const metadata: Metadata = { title: "Money · Admin", robots: PRIVATE_PAGE };

const failed = (err: unknown) => ({ error: err instanceof Error ? err.message : "Stripe didn’t answer." });

/** Plans and what they bring in, money from Stripe, promo codes, free plans and referrals. */
export default async function AdminMoneyPage() {
  const admin = await requireAdmin();
  const [plans, revenue, promos, grants, referrals, webhook] = await Promise.all([
    planCounts(),
    adminRevenue().catch(failed),
    adminPromoCodes().catch(failed),
    grantList(),
    referralTotals(),
    adminWebhookCheck().catch(failed),
  ]);
  const users = await usersById([...grants.map((g) => g.userId), ...referrals.top.map((r) => r.referrer_user_id)]);
  const total = plans.reduce((n, p) => ({ active: n.active + p.active, pastDue: n.pastDue + p.pastDue, ending: n.ending + p.ending }), { active: 0, pastDue: 0, ending: 0 });

  return (
    <AdminShell
      admin={admin}
      title="Money"
      lede={billingEnabled() ? "Subscriptions from Bamio’s records (Stripe keeps them current); money paid, from Stripe." : "Plans and payments are off on this server."}
    >
      {webhook && "error" in webhook ? (
        <p className={styles.alert}>Couldn’t check Stripe’s webhook: {webhook.error}</p>
      ) : webhook && (!webhook.found || !webhook.enabled || webhook.missing.length > 0) ? (
        <p className={styles.alert} role="status">
          {!webhook.found
            ? `Stripe has no webhook for ${webhook.url}, so plan changes reach Bamio only when it next reads Stripe.`
            : !webhook.enabled
              ? `Stripe’s webhook for ${webhook.url} is switched off.`
              : `Stripe’s webhook doesn’t send ${webhook.missing.join(", ")}.`}{" "}
          Fix it with <code>npm run stripe:setup -- --webhook https://your.domain</code> (keeps the signing secret).
        </p>
      ) : null}
      <section className={styles.stats} aria-label="Money in">
        <div className={styles.stat}>
          <span className={styles.kicker}>Monthly, at list prices</span>
          <span className={styles.big}>{formatPrice(Math.round(listPriceMrr(plans)))}</span>
          <p>{count(total.active)} working subscriptions, before promo codes</p>
        </div>
        {revenue && "error" in revenue ? (
          <div className={styles.stat}>
            <span className={styles.kicker}>Paid</span>
            <p className={styles.bad}>{revenue.error}</p>
          </div>
        ) : revenue ? (
          <>
            <div className={styles.stat}>
              <span className={styles.kicker}>Paid in the last 30 days</span>
              <span className={styles.big}>{formatPrice(revenue.last30dCents)}</span>
              <p>From {count(revenue.payingCustomers30d)} paying customers</p>
            </div>
            <div className={styles.stat}>
              <span className={styles.kicker}>Paid this month</span>
              <span className={styles.big}>{formatPrice(revenue.monthCents)}</span>
              <p>Since the 1st (UTC), after discounts and credit</p>
            </div>
          </>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="subs">
        <h2 id="subs">Subscriptions</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Plan</th>
                <th className={styles.num}>Working</th>
                <th className={styles.num}>Payment due</th>
                <th className={styles.num}>Ending</th>
                <th className={styles.num}>List price</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={`${p.plan}-${p.interval}`}>
                  <td>
                    {PLANS[p.plan].name} <span className="t-tertiary">{p.interval === "month" ? "monthly" : "every 3 months"}</span>
                  </td>
                  <td className={styles.num}>{count(p.active)}</td>
                  <td className={styles.num}>{count(p.pastDue)}</td>
                  <td className={styles.num}>{count(p.ending)}</td>
                  <td className={styles.num}>{formatPrice(p.interval === "month" ? PLANS[p.plan].price.month : PLANS[p.plan].price.quarter)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>All</b>
                </td>
                <td className={styles.num}>{count(total.active)}</td>
                <td className={styles.num}>{count(total.pastDue)}</td>
                <td className={styles.num}>{count(total.ending)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="promos">
        <h2 id="promos">Promo codes</h2>
        {promos === null ? (
          <p className={styles.note}>Plans and payments are off on this server.</p>
        ) : "error" in promos ? (
          <p className={styles.note}>{promos.error}</p>
        ) : promos.length === 0 ? (
          <p className={styles.note}>No promo codes. Make them in the Stripe Dashboard (Product catalog, Coupons).</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th className={styles.num}>Used</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id}>
                    <td className={styles.mono}>{p.code}</td>
                    <td>
                      {p.percentOff !== null ? `${p.percentOff}% off` : p.amountOffCents !== null ? `${formatPrice(p.amountOffCents)} off` : "—"}
                      {p.duration ? <span className={styles.sub}>{p.duration}</span> : null}
                    </td>
                    <td className={styles.num}>
                      {count(p.timesRedeemed)}
                      {p.maxRedemptions !== null ? ` of ${count(p.maxRedemptions)}` : ""}
                    </td>
                    <td>
                      <span className={`badge ${p.active ? "is-success" : ""}`}>{p.active ? "Active" : "Off"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="grants">
        <h2 id="grants">Free plans</h2>
        {grants.length === 0 ? (
          <p className={styles.note}>No free plans given.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Plan</th>
                  <th>Note</th>
                  <th>Since</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.userId}>
                    <td>
                      <UserLink id={g.userId} user={users.get(g.userId)} />
                    </td>
                    <td>{PLANS[g.plan]?.name ?? g.plan}</td>
                    <td>{g.note ?? <span className="t-tertiary">—</span>}</td>
                    <td className={styles.nowrap}>{when(g.createdAt).slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="refs">
        <h2 id="refs">Referrals</h2>
        <p className="t-secondary">
          {count(referrals.totals.earned + referrals.totals.credited)} friends paid ({count(referrals.totals.credited)} credited, {count(referrals.totals.earned)}{" "}
          waiting for credit) · {count(referrals.totals.pending)} subscribed, not paid yet · {formatPrice(referrals.totals.cents)} of credit earned
        </p>
        {referrals.top.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Referrer</th>
                  <th className={styles.num}>Friends</th>
                  <th className={styles.num}>Paid</th>
                  <th className={styles.num}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {referrals.top.map((r) => (
                  <tr key={r.referrer_user_id}>
                    <td>
                      <UserLink id={r.referrer_user_id} user={users.get(r.referrer_user_id)} />
                    </td>
                    <td className={styles.num}>{count(r.friends)}</td>
                    <td className={styles.num}>{count(r.rewarded)}</td>
                    <td className={styles.num}>{formatPrice(r.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </AdminShell>
  );
}
