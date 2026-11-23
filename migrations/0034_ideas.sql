create table ideas (
  id text primary key,
  swarm text not null references swarms (id),
  parent text not null,
  author text not null,
  text text not null,
  node text,
  created_at integer not null
);

create index ideas_parent on ideas (swarm, parent, created_at);

create index ideas_author on ideas (author, created_at);
