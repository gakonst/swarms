create table swarm_names (
  name text primary key,
  swarm text not null references swarms (id),
  current integer not null default 1 check (current in (0, 1)),
  created_at integer not null
);

create unique index swarm_names_current on swarm_names (swarm) where current = 1;
