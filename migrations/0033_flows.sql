create table flows (
  id text primary key,
  swarm text not null references swarms (id),
  node text not null,
  run text,
  contributor text not null,
  amount integer not null,
  kind text not null check (kind in ('pledge', 'grant', 'commit', 'spend', 'settle', 'return', 'move')),
  peer text,
  created_at integer not null
);

create index flows_bucket on flows (swarm, node, run);

create index flows_contributor on flows (swarm, contributor);
