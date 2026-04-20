import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCalendarMap } from '../hooks/useCalendarEvents'
import { formatShortTime } from '../hooks/useCalendarNavigation'
import type { MonthCellLayout } from '../layout'
import type { CalendarEvents } from '../types'
import { getCalendarColorResolved } from './calendar-colors'

interface MonthCellProps {
    date: Date
    isCurrentMonth: boolean
    isToday: boolean
    cellLayout: MonthCellLayout | undefined
    eventMap: Map<string, CalendarEvents>
    onDatePress: (date: Date) => void
    onEventPress: (eventId: string, e: GestureResponderEvent) => void
}

export function MonthCell({
    date,
    isCurrentMonth,
    isToday,
    cellLayout,
    eventMap,
    onDatePress,
    onEventPress,
}: MonthCellProps) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const borderColor = useThemeColor('border')
    const calendarMap = useCalendarMap()
    const dateNum = date.getDate()
    const layouts = cellLayout?.layouts ?? []
    const overflowCount = cellLayout?.overflowCount ?? 0

    return (
        <Pressable
            className="flex-1 p-0.5 overflow-hidden"
            style={{
                borderRightWidth: StyleSheet.hairlineWidth,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderColor,
            }}
            onPress={() => onDatePress(date)}
        >
            <View
                className="size-6 rounded-full items-center justify-center self-end mb-0.5 mr-0.5"
                style={{
                    backgroundColor: isToday ? primaryColor : undefined,
                }}
            >
                <Text
                    style={{
                        fontSize: 12,
                        fontWeight: '500',
                        color: isToday ? primaryFgColor : isCurrentMonth ? fgColor : mutedColor,
                    }}
                >
                    {dateNum}
                </Text>
            </View>

            {layouts.map((layout) => {
                if (layout.isAllDay) return null

                const event = eventMap.get(layout.id)
                if (!event) return null

                const cal = calendarMap.get(event.calendar)
                const colors = getCalendarColorResolved(cal?.color ?? 'blue')

                if (event.all_day) {
                    return (
                        <Pressable key={event.id} onPress={(e) => onEventPress(event.id, e)}>
                            <View
                                className="rounded-sm px-1 py-px mb-px"
                                style={{
                                    backgroundColor: colors.bg,
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: '600',
                                        color: colors.text,
                                    }}
                                    numberOfLines={1}
                                >
                                    {event.title}
                                </Text>
                            </View>
                        </Pressable>
                    )
                }

                const timeStr = formatShortTime(new Date(event.start))

                return (
                    <Pressable key={event.id} onPress={(e) => onEventPress(event.id, e)}>
                        <View className="flex-row items-center gap-[3px] py-px">
                            <View
                                className="size-1.5 rounded-full"
                                style={{
                                    backgroundColor: colors.bg,
                                }}
                            />
                            <Text style={{ fontSize: 10, color: mutedColor }}>{timeStr}</Text>
                            <Text style={{ fontSize: 11, color: fgColor, flex: 1 }} numberOfLines={1}>
                                {event.title}
                            </Text>
                        </View>
                    </Pressable>
                )
            })}

            {overflowCount > 0 && (
                <Pressable onPress={() => onDatePress(date)}>
                    <Text
                        style={{
                            fontSize: 11,
                            fontWeight: '600',
                            color: mutedColor,
                            paddingVertical: 2,
                            textAlign: 'center',
                        }}
                    >
                        +{overflowCount} more
                    </Text>
                </Pressable>
            )}
        </Pressable>
    )
}
