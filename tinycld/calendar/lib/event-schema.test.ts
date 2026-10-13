import { describe, expect, it } from 'vitest'
import { eventSchema, isRealIsoDate } from '~/tinycld/calendar/lib/event-schema'

const valid = {
    title: 'Standup',
    description: '',
    location: '',
    startDate: '2026-10-13',
    startTime: '09:00',
    endDate: '2026-10-13',
    endTime: '09:30',
    all_day: false,
    recurrence: '',
    calendar: 'cal1',
    busy_status: 'busy' as const,
    visibility: 'default' as const,
    reminderMinutes: 30,
}

function issuePaths(input: unknown) {
    const result = eventSchema.safeParse(input)
    return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))
}

describe('eventSchema', () => {
    it('accepts a valid event and trims the title', () => {
        const result = eventSchema.parse({ ...valid, title: '  Standup  ' })
        expect(result.title).toBe('Standup')
    })

    it('rejects a whitespace-only title', () => {
        expect(issuePaths({ ...valid, title: '   ' })).toEqual(['title'])
    })

    it('requires a calendar', () => {
        const result = eventSchema.safeParse({ ...valid, calendar: '' })
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.message).toBe('Choose a calendar')
    })

    it('rejects dates and times that do not exist', () => {
        expect(issuePaths({ ...valid, startDate: '2026-02-30' })).toEqual(['startDate'])
        expect(issuePaths({ ...valid, endDate: '2026-13-01' })).toEqual(['endDate'])
        expect(issuePaths({ ...valid, startTime: '24:00' })).toEqual(['startTime'])
        expect(issuePaths({ ...valid, endTime: '09:60' })).toEqual(['endTime'])
    })

    it('rejects a timed event that ends before it starts', () => {
        expect(issuePaths({ ...valid, endTime: '08:59' })).toEqual(['endTime'])
        expect(issuePaths({ ...valid, endDate: '2026-10-12', endTime: '23:00' })).toEqual([
            'endTime',
        ])
    })

    it('accepts a zero-length timed event', () => {
        expect(issuePaths({ ...valid, endTime: '09:00' })).toEqual([])
    })

    it('compares only the dates of an all-day event', () => {
        const allDay = { ...valid, all_day: true, startTime: '15:00', endTime: '10:00' }
        expect(issuePaths(allDay)).toEqual([])
        expect(issuePaths({ ...allDay, endDate: '2026-10-12' })).toEqual(['endDate'])
    })

    it('reports a backwards range even when the title is empty', () => {
        expect(issuePaths({ ...valid, title: '', endTime: '08:00' })).toEqual(['title', 'endTime'])
    })

    it('skips the range rule while a date field does not parse', () => {
        expect(issuePaths({ ...valid, endDate: 'tomorrow' })).toEqual(['endDate'])
    })
})

describe('isRealIsoDate', () => {
    it('accepts real days, including a leap day', () => {
        expect(isRealIsoDate('2026-10-13')).toBe(true)
        expect(isRealIsoDate('2028-02-29')).toBe(true)
    })

    it('rejects malformed text and days that roll over', () => {
        expect(isRealIsoDate('2026-1-13')).toBe(false)
        expect(isRealIsoDate('2027-02-29')).toBe(false)
        expect(isRealIsoDate('2026-04-31')).toBe(false)
        expect(isRealIsoDate('next week')).toBe(false)
    })
})
