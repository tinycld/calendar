// Pure pixel↔time math for drag-to-resize and drag-to-move in the time
// grid. No React / React Native imports so it stays trivially unit-testable
// (mirrors how drive isolates its drag logic in lib/dnd.ts).
//
// The forward transform that places an event block lives in layout.ts:
//   top    = ((startMinutes - startHour*60) / 60) * hourHeight
//   height = ((endMinutes - startMinutes)   / 60) * hourHeight
// using the Date's *local* hours/minutes. Everything here inverts that:
// a vertical pixel delta becomes a minute delta, snapped to a 15-minute
// grid, and a horizontal pixel delta becomes an integer day delta.

export const SNAP_MINUTES = 15
export const MIN_DURATION_MINUTES = 15

// Converts a vertical pixel delta into minutes, snapped to the nearest
// SNAP_MINUTES increment. A 60px hour means 30px → 30min → snapped 30.
export function pxToSnappedMinutes(deltaPx: number, hourHeight: number): number {
    if (hourHeight <= 0) return 0
    const rawMinutes = (deltaPx / hourHeight) * 60
    return Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES
}

// Converts a horizontal pixel delta into an integer number of day columns.
// Returns 0 when the column width is unknown (0 before onLayout settles) so
// day-move degrades to a no-op rather than jumping wildly.
export function pxToDayDelta(deltaPx: number, columnWidth: number): number {
    if (columnWidth <= 0) return 0
    return Math.round(deltaPx / columnWidth)
}

function localMinutes(d: Date): number {
    return d.getHours() * 60 + d.getMinutes()
}

// Returns a Date on the same calendar day as `base` at `minutes` past local
// midnight. Uses millisecond arithmetic off local midnight rather than
// setHours so a value of 1440 (the grid bottom = end of day) lands at exactly
// 24:00 — i.e. 00:00 the next day — instead of being silently wrapped.
function withLocalMinutes(base: Date, minutes: number): Date {
    const midnight = new Date(base)
    midnight.setHours(0, 0, 0, 0)
    return new Date(midnight.getTime() + minutes * 60000)
}

export interface ResizeArgs {
    start: Date
    end: Date
    deltaPx: number
    hourHeight: number
    // Minute-of-day the grid stops at, e.g. (endHour + 1) * 60. When set the
    // new end is clamped so it can't extend past the bottom of the grid.
    dayEndMinutes?: number
}

// Resize from the bottom edge: only the end moves. The new end is clamped so
// the event keeps at least MIN_DURATION_MINUTES and never passes the grid
// bottom. Start is never touched.
export function resizeEnd({ start, end, deltaPx, hourHeight, dayEndMinutes }: ResizeArgs): {
    end: Date
} {
    const deltaMinutes = pxToSnappedMinutes(deltaPx, hourHeight)
    const startMin = localMinutes(start)
    let endMin = localMinutes(end) + deltaMinutes
    const minEnd = startMin + MIN_DURATION_MINUTES
    if (endMin < minEnd) endMin = minEnd
    if (dayEndMinutes != null && endMin > dayEndMinutes) endMin = dayEndMinutes
    return { end: withLocalMinutes(end, endMin) }
}

export interface MoveArgs {
    start: Date
    end: Date
    deltaPxY: number
    hourHeight: number
    // Integer column delta (already derived via pxToDayDelta). Shifts the
    // calendar date while preserving time-of-day. Omit / 0 for day view.
    deltaDays?: number
    // Minute-of-day bounds of the grid; the moved start is clamped to keep
    // the event inside the visible day while preserving its duration.
    dayStartMinutes?: number
    dayEndMinutes?: number
}

// Move the whole event: time shifts by the snapped vertical delta and the
// date shifts by deltaDays. Duration is preserved — only start is computed,
// end follows by the original duration. The start time-of-day is clamped to
// [dayStartMinutes, dayEndMinutes - duration] so the block stays on-grid.
export function moveEvent({
    start,
    end,
    deltaPxY,
    hourHeight,
    deltaDays = 0,
    dayStartMinutes,
    dayEndMinutes,
}: MoveArgs): { start: Date; end: Date } {
    const durationMs = end.getTime() - start.getTime()
    const durationMinutes = Math.round(durationMs / 60000)
    const deltaMinutes = pxToSnappedMinutes(deltaPxY, hourHeight)

    let startMin = localMinutes(start) + deltaMinutes
    if (dayStartMinutes != null && startMin < dayStartMinutes) startMin = dayStartMinutes
    if (dayEndMinutes != null) {
        const latestStart = dayEndMinutes - durationMinutes
        if (startMin > latestStart) startMin = latestStart
    }

    const newStart = withLocalMinutes(start, startMin)
    if (deltaDays !== 0) newStart.setDate(newStart.getDate() + deltaDays)
    const newEnd = new Date(newStart.getTime() + durationMs)
    return { start: newStart, end: newEnd }
}
