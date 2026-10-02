import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Popover, type PopoverAnchor, usePopoverContext } from '@tinycld/core/ui/popover'
import { useRouter } from 'expo-router'
import { Clock, MapPin, Pencil, Trash2, Users, X } from 'lucide-react-native'
import { Pressable, Text, useWindowDimensions, View } from 'react-native'
import { describeRRule, parseEventId } from '../lib/recurrence'
import type { CalendarEvents } from '../types'
import { getCalendarColorResolved } from './calendar-colors'
import { EventGuestList } from './EventGuestList'

interface EventDetailPopoverProps {
    isVisible: boolean
    event: CalendarEvents | undefined
    calendarName: string
    calendarColorKey: string
    anchor?: PopoverAnchor
    onClose: () => void
    onDelete?: (eventId: string) => void
    isReadOnly?: boolean
}

const POPOVER_WIDTH = 360

function formatEventDateTime(event: CalendarEvents): string {
    const start = new Date(event.start)
    const end = new Date(event.end)
    const dateStr = start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
    if (event.all_day) return dateStr
    const startTime = start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    })
    const endTime = end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    })
    return `${dateStr}\n${startTime} – ${endTime}`
}

function getRecurrenceLabel(event: CalendarEvents): string {
    if (!event.recurrence) return ''
    return describeRRule(event.recurrence, new Date(event.start))
}

/**
 * A keyboard open (the schedule view's Enter) has no press point to anchor
 * to, so the surface drops from the top-centre of the window instead.
 */
function useResolvedAnchor(anchor: PopoverAnchor | undefined) {
    const { width, height } = useWindowDimensions()
    if (anchor) return { anchor, placement: 'right-center' as const }
    return { anchor: { x: width / 2, y: height / 4 }, placement: 'bottom-center' as const }
}

/**
 * The core Popover joins the shared overlay layer stack, so a press anywhere
 * outside it — the grid, the sidebar, the rail — dismisses it, as do Escape and
 * the Android back button. On the mobile breakpoint it becomes a sheet.
 */
export function EventDetailPopover({
    isVisible,
    event,
    calendarName,
    calendarColorKey,
    anchor,
    onClose,
    onDelete,
    isReadOnly,
}: EventDetailPopoverProps) {
    const resolved = useResolvedAnchor(anchor)
    const isOpen = isVisible && event !== undefined

    return (
        <Popover
            isOpen={isOpen}
            onOpenChange={open => {
                if (!open) onClose()
            }}
            anchor={resolved.anchor}
            placement={resolved.placement}
            width={POPOVER_WIDTH}
            className="px-4 py-3"
            role="dialog"
            testID="event-detail-popover"
        >
            <EventDetailBody
                event={event}
                calendarName={calendarName}
                calendarColorKey={calendarColorKey}
                onDelete={onDelete}
                isReadOnly={isReadOnly}
            />
        </Popover>
    )
}

interface EventDetailBodyProps {
    event: CalendarEvents | undefined
    calendarName: string
    calendarColorKey: string
    onDelete?: (eventId: string) => void
    isReadOnly?: boolean
}

function useEventDetailActions(event: CalendarEvents | undefined, onDelete?: (id: string) => void) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const { close } = usePopoverContext()
    const baseId = event ? parseEventId(event.id).baseId : ''

    const onEdit = () => {
        close()
        router.push(orgHref('calendar/[id]', { id: baseId }))
    }
    const handleDelete = () => {
        onDelete?.(baseId)
        close()
    }
    return { close, onEdit, handleDelete }
}

