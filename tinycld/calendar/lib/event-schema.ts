import { z } from '@tinycld/core/ui/form'

const DATE_FIELDS = ['startDate', 'startTime', 'endDate', 'endTime'] as const

// A YYYY-MM-DD string naming a real calendar day. The regex alone lets
// 2026-02-30 through, and JS Date rolls it over to March instead of failing.
export function isRealIsoDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false
    const [, year, month, day] = match.map(Number)
    const date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export const isoDateSchema = z.string().refine(isRealIsoDate, 'Use YYYY-MM-DD format')

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM format')

type DateRange = {
    all_day: boolean
    startDate: string
    startTime: string
    endDate: string
    endTime: string
}

function toTime(date: string, time: string) {
    return new Date(`${date}T${time}:00`).getTime()
}

// All-day events store an inclusive end day (a one-day event starts and ends
// on the same date), so only the dates are compared. Timed events may be
// zero-length (an imported reminder), so only an end before the start fails.
function checkEndNotBeforeStart(values: DateRange, ctx: z.RefinementCtx) {
    if (values.all_day) {
        if (values.endDate < values.startDate) {
            ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End must be after start' })
        }
        return
    }
    if (toTime(values.endDate, values.endTime) < toTime(values.startDate, values.startTime)) {
        ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End must be after start' })
    }
}

export const eventSchema = z
    .object({
        title: z.string().trim().min(1, 'Title is required'),
        description: z.string(),
        location: z.string().trim(),
        startDate: isoDateSchema,
        startTime: timeSchema,
        endDate: isoDateSchema,
        endTime: timeSchema,
        all_day: z.boolean(),
        recurrence: z.string(),
        calendar: z.string().min(1, 'Choose a calendar'),
        busy_status: z.enum(['busy', 'free']),
        visibility: z.enum(['default', 'public', 'private']),
        reminderMinutes: z.number(),
    })
    .superRefine(checkEndNotBeforeStart, {
        // Run as soon as the date/time fields parse, so an empty title does
        // not hide a backwards range.
        when: ({ issues }) =>
            !issues.some(issue => DATE_FIELDS.some(field => issue.path?.[0] === field)),
    })

export type EventFormValues = z.infer<typeof eventSchema>
