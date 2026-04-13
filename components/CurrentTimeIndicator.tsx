import { useThemeColor } from 'heroui-native'
import { View } from 'react-native'

interface CurrentTimeIndicatorProps {
    topOffset: number
}

export function CurrentTimeIndicator({ topOffset }: CurrentTimeIndicatorProps) {
    const dangerColor = useThemeColor('danger')

    return (
        <View
            style={{
                position: 'absolute',
                top: topOffset,
                left: 0,
                right: 0,
                flexDirection: 'row',
                alignItems: 'center',
                zIndex: 10,
                pointerEvents: 'none',
            }}
        >
            <View
                style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: dangerColor,
                    marginLeft: -5,
                }}
            />
            <View style={{ flex: 1, height: 2, backgroundColor: dangerColor }} />
        </View>
    )
}
