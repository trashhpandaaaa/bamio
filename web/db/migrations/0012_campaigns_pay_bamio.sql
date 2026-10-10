-- Campaigns pay Bamio, and Bamio pays the clippers (2026-10-10). Before, a campaign's owner paid
-- clippers themselves, and the "Run a campaign" form asked how: campaign_requests.payout. The
-- form no longer asks and the app no longer writes or reads the column; what older requests
-- said stays in it.
alter table campaign_requests alter column payout set default '';
