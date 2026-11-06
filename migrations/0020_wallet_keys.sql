create table if not exists wallet_keys (
  id text primary key,
  address text not null,
  access_key text not null,
  sealed_key text not null,
  authorization text not null,
  key_authorization text,
  expires_at integer not null,
  created_at integer not null
);

create index if not exists wallet_keys_by_address on wallet_keys (address, expires_at);
