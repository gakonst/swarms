alter table hands add column returned_at integer check (returned_at is null or seen_at is not null);
