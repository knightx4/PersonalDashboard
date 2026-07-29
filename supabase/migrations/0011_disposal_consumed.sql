-- Add "consumed" as a disposal method (used up / finished the product).

set search_path = public, extensions;

alter type disposal_method add value if not exists 'consumed';
