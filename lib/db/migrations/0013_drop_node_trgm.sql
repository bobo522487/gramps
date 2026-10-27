-- idx_node_search has had no consumer since ee41526 deleted searchNodes: no query
-- in the app uses a trigram operator, and person search matches in memory over the
-- fully loaded lineage (ADR 0011). The GIN index still pays trigram decomposition
-- on every write to node.full_name, the app's hottest write column.
-- pg_trgm and idx_article_search stay: FR-ART-5 (article full-text search) needs
-- them the day 谱文 is implemented. Re-adding a trigram index on node requires
-- changing ADR 0011 first, in the same change as the query that uses it.
DROP INDEX IF EXISTS "idx_node_search";
