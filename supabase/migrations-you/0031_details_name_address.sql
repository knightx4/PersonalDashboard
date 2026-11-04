-- The name, email and mailing address a letter is signed with, on You's
-- Details tab beside the phone.
--
-- The cover letter PDF used to carry its signer and contact line as constants
-- in lib/jobs/cover-letter-pdf.ts, which put one person's address and phone in
-- the repository. Now it reads them from this row, so whoever signs in signs
-- their own letters. Each is optional, kept as they wrote it, like the others.

alter table you.details
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists mailing_address text;

alter table you.details add constraint details_full_name_ck check (full_name is null or length(full_name) <= 200);
alter table you.details add constraint details_email_ck check (email is null or length(email) <= 200);
alter table you.details add constraint details_mailing_address_ck
  check (mailing_address is null or length(mailing_address) <= 500);

comment on table you.details is
  'The person''s own details, one row each: name, email, phone, mailing address, LinkedIn address, citizenship, race, gender and sexuality, as they wrote them. A null is a detail they have not given. The cover letter is signed with the name, email, phone and address.';

notify pgrst, 'reload schema';
