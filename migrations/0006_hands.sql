create table hands (
  swarm text not null references swarms (id),
  name text not null,
  label text not null,
  created_at integer not null,
  primary key (swarm, name)
);
