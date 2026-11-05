alter table steers add column branch integer;
create index if not exists steers_branch on steers (swarm, branch) where branch is not null;
create table branches (
  swarm text not null references swarms (id),
  branch integer not null,
  base text not null,
  created_at integer not null,
  primary key (swarm, branch)
);
