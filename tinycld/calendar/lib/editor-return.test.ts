import { describe, expect, it } from 'vitest'
import { calendarReturnParams, eventEditorParams } from '~/tinycld/calendar/lib/editor-return'

describe('eventEditorParams', () => {
    it('carries the calendar view and date alongside the id', () => {
        expect(eventEditorParams('new', { view: 'month', date: '2026-08-04' })).toEqual({
            id: 'new',
            view: 'month',
            date: '2026-08-04',
        })
    })

    it('omits absent members rather than passing them as blanks', () => {
        expect(eventEditorParams('new', {})).toEqual({ id: 'new' })
        expect(eventEditorParams('new', { view: 'day' })).toEqual({ id: 'new', view: 'day' })
        expect(eventEditorParams('new', { date: '2026-08-04' })).toEqual({
            id: 'new',
            date: '2026-08-04',
        })
    })
})

describe('calendarReturnParams', () => {
    it('round-trips the pair the editor was pushed with', () => {
        const pushed = eventEditorParams('new', { view: 'month', date: '2026-08-04' })
        // The editor reads its own URL params, so the return is built from the
        // same names the push wrote.
        expect(calendarReturnParams({ view: pushed.view, date: pushed.date })).toEqual({
            view: 'month',
            date: '2026-08-04',
        })
    })

    it('returns nothing when the editor was pushed without them', () => {
        expect(calendarReturnParams({})).toEqual({})
    })
})
