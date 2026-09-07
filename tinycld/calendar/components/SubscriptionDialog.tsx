import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { Dialog } from '@tinycld/core/ui/dialog'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { newRecordId } from 'pbtsdb/core'
import { CALENDAR_COLOR_KEYS } from './calendar-colors'

const subscriptionSchema = z.object({
    url: z
        .string()
        .min(1, 'URL is required')
        .refine(
            val =>
                val.startsWith('http://') ||
                val.startsWith('https://') ||
                val.startsWith('webcal://'),
            'Must be an HTTP(S) or webcal:// URL'
        ),
    name: z.string().min(1, 'Name is required'),
})

interface SubscriptionDialogProps {
    open: boolean
    onClose: () => void
}

export function SubscriptionDialog({ open, onClose }: SubscriptionDialogProps) {
    const [calendarsCollection] = useStore('calendar_calendars')

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        reset,
        formState: { errors, isSubmitted },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(subscriptionSchema),
        defaultValues: {
            url: '',
            name: '',
        },
    })

    const createSubscription = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof subscriptionSchema>) {
            const randomColor =
                CALENDAR_COLOR_KEYS[Math.floor(Math.random() * CALENDAR_COLOR_KEYS.length)]
            yield calendarsCollection.insert({
                id: newRecordId(),
                name: data.name,
                description: '',
                color: randomColor,
                subscription_url: data.url,
                subscription_last_sync: '',
                subscription_error: '',
            })
        }),
        onSuccess: () => {
            reset()
            onClose()
        },
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit(data => createSubscription.mutate(data))

    const handleClose = () => {
        reset()
        onClose()
    }

    return (
        <Dialog isOpen={open} onClose={handleClose} title="Subscribe to calendar" size="md">
            <Dialog.Body>
                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

                <TextInput
                    control={control}
                    name="url"
                    label="Calendar URL"
                    placeholder="https://example.com/calendar.ics"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                />

                <TextInput
                    control={control}
                    name="name"
                    label="Calendar name"
                    placeholder="US Holidays"
                />
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={handleClose} />
                <Dialog.ActionButton
                    label={createSubscription.isPending ? 'Subscribing...' : 'Subscribe'}
                    onPress={onSubmit}
                    isDisabled={createSubscription.isPending}
                />
            </Dialog.Footer>
        </Dialog>
    )
}
