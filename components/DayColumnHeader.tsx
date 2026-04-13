import { useThemeColor } from 'heroui-native'
import { Text, View } from 'react-native'
import { getShortDayName } from '../hooks/useCalendarNavigation'

interface DayColumnHeaderProps {
    date: Date
    isToday: boolean
}

export function DayColumnHeader({ date, isToday }: DayColumnHeaderProps) {
    const [accentColor, accentFgColor, mutedColor, fgColor] = useThemeColor([
        'accent',
        'accent-foreground',
        'muted',
        'foreground',
    ])
    const dayName = getShortDayName(date)
    const dateNum = date.getDate()

    return (
        <View style={{ alignItems: 'center', paddingVertical: 8, gap: 4 }}>
            <Text
                style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: isToday ? accentColor : mutedColor,
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
                    backgroundColor: isToday ? accentColor : 'transparent',
                }}
            >
                <Text
                    style={{
                        fontSize: 16,
                        fontWeight: '600',
                        color: isToday ? accentFgColor : fgColor,
                    }}
                >
                    {dateNum}
                </Text>
            </View>
        </View>
    )
}
