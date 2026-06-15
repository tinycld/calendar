// Drag-to-resize and drag-to-move wiring for a single time-grid event.
//
// One instance lives inside each EventBlock (useDragGesture is a hook and so
// can't be called inside the column .map()). It builds two gestures — a body
// gesture that moves the event in time (and, in week view, across days) and a
// bottom-edge handle gesture that resizes the end. Both follow calc's
// draft-then-commit contract (see use-column-resize.ts): a dragRef mirror so
// the platform handlers read live state without re-binding, an optimistic
// preview pushed to the drag store on every move, and a single DB write on
// release. The useOrgLiveQuery then reconciles the final position.

import { captureException } from '@tinycld/core/lib/errors'
import type { DragContext, DragGestureHandlers } from '@tinycld/core/lib/gestures'
import { useDragGesture } from '@tinycld/core/lib/gestures'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCallback, useRef } from 'react'
import { moveEvent, pxToDayDelta, resizeEnd } from '../lib/drag-math'
import { parseEventId } from '../lib/recurrence'
import { type DragMode, useCalendarDragStore } from '../stores/calendar-drag-store'

// Forward transform constants must match layout.ts / TimeGrid.
function minutesToTop(minutes: number, startHour: number, hourHeight: number): number {
    return ((minutes - startHour * 60) / 60) * hourHeight
}

function localMinutes(d: Date): number {
    return d.getHours() * 60 + d.getMinutes()
}

export interface EventDragGeometry {
    start: Date
    end: Date
    // Pixel layout the block currently renders at (from layoutTimedEvents).
    top: number
    height: number
    // Horizontal slot within the day column (percent), so the ghost keeps the
    // event's column position as it moves.
    left: number
    width: number
}

