import { describe, expect, it } from 'vitest'
import { buildFormSeed } from './event-form-seed'

describe('buildFormSeed', () => {
    it('reads the date in local time, the same zone the time fields use', () => {
        // A late-evening local time is already the next day in UTC for any
        // zone west of UTC, which used to put the wrong date in the form.
        const startDate = new Date(2026, 9, 13, 23, 30)
        const endDate = new Date(2026, 9, 13, 23, 45)
        const seed = buildFormSeed({ event: undefined, startDate, endDate, defaultCalendar: 'c1' })
        expect(seed.startDate).toBe('2026-10-13')
        expect(seed.startTime).toBe('23:30')
        expect(seed.endDate).toBe('2026-10-13')
        expect(seed.endTime).toBe('23:45')
    })

    it('starts a new event in the default calendar', () => {
        const now = new Date(2026, 0, 1, 9, 0)
        const seed = buildFormSeed({
            event: undefined,
            startDate: now,
            endDate: now,
            defaultCalendar: 'c1',
        })
        expect(seed.calendar).toBe('c1')
        expect(seed.title).toBe('')
    })
})
