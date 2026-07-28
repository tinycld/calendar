/// <reference path="../../../server/pb_data/types.d.ts" />
// Two subscription-sync fixes (REMEDIATION P2-8):
//
// 1. The ical_uid unique index was GLOBAL while the contract (caldav
//    Source.Event) is per-calendar — so a second calendar subscribing to the
//    same feed violated the index on every insert, the error was swallowed,
//    and the calendar silently stayed empty while the sync reported success.
//    The index becomes (calendar, ical_uid).
//
// 2. `from_subscription` marks events the sync created, so the prune step
//    ("delete events whose uid left the feed") can tell feed events from the
//    user's own — UI-created events all carry generated UIDs, and pruning by
//    uid alone deleted every local event the moment a populated calendar
//    gained a subscription_url.
//
//    Deliberately NO backfill: events imported before this migration are
//    unmarked, which errs toward keeping data — the sync re-marks any event
//    it matches in the feed, so pruning converges after one sync; an event
//    already gone from the feed lingers instead of being deleted, the safe
//    side of the trade.
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('calendar_events')

        collection.fields.addAt(
            collection.fields.length,
            new Field({
                id: 'cal_events_from_sub',
                name: 'from_subscription',
                type: 'bool',
            })
        )

        collection.indexes = [
            ...collection.indexes.filter(idx => !idx.includes('idx_cal_events_ical_uid')),
            'CREATE UNIQUE INDEX `idx_cal_events_ical_uid` ON `calendar_events` (`calendar`, `ical_uid`) WHERE `ical_uid` != ""',
        ]

        app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('calendar_events')

        collection.fields.removeById('cal_events_from_sub')

        collection.indexes = [
            ...collection.indexes.filter(idx => !idx.includes('idx_cal_events_ical_uid')),
            'CREATE UNIQUE INDEX `idx_cal_events_ical_uid` ON `calendar_events` (`ical_uid`) WHERE `ical_uid` != ""',
        ]

        app.save(collection)
    }
)
