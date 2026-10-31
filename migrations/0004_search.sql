create table reports (
  swarm text not null references swarms (id),
  round integer not null,
  status text not null,
  message text,
  started_at integer not null,
  ended_at integer not null,
  spent text not null,
  primary key (swarm, round)
);

create table pledge_devices (
  pledge text primary key,
  user_code text not null,
  verification_uri text not null,
  verification_uri_full text not null,
  interval integer not null,
  expires_at integer not null
);

create virtual table search using fts5 (
  swarm unindexed,
  kind unindexed,
  ref unindexed,
  title,
  body,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

insert into search (swarm, kind, ref, title, body) select id, 'swarm', '', title, goal from swarms;

insert into search (swarm, kind, ref, title, body)
  select swarm, 'note', note_id, '', min(note) from (
    select swarm, note_id, note from pledges where status != 'pending' and note_id is not null
    union all select swarm, note_id, note from contributions where note_id is not null
    union all select swarm, note_id, note from budgets where status != 'pending' and note_id is not null
  )
  group by swarm, note_id;
