-- Extensions and enum types.
-- Kept in its own migration so enums exist before any table references them.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- pg_trgm lives in `extensions` on Supabase; make its operators resolvable
-- from unqualified SQL in functions and policies.
set search_path = public, extensions;

create type email_provider as enum ('gmail', 'outlook');

create type email_account_status as enum ('active', 'needs_reauth', 'disconnected', 'error');

create type message_classification as enum (
  'order_confirmation',
  'shipping',
  'delivery',
  'return',
  'cancellation',
  'not_relevant'
);

create type parse_status as enum ('pending', 'parsed', 'failed', 'skipped', 'needs_review');

create type order_source as enum ('email', 'manual', 'receipt_photo');

-- Derived, never written by hand. See public.order_status() in 0004.
create type order_status as enum (
  'ordered',
  'shipped',
  'delivered',
  'partially_returned',
  'returned',
  'cancelled'
);

create type shipment_status as enum (
  'pending',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception'
);

create type return_status as enum ('initiated', 'in_transit', 'received', 'refunded', 'denied');

create type inventory_status as enum ('owned', 'returned', 'disposed', 'gifted', 'sold', 'lost');

create type disposal_method as enum ('donated', 'trashed', 'sold', 'gifted', 'recycled');

create type saved_item_status as enum ('saved', 'purchased', 'dismissed');

create type sync_job_type as enum ('backfill', 'incremental');

create type sync_job_status as enum ('queued', 'running', 'completed', 'failed');
