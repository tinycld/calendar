import { toDateString } from '../hooks/useCalendarNavigation'
import type { EventFormValues } from './event-schema'

interface FormSeedSource {
    event:
        | {
              title: string
              description: string
              location: string
              all_day: boolean
              recurrence: string
              calendar: string
              busy_status: EventFormValues['busy_status']
              visibility: EventFormValues['visibility']
              reminder: number
          }
        | undefined
    startDate: Date
    endDate: Date
    defaultCalendar: string
}

// The form's initial field values, for an edit (from the row) or a create
// (empty, in the resolved default calendar). Pure, so the caller can rebuild
// it only when something it reads has actually changed.
export function buildFormSeed({
    event,
    startDate,
    endDate,
    defaultCalendar,
}: FormSeedSource): EventFormValues {
    const dates = {
        startDate: toDateString(startDate),
        startTime: startDate.toTimeString().slice(0, 5),
        endDate: toDateString(endDate),
        endTime: endDate.toTimeString().slice(0, 5),
    }
    if (!event) {
        return {
            title: '',
            description: '',
            location: '',
            ...dates,
            all_day: false,
            recurrence: '',
            calendar: defaultCalendar,
            busy_status: 'busy',
            visibility: 'default',
            reminderMinutes: 30,
        }
    }
    return {
        title: event.title,
        description: event.description,
        location: event.location,
        ...dates,
        all_day: event.all_day,
        recurrence: event.recurrence,
        calendar: event.calendar,
        busy_status: event.busy_status,
        visibility: event.visibility,
        reminderMinutes: event.reminder,
    }
}
