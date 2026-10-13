import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Dialog } from '@tinycld/core/ui/dialog'
import { Controller, useForm, zodResolver } from '@tinycld/core/ui/form'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useState } from 'react'
import { type Control, useController, useWatch } from 'react-hook-form'
import { Pressable, Text, View } from 'react-native'
import {
    buildCustomRRule,
    type CustomRecurrence,
    type CustomRecurrenceFormValues,
    customRecurrenceDefaults,
    customRecurrenceSchema,
    DAY_CODES,
} from '../lib/custom-recurrence'
import { describeRRule, getContextualPresets, getWeekdayPosition } from '../lib/recurrence'

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const FREQ_OPTIONS = [
    { label: 'day', value: 'DAILY' as const },
    { label: 'week', value: 'WEEKLY' as const },
    { label: 'month', value: 'MONTHLY' as const },
    { label: 'year', value: 'YEARLY' as const },
]

interface RecurrencePickerProps {
    value: string
    onChange: (rrule: string) => void
    eventStartDate: Date
}

export function RecurrencePicker({ value, onChange, eventStartDate }: RecurrencePickerProps) {
    const [showCustom, setShowCustom] = useState(false)
    const [showPresets, setShowPresets] = useState(false)
    const presets = getContextualPresets(eventStartDate)

    const displayLabel = value ? describeRRule(value, eventStartDate) : 'Does not repeat'

    const isPresetValue = presets.some(p => p.value === value)

    const handlePresetSelect = (preset: string) => {
        setShowPresets(false)
        if (preset === '__custom__') {
            setShowCustom(true)
        } else {
            onChange(preset)
        }
    }

    return (
        <View className="gap-1.5 mb-3">
            <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                Recurrence
            </Text>
            <Pressable
                onPress={() => setShowPresets(true)}
                className="border border-border bg-background rounded-lg px-3 py-2.5"
            >
                <Text
                    className={value ? 'text-foreground' : 'text-muted-foreground'}
                    style={{ fontSize: 14 }}
                >
                    {displayLabel}
                </Text>
            </Pressable>

            <PresetDialog
                open={showPresets}
                onOpenChange={setShowPresets}
                presets={presets}
                currentValue={value}
                onSelect={handlePresetSelect}
            />

            <CustomRecurrenceDialog
                open={showCustom}
                onOpenChange={setShowCustom}
                eventStartDate={eventStartDate}
                initialValue={isPresetValue ? undefined : value}
                onSave={onChange}
            />
        </View>
    )
}

function PresetDialog({
    open,
    onOpenChange,
    presets,
    currentValue,
    onSelect,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    presets: { label: string; value: string }[]
    currentValue: string
    onSelect: (value: string) => void
}) {
    return (
        <Dialog isOpen={open} onClose={() => onOpenChange(false)} title="Repeat" size="sm">
            <Dialog.Body contentClassName="px-3 pb-3 gap-1">
                {presets.map(preset => (
                    <PresetRow
                        key={preset.value || 'none'}
                        label={preset.label}
                        isSelected={preset.value === currentValue}
                        onPress={() => onSelect(preset.value)}
                    />
                ))}
            </Dialog.Body>
        </Dialog>
    )
}

function PresetRow({
    label,
    isSelected,
    onPress,
}: {
    label: string
    isSelected: boolean
    onPress: () => void
}) {
    const accentColor = useThemeColor('accent')
    return (
        <Pressable
            onPress={onPress}
            className="px-3 py-2.5 rounded-md"
            style={isSelected ? { backgroundColor: `${accentColor}20` } : undefined}
        >
            <Text
                className={isSelected ? 'text-accent-foreground' : 'text-foreground'}
                style={{ fontSize: 14, fontWeight: isSelected ? '600' : '400' }}
            >
                {label}
            </Text>
        </Pressable>
    )
}

