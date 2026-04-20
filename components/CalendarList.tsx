import { AlertTriangle, Check, ChevronDown, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useThemeColor } from '~/lib/use-app-theme'
import type { CalendarColorKey, CalendarWithGroup } from '../types'
import { CalendarMenu } from './CalendarMenu'
import { getCalendarColorResolved } from './calendar-colors'

interface CalendarListProps {
    calendars: CalendarWithGroup[]
    visibleIds: Set<string>
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
    onRefreshSubscription?: (calendarId: string) => void
    onDeleteCalendar?: (calendarId: string) => void
}

function CalendarCheckbox({
    calendar,
    isChecked,
    onToggle,
    onColorChange,
    onShowOnly,
    onRefreshSubscription,
    onDeleteCalendar,
}: {
    calendar: CalendarWithGroup
    isChecked: boolean
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
    onRefreshSubscription?: (calendarId: string) => void
    onDeleteCalendar?: (calendarId: string) => void
}) {
    const fgColor = useThemeColor('foreground')
    const dangerColor = useThemeColor('danger')
    const colors = getCalendarColorResolved(calendar.color)

    return (
        <View>
            <View className="flex-row items-center pr-3 py-[5px]">
                <Pressable className="flex-row items-center gap-2.5 flex-1 pl-8" onPress={() => onToggle(calendar.id)}>
                    <View
                        className="size-4 rounded-sm items-center justify-center"
                        style={{
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
                    {calendar.subscription_error ? <AlertTriangle size={14} color={dangerColor} /> : null}
                </Pressable>
                <CalendarMenu
                    currentColor={calendar.color}
                    onColorChange={(color) => onColorChange(calendar.id, color)}
                    onShowOnly={() => onShowOnly(calendar.id)}
                    calendar={calendar}
                    onRefresh={onRefreshSubscription ? () => onRefreshSubscription(calendar.id) : undefined}
                    onDelete={onDeleteCalendar ? () => onDeleteCalendar(calendar.id) : undefined}
                />
            </View>
            {calendar.subscription_error ? (
                <Text style={{ fontSize: 11, color: dangerColor, paddingLeft: 52, paddingRight: 12 }} numberOfLines={2}>
                    {calendar.subscription_error}
                </Text>
            ) : null}
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
    onRefreshSubscription,
    onDeleteCalendar,
}: {
    title: string
    calendars: CalendarWithGroup[]
    visibleIds: Set<string>
    onToggle: (id: string) => void
    onColorChange: (calendarId: string, color: CalendarColorKey) => void
    onShowOnly: (calendarId: string) => void
    onRefreshSubscription?: (calendarId: string) => void
    onDeleteCalendar?: (calendarId: string) => void
}) {
    const [expanded, setExpanded] = useState(true)
    const mutedColor = useThemeColor('muted-foreground')
    const ChevronIcon = expanded ? ChevronDown : ChevronRight

    return (
        <View>
            <Pressable
                className="flex-row items-center gap-1.5 px-3 py-1.5"
                onPress={() => setExpanded((prev) => !prev)}
            >
                <ChevronIcon size={14} color={mutedColor} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: mutedColor }}>{title}</Text>
            </Pressable>
            {expanded &&
                calendars.map((cal) => (
                    <CalendarCheckbox
                        key={cal.id}
                        calendar={cal}
                        isChecked={visibleIds.has(cal.id)}
                        onToggle={onToggle}
                        onColorChange={onColorChange}
                        onShowOnly={onShowOnly}
                        onRefreshSubscription={onRefreshSubscription}
                        onDeleteCalendar={onDeleteCalendar}
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
    onRefreshSubscription,
    onDeleteCalendar,
}: CalendarListProps) {
    const mine = calendars.filter((c) => c.group === 'mine')
    const other = calendars.filter((c) => c.group === 'other')
    const subscribed = calendars.filter((c) => c.group === 'subscribed')

    return (
        <View className="gap-1">
            <CalendarSection
                title="My calendars"
                calendars={mine}
                visibleIds={visibleIds}
                onToggle={onToggle}
                onColorChange={onColorChange}
                onShowOnly={onShowOnly}
                onDeleteCalendar={onDeleteCalendar}
            />
            <CalendarSection
                title="Other calendars"
                calendars={other}
                visibleIds={visibleIds}
                onToggle={onToggle}
                onColorChange={onColorChange}
                onShowOnly={onShowOnly}
                onDeleteCalendar={onDeleteCalendar}
            />
            {subscribed.length > 0 && (
                <CalendarSection
                    title="Subscribed calendars"
                    calendars={subscribed}
                    visibleIds={visibleIds}
                    onToggle={onToggle}
                    onColorChange={onColorChange}
                    onShowOnly={onShowOnly}
                    onRefreshSubscription={onRefreshSubscription}
                    onDeleteCalendar={onDeleteCalendar}
                />
            )}
        </View>
    )
}
