create table if not exists search_rows (
  swarm text not null,
  kind text not null,
  ref text not null,
  row integer not null,
  primary key (swarm, kind, ref)
) without rowid;

insert or replace into search_rows (swarm, kind, ref, row) select swarm, kind, ref, rowid from search;
