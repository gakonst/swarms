create table swarm_pictures (
  swarm text primary key references swarms (id),
  emoji text,
  color text,
  type text,
  data text,
  at integer not null,
  check ((emoji is not null and color is not null and type is null and data is null) or (emoji is null and color is null and type is not null and data is not null))
);
