-- idx_article_search has had no consumer since article list filters titles in
-- the browser over the fully loaded list (components/article/article-list.tsx).
-- plain_text is still derived on every save (ADR 0010 / derivePlainText); the
-- GIN index only paid trigram maintenance on the hottest article write path.
-- FR-ART-5 body search remains deferred: re-add the index in the same change
-- as the query that uses it (ADR 0011). Keep pg_trgm installed so that day is
-- one CREATE INDEX, not CREATE EXTENSION.
DROP INDEX IF EXISTS "idx_article_search";