function EventDetailBody({
    event,
    calendarName,
    calendarColorKey,
    onDelete,
    isReadOnly,
}: EventDetailBodyProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const { close, onEdit, handleDelete } = useEventDetailActions(event, onDelete)

    if (!event) return null

    const colors = getCalendarColorResolved(calendarColorKey)

    return (
        <View>
            <View className="flex-row justify-end gap-4 mb-3">
                <EventEditActions isVisible={!isReadOnly} onEdit={onEdit} onDelete={handleDelete} />
                <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close">
                    <X size={18} color={mutedColor} />
                </Pressable>
            </View>

            <View className="flex-row items-center gap-2.5 mb-3">
                <View className="w-1 h-6 rounded-sm" style={{ backgroundColor: colors.bg }} />
                <Text
                    className="flex-1 text-foreground"
                    style={{ fontSize: 18, fontWeight: '600' }}
                >
                    {event.title}
                </Text>
            </View>

            <View className="flex-row items-start gap-2.5 mb-2 pl-0.5">
                <Clock size={16} color={mutedColor} />
                <Text className="flex-1 text-foreground" style={{ fontSize: 14 }}>
                    {formatEventDateTime(event)}
                </Text>
            </View>

            <EventRecurrence event={event} />
            <EventLocation event={event} />
            <EventGuests event={event} />
            <EventDescription event={event} />

            <Text className="mt-2 pl-0.5 text-muted-foreground" style={{ fontSize: 12 }}>
                {calendarName}
            </Text>
        </View>
    )
}

function EventEditActions({
    isVisible,
    onEdit,
    onDelete,
}: {
    isVisible: boolean
    onEdit: () => void
    onDelete: () => void
}) {
    const mutedColor = useThemeColor('muted-foreground')
    if (!isVisible) return null
    return (
        <>
            <Pressable onPress={onEdit} hitSlop={8} accessibilityLabel="Edit event">
                <Pencil size={18} color={mutedColor} />
            </Pressable>
            <Pressable onPress={onDelete} hitSlop={8} accessibilityLabel="Delete event">
                <Trash2 size={18} color={mutedColor} />
            </Pressable>
        </>
    )
}

function EventRecurrence({ event }: { event: CalendarEvents }) {
    if (!event.recurrence) return null
    return (
        <Text
            className="text-muted-foreground"
            style={{ fontSize: 13, marginBottom: 8, paddingLeft: 22 }}
        >
            {getRecurrenceLabel(event)}
        </Text>
    )
}

function EventLocation({ event }: { event: CalendarEvents }) {
    const mutedColor = useThemeColor('muted-foreground')
    if (!event.location) return null
    return (
        <View className="flex-row items-start gap-2.5 mb-2 pl-0.5">
            <MapPin size={16} color={mutedColor} />
            <Text className="flex-1 text-foreground" style={{ fontSize: 14 }}>
                {event.location}
            </Text>
        </View>
    )
}

/** A sheet has the room for the full guest list; the anchored box shows a count. */
function EventGuests({ event }: { event: CalendarEvents }) {
    const mutedColor = useThemeColor('muted-foreground')
    const { isSheet } = usePopoverContext()
    const count = event.guests.length
    if (count === 0) return null
    const label = `${count} guest${count !== 1 ? 's' : ''}`
    return (
        <View className="mb-2">
            <View className="flex-row items-start gap-2.5 mb-2 pl-0.5">
                <Users size={16} color={mutedColor} />
                <Text className="flex-1 text-foreground" style={{ fontSize: 14 }}>
                    {label}
                </Text>
            </View>
            <GuestList isVisible={isSheet} guests={event.guests} />
        </View>
    )
}

function GuestList({
    isVisible,
    guests,
}: {
    isVisible: boolean
    guests: CalendarEvents['guests']
}) {
    if (!isVisible) return null
    return <EventGuestList guests={guests} />
}

function EventDescription({ event }: { event: CalendarEvents }) {
    const { isSheet } = usePopoverContext()
    if (!event.description) return null
    return (
        <Text
            className="mt-1 mb-2 pl-0.5 text-muted-foreground"
            style={{ fontSize: 13 }}
            numberOfLines={isSheet ? undefined : 3}
        >
            {event.description}
        </Text>
    )
}
