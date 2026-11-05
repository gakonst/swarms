alter table swarms add column creator text;
alter table swarms add column team text;
alter table swarms add column steering text not null default 'open';
alter table steers add column budget integer not null default 0;
create index if not exists steers_budget on steers (swarm, contributor, created_at) where budget = 1;
