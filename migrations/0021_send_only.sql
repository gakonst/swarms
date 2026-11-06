alter table swarms add column spent_before integer not null default 0;

update swarms set spent_before =
  coalesce((select sum(cast(spent as integer)) from pledges where pledges.swarm = swarms.id and pledges.status != 'pending'), 0)
  + coalesce((select sum(cast(pulled as integer)) from budgets where budgets.swarm = swarms.id and budgets.token = 'mach' and budgets.status != 'pending'), 0);

insert or ignore into contributions (id, swarm, kind, budget, contributor, token, amount, note, note_id, created_at)
  select 'pledge:' || id, swarm, 'transfer', null, lower(contributor), token, cast(min(cast(amount as integer), cast(spent as integer)) as text), note, note_id, created_at
  from pledges
  where status != 'pending' and contributor is not null and min(cast(amount as integer), cast(spent as integer)) > 0;

insert or ignore into contributions (id, swarm, kind, budget, contributor, token, amount, note, note_id, created_at)
  select 'budget:' || id, swarm, 'transfer', null, lower(contributor), token, cast(given as text), note, note_id, created_at
  from (
    select *, case when period = 0 then min(cast(amount as integer), cast(delivered as integer), cast(pulled as integer)) else min(cast(delivered as integer), cast(pulled as integer)) end as given
    from budgets
    where token = 'mach' and status != 'pending' and contributor is not null
  )
  where given > 0;

update contributions set kind = 'transfer', budget = null where kind != 'transfer' or budget is not null;
