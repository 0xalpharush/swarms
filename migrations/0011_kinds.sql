alter table budgets add column kind text not null default 'pledge' check (kind in ('pledge', 'budget'));

update budgets set kind = case when period > 0 then 'budget' else 'pledge' end;

create index budgets_kind on budgets (swarm, kind, status);