function useCustomRecurrenceForm({
    eventStartDate,
    initialValue,
    onSave,
    onOpenChange,
}: {
    eventStartDate: Date
    initialValue?: string
    onSave: (rrule: string) => void
    onOpenChange: (open: boolean) => void
}) {
    const form = useForm<CustomRecurrenceFormValues, unknown, CustomRecurrence>({
        mode: 'onChange',
        resolver: zodResolver(customRecurrenceSchema),
        defaultValues: customRecurrenceDefaults(eventStartDate, initialValue),
    })
    const { control, setValue, getValues, handleSubmit, formState } = form
    const [freq, interval, byDay, endType] = useWatch({
        control,
        name: ['freq', 'interval', 'byDay', 'endType'],
    })

    const touch = { shouldValidate: true, shouldDirty: true }

    // The steppers only offer values inside the schema's range; the schema
    // stays the rule.
    const stepInterval = (delta: number) =>
        setValue('interval', Math.min(Math.max(getValues('interval') + delta, 1), 99), touch)
    const stepCount = (delta: number) =>
        setValue('count', Math.min(Math.max(getValues('count') + delta, 1), 999), touch)

    const toggleDay = (day: string) => {
        const current = getValues('byDay')
        const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day]
        setValue('byDay', next, touch)
    }

    const setFreq = (value: CustomRecurrenceFormValues['freq']) => setValue('freq', value, touch)
    const setEndType = (value: CustomRecurrenceFormValues['endType']) =>
        setValue('endType', value, touch)

    const onDone = handleSubmit(values => {
        onSave(buildCustomRRule(values, eventStartDate))
        onOpenChange(false)
    })

    return {
        control,
        errors: formState.errors,
        freq,
        interval,
        byDay,
        endType,
        setFreq,
        setEndType,
        stepInterval,
        stepCount,
        toggleDay,
        onDone,
    }
}

