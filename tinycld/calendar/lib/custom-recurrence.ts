import { z } from '@tinycld/core/ui/form'
import { isoDateSchema } from './event-schema'
import { buildRRule, getWeekdayPosition, parseRRule, type RRuleOptions } from './recurrence'

export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

const baseSchema = z.object({
    freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.number().int().min(1, 'Repeat at least every 1').max(99, 'Repeat at most every 99'),
    byDay: z.array(z.string()),
    monthlyMode: z.enum(['dayOfMonth', 'dayOfWeek']),
})

// Every variant carries both end fields because the form keeps them all
// (switching "Ends" back and forth does not lose what was typed); only the
// picked end type's field is validated.
const endFields = { untilDate: z.string(), count: z.number() }

export const customRecurrenceSchema = z
    .discriminatedUnion('endType', [
        baseSchema.extend({ ...endFields, endType: z.literal('never') }),
        baseSchema.extend({ ...endFields, endType: z.literal('on'), untilDate: isoDateSchema }),
        baseSchema.extend({
            ...endFields,
            endType: z.literal('after'),
            count: z
                .number()
                .int()
                .min(1, 'End after at least 1 occurrence')
                .max(999, 'End after at most 999 occurrences'),
        }),
    ])
    .superRefine((values, ctx) => {
        if (values.freq === 'WEEKLY' && values.byDay.length === 0) {
            ctx.addIssue({ code: 'custom', path: ['byDay'], message: 'Pick at least one day' })
        }
    })

export type CustomRecurrence = z.output<typeof customRecurrenceSchema>

export interface CustomRecurrenceFormValues {
    freq: CustomRecurrence['freq']
    interval: number
    byDay: string[]
    endType: CustomRecurrence['endType']
    untilDate: string
    count: number
    monthlyMode: CustomRecurrence['monthlyMode']
}

function formatLocalDate(date: Date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

export function customRecurrenceDefaults(
    eventStartDate: Date,
    initialValue?: string
): CustomRecurrenceFormValues {
    const defaults: CustomRecurrenceFormValues = {
        freq: 'WEEKLY',
        interval: 1,
        byDay: [DAY_CODES[eventStartDate.getDay()]],
        endType: 'never',
        untilDate: '',
        count: 13,
        monthlyMode: 'dayOfMonth',
    }

    const parsed = initialValue ? parseRRule(initialValue) : null
    if (!parsed) return defaults

    const values: CustomRecurrenceFormValues = {
        ...defaults,
        freq: parsed.freq,
        interval: parsed.interval || 1,
    }

    if (parsed.byDay && parsed.byDay.length > 0) {
        if (parsed.freq === 'MONTHLY') {
            values.monthlyMode = 'dayOfWeek'
        } else {
            values.byDay = parsed.byDay
        }
    }

    if (parsed.count) {
        values.endType = 'after'
        values.count = parsed.count
    } else if (parsed.until) {
        values.endType = 'on'
        values.untilDate = formatLocalDate(parsed.until)
    }

    return values
}

function endOptions(values: CustomRecurrence): Pick<RRuleOptions, 'count' | 'until'> {
    switch (values.endType) {
        case 'after':
            return { count: values.count }
        case 'on':
            return { until: new Date(`${values.untilDate}T23:59:59`) }
        case 'never':
            return {}
    }
}

export function buildCustomRRule(values: CustomRecurrence, eventStartDate: Date): string {
    const options: RRuleOptions = {
        freq: values.freq,
        interval: values.interval,
        ...endOptions(values),
    }

    if (values.freq === 'WEEKLY') {
        options.byDay = values.byDay
    }

    if (values.freq === 'DAILY' && values.byDay.length > 0 && values.byDay.length < 7) {
        options.byDay = values.byDay
    }

    if (values.freq === 'MONTHLY') {
        if (values.monthlyMode === 'dayOfWeek') {
            const { position, day } = getWeekdayPosition(eventStartDate)
            options.byDay = [`${position}${day}`]
        } else {
            options.byMonthDay = [eventStartDate.getDate()]
        }
    }

    return buildRRule(options)
}
