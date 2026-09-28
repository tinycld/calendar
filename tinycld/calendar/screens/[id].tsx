import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useAuth } from '@tinycld/core/lib/auth'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { router, useGlobalSearchParams, useLocalSearchParams } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { useMemo, useRef } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { EventForm } from '../components/EventForm'
import { EventGuestList } from '../components/EventGuestList'
import { useVisibleCalendars } from '../hooks/useCalendarEvents'
import { calendarReturnParams } from '../lib/editor-return'
import { parseEventId } from '../lib/recurrence'

const eventSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string(),
    location: z.string(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format'),
    all_day: z.boolean(),
    recurrence: z.string(),
    calendar: z.string(),
    busy_status: z.enum(['busy', 'free']),
    visibility: z.enum(['default', 'public', 'private']),
    reminderMinutes: z.number(),
})

function combineDateAndTime(dateStr: string, timeStr: string): string {
    return new Date(`${dateStr}T${timeStr}:00`).toISOString()
}

// Rounds a Date forward to the next full half-hour. Seconds and ms cleared
// so the form fields show clean HH:00 / HH:30 values.
function nextHalfHour(d: Date): Date {
    const out = new Date(d)
    out.setSeconds(0, 0)
    const minutes = out.getMinutes()
    const target = minutes < 30 ? 30 : 60
    out.setMinutes(target)
    return out
}

type EventFormValues = z.infer<typeof eventSchema>

interface FormSeedSource {
    event:
        | {
              title: string
              description: string
              location: string
              all_day: boolean
              recurrence: string
              calendar: string
              busy_status: EventFormValues['busy_status']
              visibility: EventFormValues['visibility']
              reminder: number
          }
        | undefined
    startDate: Date
    endDate: Date
    defaultCalendar: string
}

// The form's initial field values, for an edit (from the row) or a create
// (empty, in the resolved default calendar). Pure, so the caller can rebuild
// it only when something it reads has actually changed.
function buildFormSeed({
    event,
    startDate,
    endDate,
    defaultCalendar,
}: FormSeedSource): EventFormValues {
    const dates = {
        startDate: startDate.toISOString().split('T')[0],
        startTime: startDate.toTimeString().slice(0, 5),
        endDate: endDate.toISOString().split('T')[0],
        endTime: endDate.toTimeString().slice(0, 5),
    }
    if (!event) {
        return {
            title: '',
            description: '',
            location: '',
            ...dates,
            all_day: false,
            recurrence: '',
            calendar: defaultCalendar,
            busy_status: 'busy',
            visibility: 'default',
            reminderMinutes: 30,
        }
    }
    return {
        title: event.title,
        description: event.description,
        location: event.location,
        ...dates,
        all_day: event.all_day,
        recurrence: event.recurrence,
        calendar: event.calendar,
        busy_status: event.busy_status,
        visibility: event.visibility,
        reminderMinutes: event.reminder,
    }
}

