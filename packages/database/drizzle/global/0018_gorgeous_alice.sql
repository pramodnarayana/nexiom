CREATE TABLE IF NOT EXISTS "workspace_pieces_dedupe_audit" (
    "deleted_id" uuid,
    "workspace_id" uuid,
    "piece_id" uuid,
    "deleted_at" timestamp with time zone DEFAULT now()
);

WITH duplicates AS (
    SELECT "id", "workspace_id", "piece_id"
    FROM "workspace_pieces"
    WHERE "id" NOT IN (
        SELECT MIN("id")
        FROM "workspace_pieces"
        GROUP BY "workspace_id", "piece_id"
    )
),
audit_insert AS (
    INSERT INTO "workspace_pieces_dedupe_audit" ("deleted_id", "workspace_id", "piece_id")
    SELECT "id", "workspace_id", "piece_id" FROM duplicates
)
DELETE FROM "workspace_pieces"
WHERE "id" IN (SELECT "id" FROM duplicates);

ALTER TABLE "workspace_pieces" ADD CONSTRAINT "ux_workspace_pieces_workspaceId_pieceId" UNIQUE("workspace_id","piece_id");