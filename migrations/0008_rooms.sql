create table sessions (
  key text primary key,
  value text not null,
  expires_at integer
);

create index sessions_by_expiry on sessions (expires_at);

create table steers (
  id text primary key,
  swarm text not null references swarms (id),
  contributor text not null,
  note text not null,
  note_id text not null,
  amount text not null,
  created_at integer not null
);

create index steers_by_swarm on steers (swarm, contributor);

alter table hands add column contributor text;
