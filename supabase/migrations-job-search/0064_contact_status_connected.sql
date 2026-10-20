-- A contact status for someone you are connected to but have not written to
-- (plan #2432.5).
--
-- The LinkedIn import added every connection as a contact, and each took the
-- default To contact, which reads as a send you have queued. Connected says
-- you know them and nothing is planned. Logging a send moves it to Contacted,
-- as it does To contact. Schema only; migrations/0270 moves the imported contacts.

alter type job_search.contact_status add value if not exists 'connected' after 'to_contact';
