import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useThemeColor } from '~/lib/use-app-theme'
import { addMonths, isSameDay } from '../hooks/useCalendarNavigation'
import { getMonthGrid } from '../hooks/useMonthGrid'

const DAY_LETTERS = [
    { key: 'sun', label: 'S' },
    { key: 'mon', label: 'M' },
    { key: 'tue', label: 'T' },
    { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' },
    { key: 'fri', label: 'F' },
    { key: 'sat', label: 'S' },
]

interface MiniCalendarProps {
    selectedDate: Date
    onDateSelect: (date: Date) => void
}

export function MiniCalendar({ selectedDate, onDateSelect }: MiniCalendarProps) {
    const [displayMonth, setDisplayMonth] = useState(
        () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
    )
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted')
    const accentColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')
    const activeIndicatorColor = useThemeColor('active-indicator')

    const grid = getMonthGrid(displayMonth)

    const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ]

    const monthLabel = `${months[displayMonth.getMonth()]} ${displayMonth.getFullYear()}`

    return (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <View
                style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                }}
            >
                <Text style={{ fontSize: 13, fontWeight: '600', color: fgColor }}>
                    {monthLabel}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                        onPress={() => setDisplayMonth(prev => addMonths(prev, -1))}
                        hitSlop={8}
                    >
                        <ChevronLeft size={16} color={mutedColor} />
                    </Pressable>
                    <Pressable
                        onPress={() => setDisplayMonth(prev => addMonths(prev, 1))}
                        hitSlop={8}
                    >
                        <ChevronRight size={16} color={mutedColor} />
                    </Pressable>
                </View>
            </View>

            <View style={{ flexDirection: 'row' }}>
                {DAY_LETTERS.map(day => (
                    <View
                        key={day.key}
                        style={{ width: '14.28%', alignItems: 'center', paddingVertical: 1 }}
                    >
                        <Text style={{ fontSize: 10, fontWeight: '600', color: mutedColor }}>
                            {day.label}
                        </Text>
                    </View>
                ))}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {grid.map(cell => {
                    const isSelected = isSameDay(cell.date, selectedDate)
                    const cellKey = cell.date.toISOString().split('T')[0]

                    return (
                        <Pressable
                            key={cellKey}
                            style={{ width: '14.28%', alignItems: 'center', paddingVertical: 1 }}
                            onPress={() => onDateSelect(cell.date)}
                        >
                            <View
                                style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 12,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: cell.isToday
                                        ? accentColor
                                        : isSelected
                                          ? `${activeIndicatorColor}30`
                                          : undefined,
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: cell.isToday ? '700' : undefined,
                                        color: cell.isToday
                                            ? accentFgColor
                                            : cell.isCurrentMonth
                                              ? fgColor
                                              : mutedColor,
                                    }}
                                >
                                    {cell.date.getDate()}
                                </Text>
                            </View>
                        </Pressable>
                    )
                })}
            </View>
        </View>
    )
}
