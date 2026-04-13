import { useThemeColor } from 'heroui-native'
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native'
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
    const [fgColor, mutedColor, accentColor, accentFgColor, borderColor] = useThemeColor([
        'foreground',
        'muted',
        'accent',
        'accent-foreground',
        'border',
    ])
    const calendarMap = useCalendarMap()
    const dateNum = date.getDate()
    const layouts = cellLayout?.layouts ?? []
    const overflowCount = cellLayout?.overflowCount ?? 0

    return (
        <Pressable
            style={{
                flex: 1,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderColor,
                padding: 2,
                overflow: 'hidden',
            }}
            onPress={() => onDatePress(date)}
        >
            <View
                style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    alignSelf: 'flex-end',
                    marginBottom: 2,
                    marginRight: 2,
                    backgroundColor: isToday ? accentColor : undefined,
                }}
            >
                <Text
                    style={{
                        fontSize: 12,
                        fontWeight: '500',
                        color: isToday ? accentFgColor : isCurrentMonth ? fgColor : mutedColor,
                    }}
                >
                    {dateNum}
                </Text>
            </View>

            {layouts.map(layout => {
                if (layout.isAllDay) return null

                const event = eventMap.get(layout.id)
                if (!event) return null

                const cal = calendarMap.get(event.calendar)
                const colors = getCalendarColorResolved(cal?.color ?? 'blue')

                if (event.all_day) {
                    return (
                        <Pressable key={event.id} onPress={e => onEventPress(event.id, e)}>
                            <View
                                style={{
                                    borderRadius: 3,
                                    paddingHorizontal: 4,
                                    paddingVertical: 1,
                                    marginBottom: 1,
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
                    <Pressable key={event.id} onPress={e => onEventPress(event.id, e)}>
                        <View
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 3,
                                paddingVertical: 1,
                            }}
                        >
                            <View
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 3,
                                    backgroundColor: colors.bg,
                                }}
                            />
                            <Text style={{ fontSize: 10, color: mutedColor }}>{timeStr}</Text>
                            <Text
                                style={{ fontSize: 11, color: fgColor, flex: 1 }}
                                numberOfLines={1}
                            >
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
