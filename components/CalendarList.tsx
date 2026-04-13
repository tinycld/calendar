import { useThemeColor } from 'heroui-native'
import { Check, ChevronDown, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { CalendarColorKey, CalendarWithGroup } from '../types'
import { CalendarMenu } from './CalendarMenu'
import { getCalendarColorResolved } from './calendar-colors'

interface CalendarListProps {
    calendars: CalendarWithGroup[]
    visibleIds: Set<string>
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
}

function CalendarCheckbox({
    calendar,
    isChecked,
    onToggle,
    onColorChange,
    onShowOnly,
}: {
    calendar: CalendarWithGroup
    isChecked: boolean
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
}) {
    const fgColor = useThemeColor('foreground')
    const colors = getCalendarColorResolved(calendar.color)

    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingRight: 12,
                paddingVertical: 5,
            }}
        >
            <Pressable
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    flex: 1,
                    paddingLeft: 32,
                }}
                onPress={() => onToggle(calendar.id)}
            >
                <View
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 3,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isChecked ? colors.bg : 'transparent',
                        borderColor: isChecked ? undefined : colors.bg,
                        borderWidth: isChecked ? 0 : 2,
                    }}
                >
                    {isChecked && <Check size={12} color={colors.text} />}
                </View>
                <Text style={{ fontSize: 13, color: fgColor, flex: 1 }} numberOfLines={1}>
                    {calendar.name}
                </Text>
            </Pressable>
            <CalendarMenu
                currentColor={calendar.color}
                onColorChange={color => onColorChange(calendar.id, color)}
                onShowOnly={() => onShowOnly(calendar.id)}
            />
        </View>
    )
}

function CalendarSection({
    title,
    calendars,
    visibleIds,
    onToggle,
    onColorChange,
    onShowOnly,
}: {
    title: string
    calendars: CalendarWithGroup[]
    visibleIds: Set<string>
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
}) {
    const [expanded, setExpanded] = useState(true)
    const mutedColor = useThemeColor('muted')
    const ChevronIcon = expanded ? ChevronDown : ChevronRight

    return (
        <View>
            <Pressable
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                }}
                onPress={() => setExpanded(prev => !prev)}
            >
                <ChevronIcon size={14} color={mutedColor} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: mutedColor }}>{title}</Text>
            </Pressable>
            {expanded &&
                calendars.map(cal => (
                    <CalendarCheckbox
                        key={cal.id}
                        calendar={cal}
                        isChecked={visibleIds.has(cal.id)}
                        onToggle={onToggle}
                        onColorChange={onColorChange}
                        onShowOnly={onShowOnly}
                    />
                ))}
        </View>
    )
}

export function CalendarList({
    calendars,
    visibleIds,
    onToggle,
    onColorChange,
    onShowOnly,
}: CalendarListProps) {
    const mine = calendars.filter(c => c.group === 'mine')
    const other = calendars.filter(c => c.group === 'other')

    return (
        <View style={{ gap: 4 }}>
            <CalendarSection
                title="My calendars"
                calendars={mine}
                visibleIds={visibleIds}
                onToggle={onToggle}
                onColorChange={onColorChange}
                onShowOnly={onShowOnly}
            />
            <CalendarSection
                title="Other calendars"
                calendars={other}
                visibleIds={visibleIds}
                onToggle={onToggle}
                onColorChange={onColorChange}
                onShowOnly={onShowOnly}
            />
        </View>
    )
}
