import { type GestureResponderEvent, Platform, Pressable, View, type ViewStyle } from 'react-native'
import { useEventDrag } from '../hooks/useEventDrag'
import { selectIsDragging, useCalendarDragStore } from '../stores/calendar-drag-store'
import { EventBlockContent } from './EventBlockContent'

// RN-Web forwards unrecognized style keys to inline CSS, so web cursor
// affordances work, but RN's ViewStyle.cursor type only admits 'auto' /
// 'pointer'. webCursor builds a ViewStyle carrying an arbitrary CSS cursor
// without reaching for `any` or a biome-ignore. Native returns null (no
// cursor concept), so the value is branchless at the call site.
function webCursor(value: string): ViewStyle | null {
    if (Platform.OS !== 'web') return null
    return { cursor: value } as ViewStyle
}

// Height of the bottom resize grab zone. Native gets a taller hit target than
// the visible edge since fingers are less precise than a pointer.
const RESIZE_HANDLE_HEIGHT = Platform.OS === 'web' ? 8 : 14

interface EventBlockProps {
    eventId: string
    title: string
    timeLabel: string
    bgColor: string
    textColor: string
    topOffset: number
    height: number
    left?: number
    width?: number
    // Start/end + grid params drive the drag math; column width enables
    // week-view horizontal day-move (0 in day view).
    start: Date
    end: Date
    startHour: number
    endHour: number
    hourHeight: number
    // Reads the live measured column width at drag time (see useEventDrag).
    getColumnWidth: () => number
    // This block's day column and the total column count, so a move drag can
    // resolve and clamp a target day.
    columnIndex: number
    columnCount: number
    // True for recurring occurrences and read-only calendars: tap still opens
    // the detail popover, but the block can't be dragged.
    dragDisabled: boolean
    onPress: (e: GestureResponderEvent) => void
}

export function EventBlock({
    eventId,
    title,
    timeLabel,
    bgColor,
    textColor,
    topOffset,
    height,
    left = 0,
    width = 100,
    start,
    end,
    startHour,
    endHour,
    hourHeight,
    getColumnWidth,
    columnIndex,
    columnCount,
    dragDisabled,
    onPress,
}: EventBlockProps) {
    const isDragging = useCalendarDragStore(selectIsDragging(eventId))
    const { bodyHandlers, handleHandlers } = useEventDrag({
        eventId,
        startHour,
        endHour,
        hourHeight,
        getColumnWidth,
        columnIndex,
        columnCount,
        disabled: dragDisabled,
        geometry: { start, end, top: topOffset, height, left, width },
        visual: { title, timeLabel, bgColor, textColor },
    })

    const showTwoLines = height > 40

    const handlePress = (e: GestureResponderEvent) => {
        // A drag ends with a synthetic press on web; suppress it so dragging
        // doesn't also open the detail popover.
        if (bodyHandlers.wasDragged) return
        onPress(e)
    }

    const bodyCursor = dragDisabled
        ? null
        : webCursor(bodyHandlers.isDragging ? 'grabbing' : 'grab')
    const handleCursor = dragDisabled ? null : webCursor('ns-resize')

    // The body and the resize handle are SIBLINGS inside a non-gesture
    // container, never parent/child. Nesting them would break the gesture on
    // both platforms: on web a pointer-down on the handle would bubble to the
    // body and start a move too; on native the body's PanResponder capture
    // (onStartShouldSetPanResponderCapture → true) would claim the touch
    // before the handle ever saw it. As siblings, the handle (higher z-index)
    // wins its own bottom strip and the body owns the rest.
    return (
        <View
            className="absolute"
            style={{
                top: topOffset,
                left: `${left}%`,
                width: `${width}%`,
                height: Math.max(height - 2, 18),
                paddingHorizontal: 1,
                zIndex: 5,
                // Dim in place while the floating ghost shows the live position.
                opacity: isDragging ? 0.4 : 1,
            }}
        >
            <Pressable
                {...bodyHandlers.handlers}
                testID={`event-block-${eventId}`}
                onPress={handlePress}
                className="absolute inset-0 rounded overflow-hidden"
                style={[
                    {
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        backgroundColor: bgColor,
                    },
                    bodyCursor,
                ]}
            >
                <EventBlockContent
                    title={title}
                    timeLabel={timeLabel}
                    textColor={textColor}
                    showTwoLines={showTwoLines}
                />
            </Pressable>

            {!dragDisabled && (
                <View
                    {...handleHandlers.handlers}
                    testID={`event-resize-${eventId}`}
                    className="absolute left-0 right-0 bottom-0"
                    style={[{ height: RESIZE_HANDLE_HEIGHT, zIndex: 10 }, handleCursor]}
                />
            )}
        </View>
    )
}
