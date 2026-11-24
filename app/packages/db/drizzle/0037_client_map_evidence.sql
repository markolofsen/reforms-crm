-- Hand-written (P136 Q1, verdicts 1 and 4): each version of a client map keeps its evidence and its reasons. `sources` is the
-- JSON object node id -> refs the map's `%% src` lines name (a message id, or "YYYY-MM-DD channel"); `reasons` the JSON object
-- node id -> why the redraw removed or renamed that node (the agent's `why`, checked by `client_map`). Both are null on a version
-- drawn before P136. Additive only: a running instance keeps working on the old code until it restarts.
ALTER TABLE `client_maps` ADD `sources` text;
--> statement-breakpoint
ALTER TABLE `client_maps` ADD `reasons` text;
