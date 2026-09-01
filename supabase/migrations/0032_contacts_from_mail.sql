-- One row per person, so ingestion can record them without making duplicates.
--
-- Contacts have always been typed in by hand, and the table has never held a
-- row -- so there was never a reason for a natural key. Now that the inbox
-- writes them, every recruiter who mails twice would otherwise be two people.
--
-- Two keys, because a person is not the same thing as an address.
--
-- Within one company a name is the person: the same recruiter wrote from
-- @eliseai.com and @meetelise.com, and one human with two addresses should be
-- one row rather than two that look like a bug. Across companies a name is not
-- enough -- two Dana Whitfields at two employers are two people -- so the
-- address carries identity there.
--
-- Both are partial, so a hand-written contact with only a name, or only an
-- address, is still a legitimate row.

create unique index if not exists contacts_user_company_name_key
  on job_search.contacts (user_id, company_id, lower(full_name))
  where company_id is not null;

create unique index if not exists contacts_user_email_key
  on job_search.contacts (user_id, lower(email))
  where email is not null;
