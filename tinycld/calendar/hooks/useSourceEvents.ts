import { packageEventSources } from '@tinycld/core/lib/event-sources/registry'
import type { Href } from 'expo-router'
import { useEffect, useMemo } from 'react'
import { CALENDAR_COLOR_KEYS } from '../components/calendar-colors'
import { parseSourceEventId, sourceCalendarId, sourceEventId } from '../lib/event-source-ids'
import { useEventSourcesStore } from '../stores/event-sources-store'
import type { CalendarColorKey, CalendarEvents, CalendarWithGroup } from '../types'

export const CALENDAR_EVENT_SOURCES = packageEventSources.calendar ?? []

/**
 * Contributed items rendered as CalendarEvents rows for [startDate, endDate].
 *
 * Publishing the range is a deliberate useEffect: the collectors
 * (EventSourcesHost) live OUTSIDE the view's render tree, so the range has to
 * cross component boundaries through the store — there is nothing to fetch
 * and no cached value, just a handshake. Items come back through the same
 * store one render later; they arrive via async live query anyway, so the
 * lag is invisible.
 */
export function useSourceEvents(startDate: Date, endDate: Date): CalendarEvents[] {
    const setRange = useEventSourcesStore(s => s.setRange)
    const itemsBySource = useEventSourcesStore(s => s.itemsBySource)
    const hiddenSourceIds = useEventSourcesStore(s => s.hiddenSourceIds)

    const startIso = useMemo(() => startDate.toISOString(), [startDate])
    const endIso = useMemo(() => endDate.toISOString(), [endDate])

    useEffect(() => {
        setRange(startIso, endIso)
    }, [setRange, startIso, endIso])

    return useMemo(() => {
        const out: CalendarEvents[] = []
        for (const [sourceId, items] of Object.entries(itemsBySource)) {
            if (hiddenSourceIds.includes(sourceId)) continue
            for (const item of items) {
                // Collectors already query per range, but the store can hold a
                // stale range for a render after fast navigation — clip rather
                // than hand the layout out-of-range rows.
                if (item.end < startIso || item.start > endIso) continue
                out.push(toCalendarEvent(sourceId, item))
            }
        }
        return out
    }, [itemsBySource, hiddenSourceIds, startIso, endIso])
}

interface SourceItemLike {
    id: string
    title: string
    start: string
    end: string
    allDay: boolean
    href: Href
}

function toCalendarEvent(sourceId: string, item: SourceItemLike): CalendarEvents {
    return {
        id: sourceEventId(sourceId, item.id),
        calendar: sourceCalendarId(sourceId),
        created_by: '',
        title: item.title,
        description: '',
        location: '',
        start: item.start,
        end: item.end,
        all_day: item.allDay,
        recurrence: '',
        recurrence_until: '',
        guests: [],
        reminder: 0,
        busy_status: 'free',
        visibility: 'default',
        ical_uid: '',
        from_subscription: false,
        created: '',
        updated: '',
    }
}

/**
 * Where a contributed event's press should navigate, or null when the id is
 * not a source event (the caller falls through to the detail popover). Not a
 * hook — it runs inside a press handler, reading current store state.
 */
export function sourceEventHref(eventId: string): Href | null {
    const parsed = parseSourceEventId(eventId)
    if (!parsed) return null
    const items = useEventSourcesStore.getState().itemsBySource[parsed.sourceId]
    return items?.find(i => i.id === parsed.itemId)?.href ?? null
}

function sourceColor(color: string | undefined): CalendarColorKey {
    return color && (CALENDAR_COLOR_KEYS as string[]).includes(color)
        ? (color as CalendarColorKey)
        : 'graphite'
}

/**
 * One pseudo CalendarWithGroup per registered source, keyed by its synthetic
 * calendar id. Merged over useCalendarMap's real entries so every view's
 * existing `calendarMap.get(event.calendar)` color lookup works unchanged for
 * contributed events. Static per process — the registry is generated code.
 */
export const SOURCE_PSEUDO_CALENDARS: ReadonlyMap<string, CalendarWithGroup> = new Map(
    CALENDAR_EVENT_SOURCES.map(source => [
        sourceCalendarId(source.id),
        {
            id: sourceCalendarId(source.id),
            name: source.label,
            description: '',
            color: sourceColor(source.color),
            subscription_url: '',
            subscription_last_sync: '',
            subscription_error: '',
            created: '',
            updated: '',
            group: 'other' as const,
        },
    ])
)
