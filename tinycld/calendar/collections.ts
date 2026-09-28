import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { CalendarSchema } from './types'

// Replace (not intersect) the generated entries for calendar's own collections —
// a plain intersection would merge each overlapping entry field-wise, letting
// a generated `any` absorb any typed override (see drive's collections.ts).
type MergedSchema = Omit<Schema, keyof CalendarSchema> & CalendarSchema

// Hoisted rather than written inline at each call site: an inline
// `collectionOptions` literal defeats `alwaysFetchRelations` inference in pbtsdb.
const indexing = {
    autoIndex: 'eager' as const,
    defaultIndexType: BasicIndex,
}

// Every collection syncs on demand and subscribes per query (pbtsdb 0.10):
// only the rows a live query asks for enter the store, and realtime covers
// exactly those rows. The server emits a delete to a subscription a row
// leaves, so a filtered view stays correct across updates.
const onDemand = { syncMode: 'on-demand', realtime: 'query' } as const

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const calendar_calendars = newCollection('calendar_calendars', {
        omitOnInsert: ['created', 'updated'] as const,
        ...onDemand,
        collectionOptions: indexing,
    })

    const calendar_members = newCollection('calendar_members', {
        omitOnInsert: ['created', 'updated'] as const,
        ...onDemand,
        relations: { calendar: calendar_calendars, user: coreStores.users },
        collectionOptions: indexing,
    })

    const calendar_events = newCollection('calendar_events', {
        // recurrence_until is computed by a server hook (see
        // calendar/server/recurrence_until.go), so clients never write it.
        omitOnInsert: ['created', 'updated', 'recurrence_until'] as const,
        // Looked up by id from calendar_calendars / users, both on-demand
        // themselves — see useCalendarData. No `expand`: on-demand fetches
        // were carrying duplicate calendar_calendars + user rows per event.
        ...onDemand,
        collectionOptions: indexing,
    })

    return {
        calendar_calendars,
        calendar_members,
        calendar_events,
    }
}
