import { useRouter } from 'expo-router'
import { BottomSheet, Button, useThemeColor } from 'heroui-native'
import { Users, X } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb'
import { Pressable, Text, View } from 'react-native'
import { useBreakpoint } from '~/components/workspace/useBreakpoint'
import { captureException } from '~/lib/errors'
import { mutation, useMutation } from '~/lib/mutations'
import { useOrgHref } from '~/lib/org-routes'
import { useStore } from '~/lib/pocketbase'
import { useCurrentUserOrg } from '~/lib/use-current-user-org'
import { useOrgInfo } from '~/lib/use-org-info'
import { TextInput, useForm, z, zodResolver } from '~/ui/form'
import { useVisibleCalendars } from '../hooks/useCalendarEvents'
import { getTimeLabel } from '../hooks/useCalendarNavigation'

const quickCreateSchema = z.object({
    title: z.string().min(1, 'Title is required'),
})

interface EventQuickCreateProps {
    isVisible: boolean
    initialDate: Date
    initialHour: number
    onClose: () => void
}

export function EventQuickCreate({
    isVisible,
    initialDate,
    initialHour,
    onClose,
}: EventQuickCreateProps) {
    const isMobile = useBreakpoint() === 'mobile'

    if (isMobile) {
        return (
            <MobileQuickCreate
                isVisible={isVisible}
                initialDate={initialDate}
                initialHour={initialHour}
                onClose={onClose}
            />
        )
    }

    return (
        <DesktopQuickCreate
            isVisible={isVisible}
            initialDate={initialDate}
            initialHour={initialHour}
            onClose={onClose}
        />
    )
}

function useQuickCreateForm(initialDate: Date, initialHour: number, onClose: () => void) {
    const { orgSlug } = useOrgInfo()
    const userOrg = useCurrentUserOrg(orgSlug)
    const { mineCalendars, calendars } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')

    const { control, handleSubmit, reset } = useForm({
        mode: 'onChange',
        resolver: zodResolver(quickCreateSchema),
        defaultValues: { title: '' },
    })

    const createEvent = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof quickCreateSchema>) {
            if (!userOrg) throw new Error('No organization context')
            const defaultCalendar = mineCalendars[0] ?? calendars[0]
            if (!defaultCalendar) throw new Error('No calendar available')

            const startDate = new Date(initialDate)
            startDate.setHours(initialHour, 0, 0, 0)
            const endDate = new Date(initialDate)
            endDate.setHours(initialHour + 1, 0, 0, 0)

            yield eventsCollection.insert({
                id: newRecordId(),
                calendar: defaultCalendar.id,
                created_by: userOrg.id,
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

function MobileQuickCreate({
    isVisible,
    initialDate,
    initialHour,
    onClose,
}: EventQuickCreateProps) {
    const mutedColor = useThemeColor('muted')
    const router = useRouter()
    const orgHref = useOrgHref()
    const { control, onSave, dayLabel, timeLabel } = useQuickCreateForm(
        initialDate,
        initialHour,
        onClose
    )

    const onMoreOptions = () => {
        onClose()
        router.push(orgHref('calendar/[id]', { id: 'new' }))
    }

    return (
        <BottomSheet isOpen={isVisible} onOpenChange={open => !open && onClose()}>
            <BottomSheet.Portal>
                <BottomSheet.Overlay />
                <BottomSheet.Content keyboardBehavior="interactive" keyboardBlurBehavior="restore">
                    <View style={{ padding: 20, gap: 12 }}>
                        <View
                            style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <Pressable onPress={onClose}>
                                <Text style={{ fontSize: 14, color: mutedColor }}>Cancel</Text>
                            </Pressable>
                            <Button onPress={onSave} size="sm">
                                Save
                            </Button>
                        </View>

                        <TextInput
                            control={control}
                            name="title"
                            placeholder="Add title"
                            autoFocus
                        />

                        <View style={{ gap: 4 }}>
                            <Text style={{ fontSize: 12, color: mutedColor }}>{dayLabel}</Text>
                            <Text style={{ fontSize: 12, color: mutedColor }}>{timeLabel}</Text>
                        </View>

                        <Pressable
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 10,
                                paddingVertical: 8,
                            }}
                            onPress={onMoreOptions}
                        >
                            <Users size={18} color={mutedColor} />
                            <Text style={{ fontSize: 14, color: mutedColor }}>Add guests</Text>
                        </Pressable>
                    </View>
                </BottomSheet.Content>
            </BottomSheet.Portal>
        </BottomSheet>
    )
}

function DesktopQuickCreate({
    isVisible,
    initialDate,
    initialHour,
    onClose,
}: EventQuickCreateProps) {
    const [fgColor, mutedColor, bgColor, borderColor, accentColor, shadowColor] = useThemeColor([
        'foreground',
        'muted',
        'background',
        'border',
        'accent',
        'overlay-backdrop',
    ])
    const router = useRouter()
    const orgHref = useOrgHref()
    const { control, onSave, dayLabel, timeLabel } = useQuickCreateForm(
        initialDate,
        initialHour,
        onClose
    )

    if (!isVisible) return null

    const onMoreOptions = () => {
        onClose()
        router.push(orgHref('calendar/[id]', { id: 'new' }))
    }

    return (
        <Pressable
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 100,
            }}
            onPress={onClose}
        >
            <Pressable
                style={{
                    width: 340,
                    borderRadius: 12,
                    borderWidth: 1,
                    padding: 16,
                    backgroundColor: bgColor,
                    borderColor,
                    shadowColor,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.15,
                    shadowRadius: 12,
                    elevation: 8,
                }}
                onPress={e => e.stopPropagation()}
            >
                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <Text style={{ fontSize: 16, fontWeight: '600', color: fgColor }}>
                        New Event
                    </Text>
                    <Pressable onPress={onClose} hitSlop={8}>
                        <X size={18} color={mutedColor} />
                    </Pressable>
                </View>

                <View style={{ gap: 12, paddingVertical: 8 }}>
                    <TextInput control={control} name="title" placeholder="Add title" autoFocus />

                    <View style={{ gap: 4 }}>
                        <Text style={{ fontSize: 12, color: mutedColor }}>{dayLabel}</Text>
                        <Text style={{ fontSize: 12, color: mutedColor }}>{timeLabel}</Text>
                    </View>
                </View>

                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 8,
                    }}
                >
                    <Pressable onPress={onMoreOptions}>
                        <Text style={{ fontSize: 12, color: accentColor }}>More options</Text>
                    </Pressable>
                    <Button onPress={onSave} size="sm">
                        Save
                    </Button>
                </View>
            </Pressable>
        </Pressable>
    )
}
