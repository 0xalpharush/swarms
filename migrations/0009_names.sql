create table names (
  address text primary key,
  name text not null unique,
  updated_at integer not null
);
