create table swarms (
  id text primary key,
  title text not null,
  goal text not null,
  status text not null default 'funding',
  rounds integer not null default 0,
  machines integer not null default 0,
  workers integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);

create table pledges (
  id text primary key,
  swarm text not null references swarms (id),
  request text not null,
  amount text not null,
  note text,
  note_id text,
  contributor text,
  sealed_key text,
  spent text not null default '0',
  status text not null default 'pending',
  created_at integer not null,
  updated_at integer not null
);

create index pledges_by_swarm on pledges (swarm, status, created_at);
