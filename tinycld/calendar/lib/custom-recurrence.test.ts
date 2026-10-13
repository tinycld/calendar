import { describe, expect, it } from 'vitest'
import {
    buildCustomRRule,
    type CustomRecurrenceFormValues,
    customRecurrenceDefaults,
    customRecurrenceSchema,
} from '~/tinycld/calendar/lib/custom-recurrence'

// A Tuesday, the second one of the month.
const start = new Date(2026, 9, 13, 9, 0)

const base: CustomRecurrenceFormValues = {
    freq: 'WEEKLY',
    interval: 1,
    byDay: ['TU'],
    endType: 'never',
    untilDate: '',
    count: 13,
    monthlyMode: 'dayOfMonth',
}

function issuePaths(input: CustomRecurrenceFormValues) {
    const result = customRecurrenceSchema.safeParse(input)
    return result.success ? [] : result.error.issues.map(issue => issue.path.join('.'))
}

describe('customRecurrenceSchema', () => {
    it('accepts the defaults', () => {
        expect(issuePaths(customRecurrenceDefaults(start))).toEqual([])
    })

    it('bounds the interval to a whole number from 1 to 99', () => {
        expect(issuePaths({ ...base, interval: 0 })).toEqual(['interval'])
        expect(issuePaths({ ...base, interval: 100 })).toEqual(['interval'])
        expect(issuePaths({ ...base, interval: 1.5 })).toEqual(['interval'])
        expect(issuePaths({ ...base, interval: 99 })).toEqual([])
    })

    it('needs at least one day for a weekly rule', () => {
        expect(issuePaths({ ...base, byDay: [] })).toEqual(['byDay'])
        expect(issuePaths({ ...base, freq: 'MONTHLY', byDay: [] })).toEqual([])
    })

    it('validates the end date only when ending on a date', () => {
        expect(issuePaths({ ...base, untilDate: 'garbage' })).toEqual([])
        expect(issuePaths({ ...base, endType: 'on', untilDate: '' })).toEqual(['untilDate'])
        expect(issuePaths({ ...base, endType: 'on', untilDate: 'next friday' })).toEqual([
            'untilDate',
        ])
        expect(issuePaths({ ...base, endType: 'on', untilDate: '2026-02-30' })).toEqual([
            'untilDate',
        ])
        expect(issuePaths({ ...base, endType: 'on', untilDate: '2026-12-31' })).toEqual([])
    })

    it('bounds the count only when ending after a number of occurrences', () => {
        expect(issuePaths({ ...base, count: 0 })).toEqual([])
        expect(issuePaths({ ...base, endType: 'after', count: 0 })).toEqual(['count'])
        expect(issuePaths({ ...base, endType: 'after', count: 1000 })).toEqual(['count'])
        expect(issuePaths({ ...base, endType: 'after', count: 999 })).toEqual([])
    })
})

describe('buildCustomRRule', () => {
    const build = (values: CustomRecurrenceFormValues) =>
        buildCustomRRule(customRecurrenceSchema.parse(values), start)

    it('builds a weekly rule with its days', () => {
        expect(build({ ...base, interval: 2, byDay: ['TU', 'TH'] })).toBe(
            'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH'
        )
    })

    it('ends on the picked date', () => {
        expect(build({ ...base, endType: 'on', untilDate: '2026-12-31' })).toBe(
            'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z'
        )
    })

    it('ends after the picked count and ignores a stale end date', () => {
        expect(build({ ...base, endType: 'after', count: 5, untilDate: 'garbage' })).toBe(
            'FREQ=WEEKLY;BYDAY=TU;COUNT=5'
        )
    })

    it('builds a monthly rule by day of month or weekday position', () => {
        expect(build({ ...base, freq: 'MONTHLY' })).toBe('FREQ=MONTHLY;BYMONTHDAY=13')
        expect(build({ ...base, freq: 'MONTHLY', monthlyMode: 'dayOfWeek' })).toBe(
            'FREQ=MONTHLY;BYDAY=2TU'
        )
    })
})

describe('customRecurrenceDefaults', () => {
    it('starts weekly on the event weekday', () => {
        expect(customRecurrenceDefaults(start)).toEqual(base)
    })

    it('loads an existing rule', () => {
        expect(
            customRecurrenceDefaults(start, 'FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,WE;COUNT=4')
        ).toEqual({ ...base, interval: 3, byDay: ['MO', 'WE'], endType: 'after', count: 4 })
        expect(customRecurrenceDefaults(start, 'FREQ=DAILY;UNTIL=20261231T235959Z')).toMatchObject({
            freq: 'DAILY',
            endType: 'on',
            untilDate: '2026-12-31',
        })
    })
})
