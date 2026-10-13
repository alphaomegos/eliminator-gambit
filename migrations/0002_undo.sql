-- Elimination order inside a round, so the last move can be undone.
ALTER TABLE items ADD COLUMN elim_order INTEGER;
UPDATE items SET elim_order = eliminated_at WHERE eliminated = 1;
