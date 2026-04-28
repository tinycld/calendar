import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { View } from 'react-native'

interface CurrentTimeIndicatorProps {
    topOffset: number
}

export function CurrentTimeIndicator({ topOffset }: CurrentTimeIndicatorProps) {
    const dangerColor = useThemeColor('danger')

    return (
        <View
            className="absolute left-0 right-0 flex-row items-center"
            style={{
                top: topOffset,
                zIndex: 10,
                pointerEvents: 'none',
            }}
        >
            <View
                className="size-2.5 rounded-full"
                style={{
                    backgroundColor: dangerColor,
                    marginLeft: -5,
                }}
            />
            <View className="flex-1" style={{ height: 2, backgroundColor: dangerColor }} />
        </View>
    )
}
