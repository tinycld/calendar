import { eq } from '@tanstack/db'
import { useEffect, useMemo } from 'react'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { expandRecurringEvents, parseEventId } from '../lib/recurrence'
import { useCalendarUIStore } from '../stores/calendar-ui-store'
import type { CalendarColorKey, CalendarEvents, CalendarWithGroup } from '../types'
import { type MembershipInfo, useCalendarData } from './useCalendarData'

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
    const { calendars, mineCalendars, otherCalendars, calendarMap, membershipByCalendar, setCalendarColor, isLoading } =
        useCalendarData()

    const visibleIdsArray = useCalendarUIStore((s) => s.visibleIds)
    const toggleCalendar = useCalendarUIStore((s) => s.toggleCalendar)
    const showOnlyCalendar = useCalendarUIStore((s) => s.showOnlyCalendar)
    const initVisibleIds = useCalendarUIStore((s) => s.initVisibleIds)

    useEffect(() => {
        if (visibleIdsArray.length === 0 && calendars.length > 0) {
            initVisibleIds(calendars.map((c) => c.id))
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
    return useVisibleCalendars().calendarMap
}

export function useCalendarEvents(startDate: Date, endDate: Date) {
    const { visibleIds } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')
    const [calendarsCollection] = useStore('calendar_calendars')

    const { data: allEvents } = useOrgLiveQuery((query, { orgId }) =>
        query
            .from({ evt: eventsCollection })
            .join({ cal: calendarsCollection }, ({ evt, cal }) => eq(evt.calendar, cal.id))
            .where(({ cal }) => eq(cal.org, orgId))
            .select(({ evt }) => evt)
    )

    return useMemo(() => {
        if (!allEvents) return []
        const visible = allEvents.filter((e) => visibleIds.has(e.calendar))
        return expandRecurringEvents({
            events: visible,
            rangeStart: startDate,
            rangeEnd: endDate,
        })
    }, [allEvents, startDate, endDate, visibleIds])
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
        (query) => query.from({ evt: eventsCollection }).where(({ evt }) => eq(evt.id, baseId)),
        [baseId]
    )

    return useMemo(() => {
        if (!baseId || !events?.length) return { event: undefined, calendar: undefined }
        const event = events[0]
        const calendar = calendarMap.get(event.calendar)
        return { event, calendar, occurrenceDate }
    }, [baseId, events, calendarMap, occurrenceDate])
}
