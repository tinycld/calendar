import { readableTextColor } from '@tinycld/core/lib/color-utils'

// Calendars store a raw hex colour, like labels and calc cells, rather than a
// name from a fixed palette. CalDAV is why: a client sets calendar-color to an
// arbitrary hex (macOS Calendar sends #RRGGBBAA), and a named palette could only
// snap it to the nearest entry — the user picks orange and the calendar comes
// back red. Hex also means the server needs no copy of the palette to map
// between the two representations.
export const DEFAULT_CALENDAR_COLOR = '#3b82f6'

// The swatches the in-app picker offers. A colour from anywhere else (a CalDAV
// client, a subscription feed) is still stored and rendered as-is; this list
// only seeds the picker.
export const CALENDAR_COLOR_SWATCHES: readonly string[] = [
    '#D50000',
    '#E67C73',
    '#F4511E',
    '#E4C441',
    '#33B679',
    '#0B8043',
    '#039BE5',
    '#3F51B5',
    '#7986CB',
    '#8E24AA',
    '#616161',
    '#3b82f6',
    '#22c55e',
    '#ef4444',
    '#14b8a6',
    '#a855f7',
    '#f97316',
]

const HEX = /^#[0-9a-fA-F]{6}$/

// Normalises what a row actually holds into a renderable hex. Rows predating
// the move to hex carry a palette name, and a CalDAV client may send 8-digit
// #RRGGBBAA; both resolve to the default rather than rendering as nothing.
export function normalizeCalendarColor(color: string | undefined | null): string {
    if (!color) return DEFAULT_CALENDAR_COLOR
    const trimmed = color.trim()
    if (HEX.test(trimmed)) return trimmed
    // #RRGGBBAA — drop the alpha, which we have nowhere to store.
    if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed.slice(0, 7)
    return DEFAULT_CALENDAR_COLOR
}

export function getCalendarColor(color: string | undefined | null) {
    const bg = normalizeCalendarColor(color)
    // Derived rather than always-white: white on a pale swatch (banana) is
    // unreadable, and now that any hex can arrive the contrast has to be
    // computed instead of assumed.
    return { bg, text: readableTextColor(bg) }
}

export function getCalendarColorResolved(color: string | undefined | null) {
    return getCalendarColor(color)
}
