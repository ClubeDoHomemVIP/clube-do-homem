create extension if not exists pgcrypto;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  telegram_username text,
  telegram_user_id bigint unique,
  status text not null default 'lead' check (status in ('lead','pending','active','overdue','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  plan text not null check (plan in ('monthly','lifetime')),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending','active','overdue','cancelled','expired')),
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  provider_id text unique,
  customer_id uuid references public.customers(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null default 'pushinpay',
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending',
  raw_payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  commission_percent numeric(5,2) not null default 20,
  status text not null default 'active' check (status in ('active','paused')),
  created_at timestamptz not null default now()
);

create table if not exists public.content_posts (
  id uuid primary key default gen_random_uuid(),
  source_id text unique,
  source_name text,
  source_url text,
  title text not null,
  body text,
  status text not null default 'pending' check (status in ('pending','approved','published','rejected')),
  scheduled_at timestamptz,
  published_at timestamptz,
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger customers_updated_at before update on public.customers
for each row execute function public.set_updated_at();

create trigger subscriptions_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();

alter table public.customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.affiliates enable row level security;
alter table public.content_posts enable row level security;
alter table public.events enable row level security;
alter table public.webhook_events enable row level security;

create index if not exists subscriptions_customer_id_idx on public.subscriptions(customer_id);
create index if not exists subscriptions_status_expires_idx on public.subscriptions(status, expires_at);
create index if not exists payments_customer_id_idx on public.payments(customer_id);
create index if not exists payments_status_idx on public.payments(status);
create index if not exists content_posts_status_scheduled_idx on public.content_posts(status, scheduled_at);
create index if not exists events_type_created_idx on public.events(event_type, created_at desc);
