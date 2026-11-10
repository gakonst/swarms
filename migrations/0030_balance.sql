update swarms set spent_before = spent_before + sponsor_spent, sponsor_spent = 0
where not exists (select 1 from contributions where swarm = swarms.id and id like 'backing:%');

update swarms set spent_before = spent_before + max(0, min(
  coalesce((select sum(cast(amount as integer)) from contributions where swarm = swarms.id), 0) - (spent_before + pool_spent + sponsor_spent) - (pool_left + sponsor_left),
  coalesce((select sum(cast(amount as integer)) from contributions where swarm = swarms.id and created_at < 1794273600000), 0) - spent_before
));
