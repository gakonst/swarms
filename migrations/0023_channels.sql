alter table contributions add column channel text;

create index if not exists contributions_channel on contributions (channel) where channel is not null;

alter table swarms add column sponsor_spent integer not null default 0;

alter table swarms add column sponsor_left integer not null default 0;
