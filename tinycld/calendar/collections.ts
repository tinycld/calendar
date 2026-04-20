import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { CalendarSchema } from './types'

type MergedSchema = Schema & CalendarSchema

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const calendar_calendars = newCollection('calendar_calendars', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const calendar_members = newCollection('calendar_members', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { calendar: calendar_calendars, user_org: coreStores.user_org },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    const calendar_events = newCollection('calendar_events', {
        omitOnInsert: ['created', 'updated'] as const,
        expand: { calendar: calendar_calendars, created_by: coreStores.user_org },
        collectionOptions: {
            autoIndex: 'eager' as const,
            defaultIndexType: BasicIndex,
        },
    })

    return {
        calendar_calendars,
        calendar_members,
        calendar_events,
    }
}
