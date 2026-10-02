import { useAuth } from '@tinycld/core/lib/auth'
import { captureException } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Dialog } from '@tinycld/core/ui/dialog'
import { TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useGlobalSearchParams, useRouter } from 'expo-router'
import { Users } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { Pressable, Text, View } from 'react-native'
import { useVisibleCalendars } from '../hooks/useCalendarEvents'
import { getTimeLabel } from '../hooks/useCalendarNavigation'
import { eventEditorParams } from '../lib/editor-return'

const quickCreateSchema = z.object({
    title: z.string().min(1, 'Title is required'),
})

interface EventQuickCreateProps {
    isVisible: boolean
    initialDate: Date
    initialHour: number
    onClose: () => void
}

/**
 * A core Dialog: on desktop and tablet its backdrop covers the whole app, so a
 * press anywhere outside it — the grid, the sidebar, the rail — closes it; on
 * the mobile breakpoint it becomes a sheet.
 */
export function EventQuickCreate({
    isVisible,
    initialDate,
    initialHour,
    onClose,
}: EventQuickCreateProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const { control, onSave, dayLabel, timeLabel } = useQuickCreateForm(
        initialDate,
        initialHour,
        onClose
    )
    const onMoreOptions = useMoreOptions(onClose)

    return (
        <Dialog isOpen={isVisible} onClose={onClose} title="New Event">
            <Dialog.Body>
                <TextInput control={control} name="title" placeholder="Add title" autoFocus />

                <View className="gap-1">
                    <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                        {dayLabel}
                    </Text>
                    <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                        {timeLabel}
                    </Text>
                </View>

                <Pressable className="flex-row items-center gap-2.5 py-1" onPress={onMoreOptions}>
                    <Users size={16} color={mutedColor} />
                    <Text className="text-primary" style={{ fontSize: 13 }}>
                        More options
                    </Text>
                </Pressable>
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={onClose} />
                <Dialog.ActionButton label="Save" onPress={onSave} />
            </Dialog.Footer>
        </Dialog>
    )
}

function useQuickCreateForm(initialDate: Date, initialHour: number, onClose: () => void) {
    const { user } = useAuth()
    const { mineCalendars, calendars } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')

    const { control, handleSubmit, reset } = useForm({
        mode: 'onChange',
        resolver: zodResolver(quickCreateSchema),
        defaultValues: { title: '' },
    })

    const createEvent = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof quickCreateSchema>) {
            const defaultCalendar = mineCalendars[0] ?? calendars[0]
            if (!defaultCalendar) throw new Error('No calendar available')

            const startDate = new Date(initialDate)
            startDate.setHours(initialHour, 0, 0, 0)
            const endDate = new Date(initialDate)
            endDate.setHours(initialHour + 1, 0, 0, 0)

            yield eventsCollection.insert({
                id: newRecordId(),
                calendar: defaultCalendar.id,
                created_by: user.id,
                title: data.title,
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                all_day: false,
                description: '',
                location: '',
                recurrence: '',
                guests: [],
                reminder: 30,
                busy_status: 'busy',
                visibility: 'default',
                ical_uid: '',
                from_subscription: false,
            })
        }),
        onSuccess: () => {
            reset()
            onClose()
        },
        onError: error => captureException('EventQuickCreate', error),
    })

    const dayLabel = initialDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
    const endHour = (initialHour + 1) % 24
    const timeLabel = `${getTimeLabel(initialHour)} – ${getTimeLabel(endHour)}`

    const onSave = handleSubmit(data => createEvent.mutate(data))

    return { control, onSave, dayLabel, timeLabel }
}

/**
 * "More options" leaves the popover for the full editor. The calendar's
 * view/date live in the URL — read them globally so they resolve from any
 * depth — and carry them into the push, so the editor can return to the same
 * view and date after the create.
 */
function useMoreOptions(onClose: () => void) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const { view, date } = useGlobalSearchParams<{ view?: string; date?: string }>()

    return () => {
        onClose()
        router.push(orgHref('calendar/[id]', eventEditorParams('new', { view, date })))
    }
}
