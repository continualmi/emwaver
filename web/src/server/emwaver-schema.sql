create schema if not exists emwaver;

alter table if exists public.provisioned_devices set schema emwaver;

create table if not exists emwaver.provisioned_devices (
  board_type text not null,
  hardware_uid text not null,
  owner_user_id uuid references core.users(id) on delete set null,
  owner_firebase_uid text,
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (board_type, hardware_uid)
);

create index if not exists emwaver_provisioned_devices_owner_idx
  on emwaver.provisioned_devices (owner_user_id, last_seen_at desc);

create table if not exists emwaver.auth_handoff_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  user_id uuid not null references core.users(id) on delete cascade,
  firebase_uid text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists emwaver_auth_handoff_codes_user_expires_idx
  on emwaver.auth_handoff_codes (user_id, expires_at desc);

create table if not exists emwaver.account_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references core.users(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists emwaver_account_api_keys_active_idx
  on emwaver.account_api_keys (user_id)
  where revoked_at is null;
