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
