-- Referrals: each user's link code, and who referred whom (src/lib/server/referrals.ts).
-- A referred user's first paid payment earns the referrer a credit on their Bamio bill, once.
create table referral_codes (
  user_id text primary key,
  code text not null unique,
  created_at bigint not null
);

-- One referrer per user: the link they arrived with when they first went to checkout.
create table referrals (
  referred_user_id text primary key,
  referrer_user_id text not null,
  code text not null,
  -- pending: subscribing, nothing paid yet. earned: their first payment went through; the
  -- credit is owed. credited: it's on the referrer's Stripe balance.
  status text not null default 'pending' check (status in ('pending', 'earned', 'credited')),
  reward_cents integer not null default 0,
  -- The referred user's first paid invoice, and the referrer's Stripe balance transaction.
  invoice_id text,
  balance_txn_id text,
  created_at bigint not null,
  earned_at bigint,
  credited_at bigint,
  check (referred_user_id <> referrer_user_id)
);

create index referrals_referrer on referrals (referrer_user_id);
create index referrals_owed on referrals (referrer_user_id) where status = 'earned';
