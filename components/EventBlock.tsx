import { type GestureResponderEvent, Pressable, Text, View } from 'react-native'

interface EventBlockProps {
    title: string
    timeLabel: string
    bgColor: string
    textColor: string
    topOffset: number
    height: number
    left?: number
    width?: number
    onPress: (e: GestureResponderEvent) => void
}

export function EventBlock({
    title,
    timeLabel,
    bgColor,
    textColor,
    topOffset,
    height,
    left = 0,
    width = 100,
    onPress,
}: EventBlockProps) {
    const showTwoLines = height > 40

    return (
        <Pressable
            onPress={onPress}
            style={{
                position: 'absolute',
                top: topOffset,
                left: `${left}%`,
                width: `${width}%`,
                height: Math.max(height - 2, 18),
                paddingHorizontal: 1,
                zIndex: 5,
            }}
        >
            <View
                style={{
                    flex: 1,
                    borderRadius: 4,
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    overflow: 'hidden',
                    backgroundColor: bgColor,
                }}
            >
                <Text
                    style={{ fontSize: 12, fontWeight: '600', color: textColor }}
                    numberOfLines={1}
                >
                    {title}
                </Text>
                {showTwoLines && (
                    <Text
                        style={{ fontSize: 11, opacity: 0.9, color: textColor }}
                        numberOfLines={1}
                    >
                        {timeLabel}
                    </Text>
                )}
            </View>
        </Pressable>
    )
}
