import { and, eq, gte, inArray, lte, or } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useEffect, useMemo } from 'react'
import { expandRecurringEvents, parseEventId } from '../lib/recurrence'
import { useCalendarUIStore } from '../stores/calendar-ui-store'
import type { CalendarColorKey, CalendarEvents, CalendarWithGroup } from '../types'
import { type MembershipInfo, useCalendarData } from './useCalendarData'
import { SOURCE_PSEUDO_CALENDARS, useSourceEvents } from './useSourceEvents'

interface VisibleCalendarsState {
    calendars: CalendarWithGroup[]
    mineCalendars: CalendarWithGroup[]
    otherCalendars: CalendarWithGroup[]
    visibleIds: Set<string>
    toggleCalendar: (id: string) => void
    calendarMap: Map<string, CalendarWithGroup>
    membershipByCalendar: Map<string, MembershipInfo>
    setCalendarColor: (calendarId: string, color: CalendarColorKey) => void
    showOnlyCalendar: (calendarId: string) => void
    isLoading: boolean
}

export function useVisibleCalendars(): VisibleCalendarsState {
    const {
        calendars,
        mineCalendars,
        otherCalendars,
        calendarMap,
        membershipByCalendar,
        setCalendarColor,
        isLoading,
    } = useCalendarData()

    const visibleIdsArray = useCalendarUIStore(s => s.visibleIds)
    const toggleCalendar = useCalendarUIStore(s => s.toggleCalendar)
    const showOnlyCalendar = useCalendarUIStore(s => s.showOnlyCalendar)
    const initVisibleIds = useCalendarUIStore(s => s.initVisibleIds)

    useEffect(() => {
        if (visibleIdsArray.length === 0 && calendars.length > 0) {
            initVisibleIds(calendars.map(c => c.id))
        }
    }, [visibleIdsArray.length, calendars, initVisibleIds])

    const visibleIds = useMemo(() => new Set(visibleIdsArray), [visibleIdsArray])

    return {
        calendars,
        mineCalendars,
        otherCalendars,
        visibleIds,
        toggleCalendar,
        calendarMap,
        membershipByCalendar,
        setCalendarColor,
        showOnlyCalendar,
        isLoading,
    }
}

export function useCalendarMap(): Map<string, CalendarWithGroup> {
    const { calendarMap } = useVisibleCalendars()
    // Pseudo-calendars for contributed event sources ride the same map, so
    // every view's `calendarMap.get(event.calendar)` color lookup works
    // unchanged for source events. Real entries win a (never expected) key
    // collision because they are merged second.
    return useMemo(() => {
        if (SOURCE_PSEUDO_CALENDARS.size === 0) return calendarMap
        return new Map([...SOURCE_PSEUDO_CALENDARS, ...calendarMap])
    }, [calendarMap])
}

/**
 * Loads calendar events that could appear in [startDate, endDate] for the
 * user's currently visible calendars.
 *
 * The query is a single server-side filter:
 *   - calendar IN visibleIds            — narrows by sidebar selection
 *   - start <= rangeEnd                 — event seed must precede range end
 *   - recurrence_until empty OR ≥ rangeStart — recurrence either unbounded
 *                                          or still alive into the range
 *
 * recurrence_until is denormalized from the recurrence string by a server
 * hook (see calendar/server/recurrence_until.go). Empty for both
 * non-recurring rows and unbounded recurring rows; a tiny client-side pass
 * drops non-recurring rows that ended before the range starts.
 *
 * expandRecurringEvents then materializes occurrences inside
 * [startDate, endDate] for every recurring row in the result.
 */
export function useCalendarEvents(startDate: Date, endDate: Date) {
    const { visibleIds, isLoading: calendarsLoading } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')
    // Contributed source events merge in below. Independent of visibleIds by
    // design: hiding every native calendar must not hide the sources, and
    // source loading never blocks the grid's own isLoading.
    const sourceEvents = useSourceEvents(startDate, endDate)

    const visibleIdsArr = useMemo(() => [...visibleIds], [visibleIds])
    const rangeStartIso = useMemo(() => startDate.toISOString(), [startDate])
    const rangeEndIso = useMemo(() => endDate.toISOString(), [endDate])

    const { data: rawEvents, isLoading: eventsLoading } = useOrgLiveQuery(
        query => {
            if (visibleIdsArr.length === 0) return null
            return query
                .from({ evt: eventsCollection })
                .where(({ evt }) =>
                    and(
                        inArray(evt.calendar, visibleIdsArr),
                        lte(evt.start, rangeEndIso),
                        or(eq(evt.recurrence_until, ''), gte(evt.recurrence_until, rangeStartIso))
                    )
                )
        },
        [visibleIdsArr, rangeStartIso, rangeEndIso]
    )

    const events = useMemo(() => {
        const own = rawEvents ?? []
        // The server filter over-includes non-recurring events whose
        // recurrence_until is empty (the same condition admits open-ended
        // recurring events). Drop non-recurring rows that ended before the
        // range begins; recurring rows pass through to expandRecurringEvents.
        const inRange = own.filter(e => {
            if (e.recurrence) return true
            return new Date(e.end) > startDate
        })
        const expanded = expandRecurringEvents({
            events: inRange as CalendarEvents[],
            rangeStart: startDate,
            rangeEnd: endDate,
        })
        if (sourceEvents.length === 0) return expanded
        return [...expanded, ...sourceEvents].sort((a, b) => a.start.localeCompare(b.start))
    }, [rawEvents, sourceEvents, startDate, endDate])

    return { events, isLoading: calendarsLoading || eventsLoading }
}

export function useEventDetail(eventId: string | undefined): {
    event: CalendarEvents | undefined
    calendar: CalendarWithGroup | undefined
    occurrenceDate?: string
} {
    const { calendarMap } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')

    const { baseId, occurrenceDate } = parseEventId(eventId ?? '')

    const { data: events } = useOrgLiveQuery(
        query => {
            if (!baseId) return null
            return query.from({ evt: eventsCollection }).where(({ evt }) => eq(evt.id, baseId))
        },
        [baseId]
    )

    return useMemo(() => {
        if (!baseId || !events?.length) return { event: undefined, calendar: undefined }
        const event = events[0]
        const calendar = calendarMap.get(event.calendar)
        return { event, calendar, occurrenceDate }
    }, [baseId, events, calendarMap, occurrenceDate])
}
