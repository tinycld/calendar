import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Text, View } from 'react-native'
import { getShortDayName } from '../hooks/useCalendarNavigation'

interface DayColumnHeaderProps {
    date: Date
    isToday: boolean
}

export function DayColumnHeader({ date, isToday }: DayColumnHeaderProps) {
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const dayName = getShortDayName(date)
    const dateNum = date.getDate()

    return (
        <View className="items-center py-2 gap-1">
            <Text
                style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: isToday ? primaryColor : mutedColor,
                }}
            >
                {dayName}
            </Text>
            <View
                className="rounded-full items-center justify-center"
                style={{
                    width: 28,
                    height: 28,
                    backgroundColor: isToday ? primaryColor : 'transparent',
                }}
            >
                <Text
                    style={{
                        fontSize: 16,
                        fontWeight: '600',
                        color: isToday ? primaryFgColor : fgColor,
                    }}
                >
                    {dateNum}
                </Text>
            </View>
        </View>
    )
}
