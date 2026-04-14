import { Text, View } from 'react-native'
import { useThemeColor } from '~/lib/use-app-theme'
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
        <View style={{ alignItems: 'center', paddingVertical: 8, gap: 4 }}>
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
                style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
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
