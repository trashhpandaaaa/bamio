-- The card a free trial was started with (src/lib/server/trial-cards.ts): the free first video
-- needs a card, and a card starts one trial only. Bamio never sees a card's number: Stripe
-- gives every card a fingerprint, the same for the same number whoever adds it, and that is
-- what's kept.
create table trial_cards (
  fingerprint text primary key,
  -- Whose trial it started. Null once that account is deleted: the fingerprint stays, so the
  -- card can't start another trial on a new account.
  user_id text unique,
  -- For the account's own pages ("Visa ending 4242"); cleared with the account.
  brand text,
  last4 text,
  created_at bigint not null
);