function CustomRecurrenceDialog({
    open,
    onOpenChange,
    eventStartDate,
    initialValue,
    onSave,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    eventStartDate: Date
    initialValue?: string
    onSave: (rrule: string) => void
}) {
    const borderColor = useThemeColor('border')
    const primaryColor = useThemeColor('primary')
    const form = useCustomRecurrenceForm({ eventStartDate, initialValue, onSave, onOpenChange })

    return (
        <Dialog
            isOpen={open}
            onClose={() => onOpenChange(false)}
            title="Custom recurrence"
            size="sm"
        >
            <Dialog.Body>
                <View className="flex-row items-center gap-2">
                    <Text className="text-foreground" style={{ fontSize: 14 }}>
                        Repeat every
                    </Text>
                    <Pressable
                        onPress={() => form.stepInterval(1)}
                        onLongPress={() => form.stepInterval(-1)}
                        className="border border-border rounded-md w-[44px] h-[36px] items-center justify-center"
                    >
                        <Text
                            className="text-foreground"
                            style={{ fontSize: 14, textAlign: 'center' }}
                        >
                            {form.interval}
                        </Text>
                    </Pressable>
                    <View className="flex-row gap-1 flex-wrap flex-1">
                        {FREQ_OPTIONS.map(opt => {
                            const isSelected = form.freq === opt.value
                            return (
                                <Pressable
                                    key={opt.value}
                                    onPress={() => form.setFreq(opt.value)}
                                    className={`px-2.5 py-1 rounded-md border ${isSelected ? 'bg-primary' : ''}`}
                                    style={{
                                        borderColor: isSelected ? primaryColor : borderColor,
                                    }}
                                >
                                    <Text
                                        className={
                                            isSelected
                                                ? 'text-primary-foreground'
                                                : 'text-foreground'
                                        }
                                        style={{ fontSize: 12 }}
                                    >
                                        {form.interval > 1 ? `${opt.label}s` : opt.label}
                                    </Text>
                                </Pressable>
                            )
                        })}
                    </View>
                </View>
                <FieldError message={form.errors.interval?.message} />

                <WeekDaySelector
                    isVisible={form.freq === 'WEEKLY'}
                    selectedDays={form.byDay}
                    onToggle={form.toggleDay}
                    error={form.errors.byDay?.message}
                />

                <Controller
                    control={form.control}
                    name="monthlyMode"
                    render={({ field }) => (
                        <MonthlyModeSelector
                            isVisible={form.freq === 'MONTHLY'}
                            monthlyMode={field.value}
                            eventStartDate={eventStartDate}
                            onChange={field.onChange}
                        />
                    )}
                />

                <View className="gap-2">
                    <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                        Ends
                    </Text>
                    <View className="flex-row gap-2 flex-wrap">
                        {(['never', 'on', 'after'] as const).map(type => {
                            const isSelected = form.endType === type
                            const label =
                                type === 'never' ? 'Never' : type === 'on' ? 'On date' : 'After'
                            return (
                                <Pressable
                                    key={type}
                                    onPress={() => form.setEndType(type)}
                                    className={`px-2.5 py-1 rounded-md border ${isSelected ? 'bg-primary' : ''}`}
                                    style={{
                                        borderColor: isSelected ? primaryColor : borderColor,
                                    }}
                                >
                                    <Text
                                        className={
                                            isSelected
                                                ? 'text-primary-foreground'
                                                : 'text-foreground'
                                        }
                                        style={{ fontSize: 12 }}
                                    >
                                        {label}
                                    </Text>
                                </Pressable>
                            )
                        })}
                    </View>

                    <EndDateInput isVisible={form.endType === 'on'} control={form.control} />

                    <Controller
                        control={form.control}
                        name="count"
                        render={({ field, fieldState }) => (
                            <EndCountInput
                                isVisible={form.endType === 'after'}
                                value={field.value}
                                onIncrement={() => form.stepCount(1)}
                                onDecrement={() => form.stepCount(-1)}
                                error={fieldState.error?.message}
                            />
                        )}
                    />
                </View>
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={() => onOpenChange(false)} />
                <Dialog.ActionButton label="Done" onPress={form.onDone} requiresServer={false} />
            </Dialog.Footer>
        </Dialog>
    )
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null
    return <Text className="text-xs text-danger">{message}</Text>
}

function WeekDaySelector({
    isVisible,
    selectedDays,
    onToggle,
    error,
}: {
    isVisible: boolean
    selectedDays: string[]
    onToggle: (day: string) => void
    error?: string
}) {
    const borderColor = useThemeColor('border')
    const primaryColor = useThemeColor('primary')

    if (!isVisible) return null

    return (
        <View className="gap-1.5">
            <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                Repeat on
            </Text>
            <View className="flex-row gap-1.5 justify-center">
                {DAY_CODES.map((code, i) => {
                    const isSelected = selectedDays.includes(code)
                    return (
                        <Pressable
                            key={code}
                            onPress={() => onToggle(code)}
                            className={`size-9 rounded-full border items-center justify-center ${isSelected ? 'bg-primary' : ''}`}
                            style={{
                                borderColor: isSelected ? primaryColor : borderColor,
                            }}
                        >
                            <Text
                                className={isSelected ? 'text-white' : 'text-foreground'}
                                style={{ fontSize: 12, fontWeight: isSelected ? '600' : '400' }}
                            >
                                {DAY_LABELS[i]}
                            </Text>
                        </Pressable>
                    )
                })}
            </View>
            <FieldError message={error} />
        </View>
    )
}