// Static appearance the floating ghost paints with, copied from the origin
// block so the ghost looks identical to the event being dragged.
export interface EventDragVisual {
    title: string
    timeLabel: string
    bgColor: string
    textColor: string
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export interface UseEventDragOptions {
    eventId: string
    startHour: number
    endHour: number
    hourHeight: number
    // Reads the live measured day-column width. A getter (not a snapshot)
    // because the width is filled in by onLayout *after* the first render and
    // that ref mutation doesn't re-render — a prop snapshot would still be 0 at
    // drag time and freeze day-move. Returns 0 to disable day-move (day view,
    // or before onLayout settles).
    getColumnWidth: () => number
    // This block's day column (0-based) and the total number of columns in the
    // grid, so a horizontal drag can resolve and clamp a target column.
    columnIndex: number
    columnCount: number
    disabled: boolean
    // The block's current start/end/layout, read live on drag-start.
    geometry: EventDragGeometry
    // Appearance the floating ghost copies.
    visual: EventDragVisual
}

export interface UseEventDragResult {
    bodyHandlers: DragGestureHandlers
    handleHandlers: DragGestureHandlers
}

interface DragSnapshot {
    mode: DragMode
    start: Date
    end: Date
}

export function useEventDrag({
    eventId,
    startHour,
    endHour,
    hourHeight,
    getColumnWidth,
    columnIndex,
    columnCount,
    disabled,
    geometry,
    visual,
}: UseEventDragOptions): UseEventDragResult {
    const [eventsCollection] = useStore('calendar_events')
    const begin = useCalendarDragStore(s => s.begin)
    const update = useCalendarDragStore(s => s.update)
    const end = useCalendarDragStore(s => s.end)

    // Live mirrors so the gesture closures never go stale between renders.
    const geometryRef = useRef(geometry)
    geometryRef.current = geometry
    const getColumnWidthRef = useRef(getColumnWidth)
    getColumnWidthRef.current = getColumnWidth
    const columnIndexRef = useRef(columnIndex)
    columnIndexRef.current = columnIndex
    const columnCountRef = useRef(columnCount)
    columnCountRef.current = columnCount
    const visualRef = useRef(visual)
    visualRef.current = visual

    const snapshotRef = useRef<DragSnapshot | null>(null)

    const commit = useMutation({
        mutationFn: mutation(function* (p: { baseId: string; start: string; end: string }) {
            yield eventsCollection.update(p.baseId, draft => {
                draft.start = p.start
                draft.end = p.end
            })
        }),
        onError: err => captureException('calendar.drag-reschedule', err),
    })

    const dayStartMinutes = startHour * 60
    const dayEndMinutes = (endHour + 1) * 60

    const onStart = useCallback(
        (mode: DragMode) => {
            const g = geometryRef.current
            snapshotRef.current = { mode, start: g.start, end: g.end }
            begin(eventId)
        },
        [begin, eventId]
    )

    // Geometry → store preview, sharing the column/visual fields both modes
    // need. colIndex is the origin for resize and the clamped target for move.
    const pushPreview = useCallback(
        (start: Date, end: Date, colIndex: number) => {
            const top = minutesToTop(localMinutes(start), startHour, hourHeight)
            const bottom = minutesToTop(localMinutes(end), startHour, hourHeight)
            const g = geometryRef.current
            const v = visualRef.current
            update({
                top,
                height: bottom - top,
                left: g.left,
                width: g.width,
                colIndex,
                title: v.title,
                timeLabel: v.timeLabel,
                bgColor: v.bgColor,
                textColor: v.textColor,
            })
        },
        [hourHeight, startHour, update]
    )

    const onMove = useCallback(
        (ctx: DragContext) => {
            const snap = snapshotRef.current
            if (snap == null) return
            if (snap.mode === 'resize') {
                const { end: newEnd } = resizeEnd({
                    start: snap.start,
                    end: snap.end,
                    deltaPx: ctx.deltaY,
                    hourHeight,
                    dayEndMinutes,
                })
                pushPreview(snap.start, newEnd, columnIndexRef.current)
                return
            }
            const deltaDays = pxToDayDelta(ctx.deltaX, getColumnWidthRef.current())
            const { start: newStart, end: newEnd } = moveEvent({
                start: snap.start,
                end: snap.end,
                deltaPxY: ctx.deltaY,
                hourHeight,
                deltaDays,
                dayStartMinutes,
                dayEndMinutes,
            })
            const targetCol = clamp(
                columnIndexRef.current + deltaDays,
                0,
                columnCountRef.current - 1
            )
            pushPreview(newStart, newEnd, targetCol)
        },
        [hourHeight, dayStartMinutes, dayEndMinutes, pushPreview]
    )

    const onEnd = useCallback(
        (ctx: DragContext) => {
            const snap = snapshotRef.current
            snapshotRef.current = null
            end()
            if (snap == null) return
            const { baseId } = parseEventId(eventId)
            if (snap.mode === 'resize') {
                const { end: newEnd } = resizeEnd({
                    start: snap.start,
                    end: snap.end,
                    deltaPx: ctx.deltaY,
                    hourHeight,
                    dayEndMinutes,
                })
                if (newEnd.getTime() === snap.end.getTime()) return
                commit.mutate({
                    baseId,
                    start: snap.start.toISOString(),
                    end: newEnd.toISOString(),
                })
                return
            }
            // Clamp the committed day shift to the visible column range so the
            // persisted move matches the ghost the user released over (which
            // was clamped the same way).
            const rawDelta = pxToDayDelta(ctx.deltaX, getColumnWidthRef.current())
            const targetCol = clamp(
                columnIndexRef.current + rawDelta,
                0,
                columnCountRef.current - 1
            )
            const deltaDays = targetCol - columnIndexRef.current
            const { start: newStart, end: newEnd } = moveEvent({
                start: snap.start,
                end: snap.end,
                deltaPxY: ctx.deltaY,
                hourHeight,
                deltaDays,
                dayStartMinutes,
                dayEndMinutes,
            })
            if (
                newStart.getTime() === snap.start.getTime() &&
                newEnd.getTime() === snap.end.getTime()
            ) {
                return
            }
            commit.mutate({
                baseId,
                start: newStart.toISOString(),
                end: newEnd.toISOString(),
            })
        },
        [commit, end, eventId, hourHeight, dayStartMinutes, dayEndMinutes]
    )

    const bodyHandlers = useDragGesture({
        disabled,
        onDragStart: () => {
            onStart('move')
            return true
        },
        onDragMove: onMove,
        onDragEnd: onEnd,
    })

    const handleHandlers = useDragGesture({
        disabled,
        measureTarget: false,
        onDragStart: () => {
            onStart('resize')
            return true
        },
        onDragMove: onMove,
        onDragEnd: onEnd,
    })

    return { bodyHandlers, handleHandlers }
}
