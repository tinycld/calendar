import { create } from '@tinycld/core/lib/store'

// In-flight drag state for the time grid. While a drag is active the origin
// block dims in place and a floating "ghost" copy is drawn over a
// grid-spanning overlay at the previewed position (new time and, in week view,
// new day) — Google-Calendar style. The committed start/end are written once
// on release and the live query reconciles the final position.
//
// The preview carries everything the ghost needs to paint itself (geometry +
// the origin block's colors/label) plus `colIndex`, the target day column the
// ghost currently sits over. `colIndex` also drives the destination-day
// highlight. This is UI-only state, so it lives in Zustand, not
// useState/useEffect.

export interface DragPreview {
    // Vertical geometry in grid pixels (same space as layoutTimedEvents).
    top: number
    height: number
    // Horizontal placement within a single day column (percent), copied from
    // the origin block so the ghost keeps the event's column slot.
    left: number
    width: number
    // Target day column the ghost is over (0-based). Same as the origin in day
    // view; shifts as the pointer crosses columns in week view.
    colIndex: number
    // Painted appearance, copied from the origin block.
    title: string
    timeLabel: string
    bgColor: string
    textColor: string
}

export type DragMode = 'resize' | 'move'

interface CalendarDragState {
    activeEventId: string | null
    preview: DragPreview | null
    begin: (eventId: string) => void
    update: (preview: DragPreview) => void
    end: () => void
}

export const useCalendarDragStore = create<CalendarDragState>(set => ({
    activeEventId: null,
    preview: null,
    begin: eventId => set({ activeEventId: eventId, preview: null }),
    update: preview => set({ preview }),
    end: () => set({ activeEventId: null, preview: null }),
}))

// True when this event is the one being dragged — the origin block uses it to
// dim itself in place while the ghost shows the live position.
export function selectIsDragging(eventId: string) {
    return (s: CalendarDragState): boolean => s.activeEventId === eventId
}
