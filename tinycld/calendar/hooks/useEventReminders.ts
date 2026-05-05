import {
    cancelAllNotifications,
    requestNotificationPermission,
    scheduleNotification,
} from '@tinycld/core/lib/notifications'
import { useEffect, useMemo, useRef } from 'react'
import type { CalendarEvents } from '../types'
import { useCalendarEvents, useVisibleCalendars } from './useCalendarEvents'

/** How far ahead to look for upcoming events to schedule reminders */
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000 // 24 hours

function getReminderTime(event: CalendarEvents): number | null {
    if (!event.reminder || event.reminder <= 0) return null
    const eventStart = new Date(event.start).getTime()
    return eventStart - event.reminder * 60 * 1000
}

function isInWindow(reminderTime: number, now: number, end: number) {
    return reminderTime > now && reminderTime <= end
}

async function scheduleEventReminders(events: CalendarEvents[], alreadyScheduled: Set<string>) {
    const now = Date.now()
    const lookaheadEnd = now + LOOKAHEAD_MS
    const nextScheduled = new Set<string>()

    for (const event of events) {
        const reminderTime = getReminderTime(event)
        if (!reminderTime || !isInWindow(reminderTime, now, lookaheadEnd)) continue

        const identifier = `cal-reminder-${event.id}`
        nextScheduled.add(identifier)
        if (alreadyScheduled.has(identifier)) continue

        await scheduleNotification({
            title: event.title,
            body: `Starts in ${event.reminder} minutes`,
            identifier,
            triggerAt: new Date(reminderTime),
            data: { eventId: event.id },
        })
    }

    return nextScheduled
}

/**
 * Watches calendar events and schedules OS-level notifications
 * for events that have a reminder value > 0.
 *
 * Should be mounted once in the calendar provider. Backed by the same
 * scoped useCalendarEvents query that drives the visible views — passes
 * a forward 24h window so the server filter caps the result set.
 */
export function useEventReminders() {
    const { visibleIds } = useVisibleCalendars()

    // Forward 24h window. Computed once per render via useMemo against
    // a quantized "now" so the date params are stable across reruns
    // unless an actual minute boundary moves.
    //
    // The interval below polls every 5 min, which forces a fresh window
    // and pulls in events newly entering the lookahead.
    const [windowStart, windowEnd] = useMemo(() => {
        const now = new Date()
        // Round down to the nearest minute so memo identity is stable
        // across the second-level renders react can trigger.
        now.setSeconds(0, 0)
        const end = new Date(now.getTime() + LOOKAHEAD_MS)
        return [now, end] as const
    }, [])

    const { events: occurrences } = useCalendarEvents(windowStart, windowEnd)

    const scheduledRef = useRef(new Set<string>())

    useEffect(() => {
        if (occurrences.length === 0 && visibleIds.size === 0) return
        let cancelled = false

        async function run() {
            const granted = await requestNotificationPermission()
            if (!granted || cancelled) return
            scheduledRef.current = await scheduleEventReminders(occurrences, scheduledRef.current)
        }

        run()

        // Re-check every 5 minutes to pick up events entering the lookahead
        // window (e.g. a meeting newly scheduled with a 90-min reminder
        // becomes due 90 minutes before its start).
        const interval = setInterval(run, 5 * 60 * 1000)

        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [occurrences, visibleIds])

    // Clean up all scheduled notifications on unmount
    useEffect(() => {
        return () => {
            cancelAllNotifications()
        }
    }, [])
}