export default function EventEditorScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const orgHref = useOrgHref()
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const breakpoint = useBreakpoint()
    const { user } = useAuth()
    const { calendars, mineCalendars, calendarMap } = useVisibleCalendars()
    const [eventsCollection] = useStore('calendar_events')
    const navigateBack = useNavigateBack(() => orgHref('calendar'))
    // The calendar's view mode and focused date live in the URL, and every
    // create entry point passes them into this route's push (see
    // lib/editor-return.ts). Read them globally rather than locally so they
    // resolve from any depth, and reflect them back on the return below.
    const { view, date } = useGlobalSearchParams<{ view?: string; date?: string }>()

    // After a create, go to the calendar explicitly rather than popping.
    //
    // The editor is reached by a `router.push` from the sidebar's "+ Create",
    // and that push is not always committed by the time the user saves — the
    // spec's own retry loop around "+ Create" exists because of the same
    // window. `router.back()` against a half-committed stack walks to
    // whatever is below the calendar route instead of the calendar itself,
    // leaving the editor mounted over the wrong screen: the event is saved,
    // and the UI says nothing happened. A create always ends at the calendar,
    // so name it rather than inferring it from history.
    //
    // Naming it means carrying `view` and `date` along: every create entry
    // point pushes from the calendar screen, so dropping them would land
    // someone who created an event from Month view on a distant date back on
    // Week view at today — nowhere near the event they just made.
    const afterCreate = () =>
        router.replace(orgHref('calendar', calendarReturnParams({ view, date })))

    const { baseId } = parseEventId(id ?? '')
    const isNew = !id || id === 'new'
    const lookupId = isNew ? '' : baseId

    const { data: existingEvents } = useLiveQuery({
        query: query => {
            if (!lookupId) return null
            return query.from({ evt: eventsCollection }).where(({ evt }) => eq(evt.id, lookupId))
        },
    })
    const event = existingEvents?.[0]

    // For new events, default start to the next half-hour and end to one
    // hour later — a common-sense default that avoids the zero-duration
    // start==end footgun (a fresh `new Date()` for both fields produces
    // two identical timestamps because they're computed in the same render).
    //
    // Frozen on mount. `new Date()` answers differently on every render, so
    // reading it inline made the seed below differ every render too — see the
    // seed's comment for why that is not merely wasteful.
    const newEventClock = useMemo(() => {
        const start = nextHalfHour(new Date())
        return { start, end: new Date(start.getTime() + 60 * 60 * 1000) }
    }, [])
    const startDate = event ? new Date(event.start) : newEventClock.start
    const endDate = event ? new Date(event.end) : newEventClock.end

    const defaultCalendar = mineCalendars[0]?.id ?? calendars[0]?.id ?? ''

    // The form's seed.
    //
    // `values`, not `defaultValues`, because for a new event the calendar
    // resolves a few renders after mount and a form seeded with an empty
    // calendar submits a required relation empty — PocketBase answers 400.
    //
    // But `values` has to be referentially stable across renders that change
    // nothing. React Hook Form deep-compares it against the last one it saw
    // and runs a full `control._reset` whenever it differs, so a seed rebuilt
    // every render resets the form continuously. It did: the new-event branch
    // read `new Date()` during render. Under eager sync the calendars landed
    // before the form opened and nobody noticed; under on-demand sync they
    // arrive late, so the resets fall while the user is submitting. That left
    // the router half-committed — `router.back()` walked to a different route
    // with the editor still mounted, so a saved event looked like it had
    // never been saved, even though the write returned 200.
    //
    // The memo is keyed on a serialization of exactly what the seed reads.
    // Keying on `event` itself would not hold: it is a row from a live query,
    // so its identity changes on every sync tick even when nothing it
    // contains has.
    const seedSource = {
        event,
        startDate,
        endDate,
        defaultCalendar,
    }
    const seedKey = JSON.stringify([
        event?.id,
        event?.title,
        event?.description,
        event?.location,
        event?.all_day,
        event?.recurrence,
        event?.calendar,
        event?.busy_status,
        event?.visibility,
        event?.reminder,
        startDate.getTime(),
        endDate.getTime(),
        defaultCalendar,
    ])
    const seedRef = useRef<{ key: string; value: EventFormValues } | null>(null)
    if (seedRef.current?.key !== seedKey) {
        seedRef.current = { key: seedKey, value: buildFormSeed(seedSource) }
    }
    const formSeed = seedRef.current.value

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        watch,
        formState: { errors, isSubmitted },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(eventSchema),
        values: formSeed,
    })

    const startDateValue = watch('startDate')

    const createEvent = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof eventSchema>) {
            yield eventsCollection.insert({
                id: newRecordId(),
                calendar: data.calendar,
                created_by: user.id,
                title: data.title.trim(),
                description: data.description,
                location: data.location,
                start: combineDateAndTime(data.startDate, data.startTime),
                end: combineDateAndTime(data.endDate, data.endTime),
                all_day: data.all_day,
                recurrence: data.recurrence,
                guests: [],
                reminder: data.reminderMinutes,
                busy_status: data.busy_status,
                visibility: data.visibility,
                ical_uid: '',
                from_subscription: false,
            })
        }),
        onSuccess: afterCreate,
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const updateEvent = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof eventSchema>) {
            yield eventsCollection.update(baseId, draft => {
                draft.title = data.title.trim()
                draft.description = data.description
                draft.location = data.location
                draft.start = combineDateAndTime(data.startDate, data.startTime)
                draft.end = combineDateAndTime(data.endDate, data.endTime)
                draft.all_day = data.all_day
                draft.recurrence = data.recurrence
                draft.calendar = data.calendar
                draft.reminder = data.reminderMinutes
                draft.busy_status = data.busy_status
                draft.visibility = data.visibility
            })
        }),
        onSuccess: navigateBack,
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const isLoadingEvent = !isNew && !existingEvents
    const isNotFound = !isNew && existingEvents && !event
    const eventCalendar = event ? calendarMap.get(event.calendar) : undefined
    const isReadOnly = !!eventCalendar?.subscription_url

    if (!isNew && isReadOnly) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <DocumentTitle pkg="Calendar" title={event?.title} />
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    Events from subscribed calendars cannot be edited
                </Text>
                <Pressable
                    onPress={navigateBack}
                    className="mt-3 px-3 py-1.5 rounded-md border"
                    style={{ borderColor: mutedColor }}
                >
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Go back
                    </Text>
                </Pressable>
            </View>
        )
    }

    if (isNotFound) {
        return (
            <View className="flex-1 items-center justify-center bg-background">
                <DocumentTitle pkg="Calendar" />
                <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                    Event not found
                </Text>
                <Pressable
                    onPress={navigateBack}
                    className="mt-3 px-3 py-1.5 rounded-md border"
                    style={{
                        borderColor: mutedColor,
                    }}
                >
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Go back
                    </Text>
                </Pressable>
            </View>
        )
    }

    const activeMutation = isNew ? createEvent : updateEvent
    const onSubmit = handleSubmit(data => activeMutation.mutate(data))
    const calendarValue = watch('calendar')
    // For new events, the calendar field is populated from defaultCalendar
    // once the live query resolves. Submitting before that yields a 400
    // because `calendar` is a required relation in the PB schema.
    const canSubmit = !activeMutation.isPending && !isLoadingEvent && !!calendarValue

    const isDesktop = breakpoint === 'desktop'
    const guests = event?.guests ?? []

    const formContent = (
        <EventForm
            control={control}
            errors={errors}
            isSubmitted={isSubmitted}
            calendars={calendars}
            startDateValue={startDateValue}
        />
    )

    const guestContent = <EventGuestList guests={guests} />

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 bg-background"
        >
            <DocumentTitle pkg="Calendar" title={isNew ? 'New event' : event?.title} />
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
                <View className="flex-1 p-5">
                    <View className="flex-row justify-between items-center mb-5">
                        <View className="flex-row gap-3 items-center">
                            <Pressable onPress={navigateBack}>
                                <ArrowLeft size={24} color={fgColor} />
                            </Pressable>
                            <Text
                                className="text-foreground"
                                style={{ fontSize: 24, fontWeight: 'bold' }}
                            >
                                {event ? 'Edit Event' : 'New Event'}
                            </Text>
                        </View>
                        <Button onPress={onSubmit} isDisabled={!canSubmit} size="sm">
                            <ButtonText>
                                {activeMutation.isPending ? 'Saving...' : 'Save'}
                            </ButtonText>
                        </Button>
                    </View>

                    {isDesktop ? (
                        <View className="flex-row gap-5 flex-1">
                            <View className="flex-[2]">{formContent}</View>
                            <View className="flex-1">{guestContent}</View>
                        </View>
                    ) : (
                        <View className="gap-4">
                            {formContent}
                            {guestContent}
                        </View>
                    )}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    )
}
