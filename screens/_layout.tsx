import { Slot } from 'expo-router'
import { View } from 'react-native'
import { ScreenHeader } from '~/components/ScreenHeader'
import { useBreakpoint } from '~/components/workspace/useBreakpoint'
import { captureException } from '~/lib/errors'
import { mutation, useMutation } from '~/lib/mutations'
import { useStore } from '~/lib/pocketbase'
import { useThemeColor } from '~/lib/use-app-theme'
import { CalendarFAB } from '../components/CalendarFAB'
import { CalendarHeader } from '../components/CalendarHeader'
import { EventDetailPopover } from '../components/EventDetailPopover'
import { EventQuickCreate } from '../components/EventQuickCreate'
import { useEventDetail } from '../hooks/useCalendarEvents'
import { CalendarViewProvider, useCalendarView } from '../hooks/useCalendarView'

function CalendarLayoutInner() {
    const { popover, closePopover } = useCalendarView()
    const isMobile = useBreakpoint() === 'mobile'
    const [eventsCollection] = useStore('calendar_events')
    const bgColor = useThemeColor('background')

    const eventId = popover.type === 'event-detail' ? popover.eventId : undefined
    const { event, calendar } = useEventDetail(eventId)

    const deleteEvent = useMutation({
        mutationFn: mutation(function* (eventId: string) {
            yield eventsCollection.delete(eventId)
        }),
        onError: error => captureException('CalendarDeleteEvent', error),
    })

    return (
        <View style={{ flex: 1, backgroundColor: bgColor }}>
            <ScreenHeader>
                <CalendarHeader />
            </ScreenHeader>
            <View style={{ flex: 1 }}>
                <Slot />
            </View>

            <CalendarFAB isVisible={isMobile} />

            <EventQuickCreate
                isVisible={popover.type === 'quick-create'}
                initialDate={popover.type === 'quick-create' ? popover.date : new Date()}
                initialHour={popover.type === 'quick-create' ? popover.hour : 9}
                onClose={closePopover}
            />

            <EventDetailPopover
                isVisible={popover.type === 'event-detail'}
                event={event}
                calendarName={calendar?.name ?? ''}
                calendarColorKey={calendar?.color ?? 'blue'}
                anchorRect={popover.type === 'event-detail' ? popover.anchorRect : undefined}
                onClose={closePopover}
                onDelete={id => deleteEvent.mutate(id)}
            />
        </View>
    )
}

export default function CalendarLayout() {
    return (
        <CalendarViewProvider>
            <CalendarLayoutInner />
        </CalendarViewProvider>
    )
}
