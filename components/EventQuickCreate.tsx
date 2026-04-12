import { useRouter } from 'expo-router'
import { Users, X } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb'
import { Pressable } from 'react-native'
import { Button, SizableText, useTheme, XStack, YStack } from 'tamagui'
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
    const theme = useTheme()
    const router = useRouter()
    const orgHref = useOrgHref()
    const isMobile = useBreakpoint() === 'mobile'
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

    if (!isVisible) return null

    const dayLabel = initialDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    })
    const endHour = (initialHour + 1) % 24
    const timeLabel = `${getTimeLabel(initialHour)} – ${getTimeLabel(endHour)}`

    const onSave = handleSubmit(data => createEvent.mutate(data))

    const onMoreOptions = () => {
        onClose()
        router.push(orgHref('calendar/[id]', { id: 'new' }))
    }

    if (isMobile) {
        return (
            <Pressable
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    justifyContent: 'flex-end',
                    zIndex: 100,
                    backgroundColor: 'rgba(0,0,0,0.3)',
                }}
                onPress={onClose}
            >
                <Pressable
                    style={{
                        width: '100%',
                        borderTopLeftRadius: 16,
                        borderTopRightRadius: 16,
                        padding: 20,
                        backgroundColor: theme.background.val,
                        shadowColor: theme.shadowColor.val,
                        shadowOffset: { width: 0, height: -2 },
                        shadowOpacity: 0.15,
                        shadowRadius: 8,
                        elevation: 8,
                    }}
                    onPress={e => e.stopPropagation()}
                >
                    <XStack justifyContent="space-between" alignItems="center" marginBottom="$3">
                        <Pressable onPress={onClose}>
                            <SizableText size="$3" color="$color8">
                                Cancel
                            </SizableText>
                        </Pressable>
                        <Button theme="accent" size="$3" onPress={onSave}>
                            <Button.Text fontWeight="600">Save</Button.Text>
                        </Button>
                    </XStack>

                    <YStack gap="$3">
                        <TextInput
                            control={control}
                            name="title"
                            placeholder="Add title"
                            autoFocus
                        />

                        <YStack gap="$1">
                            <SizableText size="$2" color="$color8">
                                {dayLabel}
                            </SizableText>
                            <SizableText size="$2" color="$color8">
                                {timeLabel}
                            </SizableText>
                        </YStack>

                        <Pressable
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 10,
                                paddingVertical: 8,
                            }}
                            onPress={onMoreOptions}
                        >
                            <Users size={18} color={theme.color8.val} />
                            <SizableText size="$3" color="$color8">
                                Add guests
                            </SizableText>
                        </Pressable>
                    </YStack>
                </Pressable>
            </Pressable>
        )
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
                    backgroundColor: theme.background.val,
                    borderColor: theme.borderColor.val,
                    shadowColor: theme.shadowColor.val,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.15,
                    shadowRadius: 12,
                    elevation: 8,
                }}
                onPress={e => e.stopPropagation()}
            >
                <XStack justifyContent="space-between" alignItems="center">
                    <SizableText size="$4" fontWeight="600" color="$color">
                        New Event
                    </SizableText>
                    <Pressable onPress={onClose} hitSlop={8}>
                        <X size={18} color={theme.color8.val} />
                    </Pressable>
                </XStack>

                <YStack gap="$3" paddingVertical="$2">
                    <TextInput control={control} name="title" placeholder="Add title" autoFocus />

                    <YStack gap="$1">
                        <SizableText size="$2" color="$color8">
                            {dayLabel}
                        </SizableText>
                        <SizableText size="$2" color="$color8">
                            {timeLabel}
                        </SizableText>
                    </YStack>
                </YStack>

                <XStack justifyContent="space-between" alignItems="center" marginTop={8}>
                    <Pressable onPress={onMoreOptions}>
                        <SizableText size="$2" color="$accentBackground">
                            More options
                        </SizableText>
                    </Pressable>
                    <Button theme="accent" size="$3" onPress={onSave}>
                        <Button.Text fontWeight="600">Save</Button.Text>
                    </Button>
                </XStack>
            </Pressable>
        </Pressable>
    )
}