function MonthlyModeSelector({
    isVisible,
    monthlyMode,
    eventStartDate,
    onChange,
}: {
    isVisible: boolean
    monthlyMode: 'dayOfMonth' | 'dayOfWeek'
    eventStartDate: Date
    onChange: (mode: 'dayOfMonth' | 'dayOfWeek') => void
}) {
    const borderColor = useThemeColor('border')
    const primaryColor = useThemeColor('primary')

    if (!isVisible) return null

    const dayOfMonth = eventStartDate.getDate()
    const { position } = getWeekdayPosition(eventStartDate)
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayName = dayNames[eventStartDate.getDay()]
    const ordinals = ['', 'first', 'second', 'third', 'fourth', 'fifth']
    const ordinal = ordinals[position] ?? `${position}th`

    return (
        <View className="gap-1.5">
            <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                Monthly on
            </Text>
            <View className="flex-row gap-2">
                <Pressable
                    onPress={() => onChange('dayOfMonth')}
                    className={`px-2.5 py-1 rounded-md border ${monthlyMode === 'dayOfMonth' ? 'bg-primary' : ''}`}
                    style={{
                        borderColor: monthlyMode === 'dayOfMonth' ? primaryColor : borderColor,
                    }}
                >
                    <Text
                        className={
                            monthlyMode === 'dayOfMonth'
                                ? 'text-primary-foreground'
                                : 'text-foreground'
                        }
                        style={{ fontSize: 12 }}
                    >
                        Day {dayOfMonth}
                    </Text>
                </Pressable>
                <Pressable
                    onPress={() => onChange('dayOfWeek')}
                    className={`px-2.5 py-1 rounded-md border ${monthlyMode === 'dayOfWeek' ? 'bg-primary' : ''}`}
                    style={{
                        borderColor: monthlyMode === 'dayOfWeek' ? primaryColor : borderColor,
                    }}
                >
                    <Text
                        className={
                            monthlyMode === 'dayOfWeek'
                                ? 'text-primary-foreground'
                                : 'text-foreground'
                        }
                        style={{ fontSize: 12 }}
                    >
                        {ordinal} {dayName}
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}

function EndDateInput({
    isVisible,
    control,
}: {
    isVisible: boolean
    control: Control<CustomRecurrenceFormValues, unknown, CustomRecurrence>
}) {
    const mutedColor = useThemeColor('field-placeholder')
    const { field, fieldState } = useController({ control, name: 'untilDate' })

    if (!isVisible) return null

    return (
        <View className="gap-1">
            <View className="flex-row items-center gap-2">
                <Text className="text-foreground" style={{ fontSize: 14 }}>
                    End date:
                </Text>
                <PlainInput
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={mutedColor}
                    className="border border-border text-foreground rounded-md px-2.5 py-1.5 flex-1"
                    style={{ fontSize: 14 }}
                />
            </View>
            <FieldError message={fieldState.error?.message} />
        </View>
    )
}

function EndCountInput({
    isVisible,
    value,
    onIncrement,
    onDecrement,
    error,
}: {
    isVisible: boolean
    value: number
    onIncrement: () => void
    onDecrement: () => void
    error?: string
}) {
    if (!isVisible) return null

    return (
        <View className="gap-1">
            <View className="flex-row items-center gap-2">
                <Text className="text-foreground" style={{ fontSize: 14 }}>
                    After
                </Text>
                <View className="flex-row items-center gap-1">
                    <Pressable
                        onPress={onDecrement}
                        className="px-2.5 py-1 rounded-md border border-border"
                    >
                        <Text className="text-foreground" style={{ fontSize: 12 }}>
                            -
                        </Text>
                    </Pressable>
                    <Text
                        className="text-foreground"
                        style={{ fontSize: 14, textAlign: 'center', width: 40 }}
                    >
                        {value}
                    </Text>
                    <Pressable
                        onPress={onIncrement}
                        className="px-2.5 py-1 rounded-md border border-border"
                    >
                        <Text className="text-foreground" style={{ fontSize: 12 }}>
                            +
                        </Text>
                    </Pressable>
                </View>
                <Text className="text-foreground" style={{ fontSize: 14 }}>
                    occurrences
                </Text>
            </View>
            <FieldError message={error} />
        </View>
    )
}
