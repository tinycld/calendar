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

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const calendar_calendars = newCollection('calendar_calendars', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexing,
    })

    const calendar_members = newCollection('calendar_members', {
        omitOnInsert: ['created', 'updated'] as const,
        relations: { calendar: calendar_calendars, user: coreStores.users },
        collectionOptions: indexing,
    })

    const calendar_events = newCollection('calendar_events', {
        // recurrence_until is computed by a server hook (see
        // calendar/server/recurrence_until.go), so clients never write it.
        omitOnInsert: ['created', 'updated', 'recurrence_until'] as const,
        // No `expand`: on-demand fetches were carrying duplicate
        // calendar_calendars + user rows per event. Both relations
        // are already loaded eagerly (calendar_calendars, users), so
        // consumers look them up by id locally — see useCalendarData.
        syncMode: 'on-demand' as const,
        collectionOptions: indexing,
    })

    return {
        calendar_calendars,
        calendar_members,
        calendar_events,
    }
}
