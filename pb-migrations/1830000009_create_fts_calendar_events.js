/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
migrate(
    app => {
        app.db()
            .newQuery(`
                CREATE VIRTUAL TABLE IF NOT EXISTS fts_calendar_events USING fts5(
                    record_id UNINDEXED, title, description, location,
                    tokenize='porter unicode61'
                )
            `)
            .execute()

        // calendar_events shipped long before this index, and the sync hooks
        // only fire on future writes — so without a backfill every existing
        // event would be invisible to search while new ones appeared, which
        // reads as search being broken rather than as a missing index.
        app.db()
            .newQuery(`
                INSERT INTO fts_calendar_events (record_id, title, description, location)
                SELECT id, title, description, location FROM calendar_events
            `)
            .execute()
    },
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_calendar_events').execute()
    }
)
