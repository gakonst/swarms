alter table steers add column agent text;
update steers set agent = '' where branch is not null;
create table branches_next (
  swarm text not null references swarms (id),
  agent text not null default '',
  branch integer not null,
  base text not null,
  created_at integer not null,
  settled_at integer,
  primary key (swarm, agent, branch)
);
insert into branches_next (swarm, agent, branch, base, created_at, settled_at) select swarm, '', branch, base, created_at, settled_at from branches;
drop table branches;
alter table branches_next rename to branches;
drop index if exists steers_branch;
create index if not exists steers_branch on steers (swarm, agent, branch) where branch is not null;
alter table hands add column seen_at integer;
