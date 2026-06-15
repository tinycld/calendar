import { strict as assert } from 'node:assert'
import {
    MIN_DURATION_MINUTES,
    moveEvent,
    pxToDayDelta,
    pxToSnappedMinutes,
    resizeEnd,
} from './drag-math'

const HOUR_HEIGHT = 60

// Builds a same-day event on a fixed local date. Hours/minutes are local
// because the layout transform drag-math inverts reads local time-of-day.
function makeEvent(startHour: number, startMin: number, endHour: number, endMin: number) {
    const start = new Date(2026, 5, 14, startHour, startMin, 0, 0)
    const end = new Date(2026, 5, 14, endHour, endMin, 0, 0)
    return { start, end }
}

function minutesOfDay(d: Date): number {
    return d.getHours() * 60 + d.getMinutes()
}

// --- pxToSnappedMinutes ---

console.log('pxToSnappedMinutes')
console.log('  30px at 60px/hr → 30min')
assert.equal(pxToSnappedMinutes(30, HOUR_HEIGHT), 30)

console.log('  7px rounds down to 0')
assert.equal(pxToSnappedMinutes(7, HOUR_HEIGHT), 0)

console.log('  8px rounds up to 15')
assert.equal(pxToSnappedMinutes(8, HOUR_HEIGHT), 15)

console.log('  negative delta snaps negative')
assert.equal(pxToSnappedMinutes(-30, HOUR_HEIGHT), -30)

console.log('  zero hourHeight is a safe no-op')
assert.equal(pxToSnappedMinutes(50, 0), 0)

// --- pxToDayDelta ---

console.log('pxToDayDelta')
console.log('  1.5 columns rounds to 2')
assert.equal(pxToDayDelta(150, 100), 2)

console.log('  0.4 columns rounds to 0')
assert.equal(pxToDayDelta(40, 100), 0)

console.log('  negative crosses left')
assert.equal(pxToDayDelta(-160, 100), -2)

console.log('  half a column rounds toward +∞ (Math.round semantics)')
assert.equal(pxToDayDelta(-150, 100), -1)

console.log('  unknown column width is a no-op')
assert.equal(pxToDayDelta(150, 0), 0)

// --- resizeEnd ---

console.log('resizeEnd')
{
    console.log('  +30px extends the end by 30 minutes')
    const e = makeEvent(9, 0, 10, 0)
    const { end } = resizeEnd({ ...e, deltaPx: 30, hourHeight: HOUR_HEIGHT })
    assert.equal(minutesOfDay(end), 10 * 60 + 30)

    console.log('  dragging the end above the start clamps to min duration')
    const e2 = makeEvent(9, 0, 10, 0)
    const r2 = resizeEnd({ ...e2, deltaPx: -120, hourHeight: HOUR_HEIGHT })
    assert.equal(minutesOfDay(r2.end), 9 * 60 + MIN_DURATION_MINUTES)

    console.log('  end is clamped to the grid bottom (end of day)')
    const e3 = makeEvent(22, 0, 23, 0)
    const r3 = resizeEnd({
        ...e3,
        deltaPx: 180,
        hourHeight: HOUR_HEIGHT,
        dayEndMinutes: 24 * 60,
    })
    // Grid bottom = 1440 min = next-day midnight; assert by timestamp.
    const expectedEnd = new Date(2026, 5, 15, 0, 0, 0, 0)
    assert.equal(r3.end.getTime(), expectedEnd.getTime())
}

// --- moveEvent ---

console.log('moveEvent')
{
    console.log('  +60px shifts start and end by an hour, duration preserved')
    const e = makeEvent(9, 0, 10, 0)
    const { start, end } = moveEvent({ ...e, deltaPxY: 60, hourHeight: HOUR_HEIGHT })
    assert.equal(minutesOfDay(start), 10 * 60)
    assert.equal(minutesOfDay(end), 11 * 60)
    assert.equal(end.getTime() - start.getTime(), 60 * 60 * 1000)

    console.log('  dragging above the grid top clamps the start, keeps duration')
    const e2 = makeEvent(1, 0, 2, 0)
    const r2 = moveEvent({ ...e2, deltaPxY: -180, hourHeight: HOUR_HEIGHT, dayStartMinutes: 0 })
    assert.equal(minutesOfDay(r2.start), 0)
    assert.equal(r2.end.getTime() - r2.start.getTime(), 60 * 60 * 1000)

    console.log('  deltaDays shifts the calendar date, preserving time-of-day')
    const e3 = makeEvent(9, 0, 10, 30)
    const r3 = moveEvent({ ...e3, deltaPxY: 0, hourHeight: HOUR_HEIGHT, deltaDays: 1 })
    assert.equal(r3.start.getDate(), 15)
    assert.equal(minutesOfDay(r3.start), 9 * 60)
    assert.equal(minutesOfDay(r3.end), 10 * 60 + 30)
}

console.log('\nAll tests passed!')
