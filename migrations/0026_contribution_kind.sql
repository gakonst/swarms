alter table contributions drop column kind;

alter table contributions add column kind text;

create index if not exists contributions_sponsored on contributions (swarm, channel, amount) where channel is not null;
