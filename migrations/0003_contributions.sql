alter table swarms add column wallet text;

alter table swarms add column sealed_wallet text;

alter table swarms add column pool_spent integer not null default 0;

alter table swarms add column pool_left integer not null default 0;

create table contributions (
  id text primary key,
  swarm text not null references swarms (id),
  kind text not null,
  budget text,
  contributor text not null,
  token text not null,
  amount text not null,
  note text,
  note_id text,
  created_at integer not null
);

create index contributions_by_swarm on contributions (swarm, created_at);

create table budgets (
  id text primary key,
  swarm text not null references swarms (id),
  token text not null,
  amount text not null,
  period integer not null,
  expires_at integer not null,
  access_key text not null,
  sealed_key text not null,
  authorization text not null,
  key_authorization text,
  published integer not null default 0,
  contributor text,
  note text,
  note_id text,
  pulled text not null default '0',
  left_now text,
  period_end integer,
  next_at integer,
  pulled_at integer,
  detail text,
  status text not null default 'pending',
  created_at integer not null,
  updated_at integer not null
);

create index budgets_by_swarm on budgets (swarm, status, created_at);
