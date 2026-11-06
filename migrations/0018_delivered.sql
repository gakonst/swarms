alter table budgets add column delivered text not null default '0';

update budgets set delivered = pulled;

update contributions set
  note = (select note from budgets where budgets.id = contributions.budget),
  note_id = (select note_id from budgets where budgets.id = contributions.budget)
where kind = 'pledge' and note_id is null and budget is not null;
