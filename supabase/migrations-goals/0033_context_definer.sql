-- ===========================================================================
-- The context guard runs as its owner (0032).
--
-- goals.context_check reads goals.request_value to tell Claude's writes from
-- the person's, and request_value is revoked from authenticated (0001), so a
-- signed-in write to goals.context failed with "permission denied for
-- function request_value". The guard on goals.items (0006) is security
-- definer for the same reason; this one now is too. Its one read of
-- goals.items is filtered by the row's own user_id, so running as the owner
-- shows it nothing it could not see anyway.
-- ===========================================================================

alter function goals.context_check() security definer;
