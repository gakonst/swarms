create index if not exists contributions_backing on contributions (swarm, contributor, amount, note_id, created_at);

insert into search (search, rank) values ('rank', 'bm25(0, 0, 0, 2, 1)');
