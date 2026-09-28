/**
 * The calendar keeps its view mode and focused date in the URL query
 * (`?view=month&date=2026-08-04`). The event editor is a separate route, so
 * those params do not follow it: `useGlobalSearchParams` on the editor reads
 * the editor's own URL, where they are absent, and a return href built from
 * them lands on the calendar's defaults — Week view at today, nowhere near the
 * event the user just made.
 *
 * So every create entry point passes the calendar's current view/date INTO the
 * editor push, and the editor reflects the same pair back out on `afterCreate`.
 * Both directions go through the builders here, so the param names cannot drift
 * apart between the push and the return.
 */

export interface CalendarUrlState {
    view?: string
    date?: string
}

/**
 * Query params for a push to `calendar/[id]`, carrying the calendar's current
 * URL state alongside the event id.
 *
 * Absent members are omitted rather than passed as `undefined`, so a push from
 * a calendar with no explicit view/date produces a bare `{ id }` and the
 * calendar keeps its own defaults on the way back.
 */
export function eventEditorParams(id: string, state: CalendarUrlState): Record<string, string> {
    return { id, ...calendarReturnParams(state) }
}

/**
 * Query params for the return href to the calendar. Built from whatever the
 * editor received; an absent member is omitted, never blanked.
 */
export function calendarReturnParams(state: CalendarUrlState): Record<string, string> {
    return {
        ...(state.view ? { view: state.view } : {}),
        ...(state.date ? { date: state.date } : {}),
    }
}
