alter table swarms add column hidden integer not null default 0;

update swarms set hidden = 1 where id in ('5c1509604eda', '7dd78b1cdc91', '720768f29401', '53088cf6bf00', '49f237af6cd6', '6558a7396aab', '24a74a88031b', 'f138898cf0b4', '236cb54576c8')
  or title in ('Payer smoke test', 'MPP hand check', 'Paid hand check', 'MACH pledge hand fallback', 'Hello from production', 'Gateway tool check', 'Describe a lent machine', 'Current Tempo mainnet block height and gas price', 'Live check: search and paid fetch');
