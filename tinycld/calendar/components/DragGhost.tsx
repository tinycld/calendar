import { View } from 'react-native'
import { useCalendarDragStore } from '../stores/calendar-drag-store'
import { EventBlockContent } from './EventBlockContent'

interface DragGhostProps {
    // Number of day columns, so the ghost can size itself to one column and
    // place itself by column index. Same value TimeGrid maps over.
    columnCount: number
    // Pixel height of the scrollable grid content, so the target-day highlight
    // spans the full column.
    contentHeight: number
}

// Floating drag copy + target-day highlight, drawn once over the day-columns
// area. It reads the live drag preview from the store: the origin block dims in
// place (see EventBlock) while this ghost follows the pointer to the new time
// and day. Returns null when no drag is active so it adds nothing to the tree
// at rest. Positioned in the same coordinate space as the columns row, so its
// parent in TimeGrid must be the columns container (not the time-label gutter).
export function DragGhost({ columnCount, contentHeight }: DragGhostProps) {
    const preview = useCalendarDragStore(s => s.preview)
    if (preview == null || columnCount <= 0) return null

    const columnPercent = 100 / columnCount
    // Column origin as a percentage of the columns area, then the event's own
    // slot within that column (left/width are per-column percentages).
    const columnLeft = preview.colIndex * columnPercent
    const ghostLeft = columnLeft + (preview.left / 100) * columnPercent
    const ghostWidth = (preview.width / 100) * columnPercent
    const showTwoLines = preview.height > 40

    return (
        <View className="absolute inset-0" pointerEvents="none">
            {/* Destination-day highlight spanning the full column height. */}
            <View
                className="absolute top-0 bg-primary/10"
                style={{
                    left: `${columnLeft}%`,
                    width: `${columnPercent}%`,
                    height: contentHeight,
                }}
            />

            {/* The floating copy of the dragged event. */}
            <View
                className="absolute rounded overflow-hidden"
                style={{
                    top: preview.top,
                    left: `${ghostLeft}%`,
                    width: `${ghostWidth}%`,
                    height: Math.max(preview.height - 2, 18),
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    backgroundColor: preview.bgColor,
                    opacity: 0.9,
                }}
            >
                <EventBlockContent
                    title={preview.title}
                    timeLabel={preview.timeLabel}
                    textColor={preview.textColor}
                    showTwoLines={showTwoLines}
                />
            </View>
        </View>
    )
}
