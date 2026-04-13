import { useMemo } from 'react'
import { type GestureResponderEvent, Pressable, Text, View } from 'react-native'
import { useThemeColor } from '~/lib/use-app-theme'
import { useCalendarMap } from '../hooks/useCalendarEvents'
import { type LayoutEvent, layoutAllDayEvents } from '../layout'
import type { CalendarEvents } from '../types'
import { getCalendarColorResolved } from './calendar-colors'

const ROW_HEIGHT = 22

interface AllDayBarProps {
    events: CalendarEvents[]
    weekStart: Date
    dayCount: number
    onEventPress: (eventId: string, e: GestureResponderEvent) => void
}

export function AllDayBar({ events, weekStart, dayCount, onEventPress }: AllDayBarProps) {
    const calendarMap = useCalendarMap()
    const [sidebarBg, borderColor] = useThemeColor(['sidebar-background', 'border'])

    const { layouts, eventMap, maxRow } = useMemo(() => {
        const layoutEvents: LayoutEvent[] = events.map(e => ({
            id: e.id,
            start: new Date(e.start),
            end: new Date(e.end),
            allDay: e.all_day,
        }))
        const allDayLayouts = layoutAllDayEvents(layoutEvents, weekStart, dayCount)
        const map = new Map(events.map(e => [e.id, e]))
        const max = allDayLayouts.reduce((m, l) => Math.max(m, l.row), -1)
        return { layouts: allDayLayouts, eventMap: map, maxRow: max }
    }, [events, weekStart, dayCount])

    if (layouts.length === 0) return null

    const containerHeight = (maxRow + 1) * ROW_HEIGHT + 4

    return (
        <View
            style={{
                flexDirection: 'row',
                borderBottomWidth: 1,
                backgroundColor: sidebarBg,
                borderBottomColor: borderColor,
            }}
        >
            <View style={{ width: 50 }} />
            <View style={{ flex: 1, position: 'relative', height: containerHeight }}>
                {layouts.map(layout => {
                    const event = eventMap.get(layout.id)
                    if (!event) return null
                    const cal = calendarMap.get(event.calendar)
                    const colors = getCalendarColorResolved(cal?.color ?? 'blue')
                    return (
                        <Pressable
                            key={event.id}
                            onPress={e => onEventPress(event.id, e)}
                            style={{
                                position: 'absolute',
                                top: layout.row * ROW_HEIGHT + 2,
                                left: `${(layout.startCol / dayCount) * 100}%`,
                                width: `${(layout.span / dayCount) * 100}%`,
                                height: ROW_HEIGHT - 2,
                                paddingHorizontal: 1,
                            }}
                        >
                            <View
                                style={{
                                    flex: 1,
                                    borderRadius: 3,
                                    paddingHorizontal: 4,
                                    paddingVertical: 1,
                                    overflow: 'hidden',
                                    backgroundColor: colors.bg,
                                }}
                            >
                                <Text
                                    style={{ fontSize: 12, fontWeight: '600', color: colors.text }}
                                    numberOfLines={1}
                                >
                                    {event.title}
                                </Text>
                            </View>
                        </Pressable>
                    )
                })}
            </View>
        </View>
    )
}
