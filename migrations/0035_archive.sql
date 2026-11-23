alter table swarms add column archived_at integer;

alter table swarms add column form text not null default 'agent' check (form in ('agent', 'tree'));
