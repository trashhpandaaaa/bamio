-- Bamio's news (an announcement to everyone, like the clipping campaigns opening): its own email
-- category, which people can turn off under Notifications (src/lib/profile/notifications.ts).
alter table emails drop constraint emails_category_check;
alter table emails add constraint emails_category_check check (category in ('account', 'videos', 'minutes', 'news'));
