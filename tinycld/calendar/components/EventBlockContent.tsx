import { Text } from 'react-native'

interface EventBlockContentProps {
    title: string
    timeLabel: string
    textColor: string
    // The time label only fits once the block is tall enough; the caller
    // derives this from the rendered height so the real block and the drag
    // ghost stay in lockstep.
    showTwoLines: boolean
}

// The inner label of a time-grid event: the title, plus the start-time line
// when there's room. Shared by EventBlock and the DragGhost so the floating
// copy can never drift from the real block's appearance.
export function EventBlockContent({
    title,
    timeLabel,
    textColor,
    showTwoLines,
}: EventBlockContentProps) {
    return (
        <>
            <Text style={{ fontSize: 12, fontWeight: '600', color: textColor }} numberOfLines={1}>
                {title}
            </Text>
            {showTwoLines && (
                <Text style={{ fontSize: 11, opacity: 0.9, color: textColor }} numberOfLines={1}>
                    {timeLabel}
                </Text>
            )}
        </>
    )
}
