import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useThemeColor } from '~/lib/use-app-theme'
import { Modal, ModalBackdrop, ModalContent } from '~/ui/modal'
import { PlainInput } from '~/ui/PlainInput'
import {
    buildRRule,
    describeRRule,
    getContextualPresets,
    getWeekdayPosition,
    parseRRule,
    type RRuleOptions,
} from '../lib/recurrence'

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
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
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted')
    const borderColor = useThemeColor('border')
    const bgColor = useThemeColor('background')
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
        <View style={{ gap: 6, marginBottom: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: fgColor }}>Recurrence</Text>
            <Pressable
                onPress={() => setShowPresets(true)}
                style={{
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderColor,
                    backgroundColor: bgColor,
                }}
            >
                <Text style={{ fontSize: 14, color: value ? fgColor : mutedColor }}>
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
    const fgColor = useThemeColor('foreground')
    const accentColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')

    return (
        <Modal isOpen={open} onClose={() => onOpenChange(false)}>
            <ModalBackdrop />
            <ModalContent className="w-[320px] p-3">
                <Text style={{ fontSize: 18, fontWeight: '600', color: fgColor, marginBottom: 8 }}>
                    Repeat
                </Text>
                <View style={{ gap: 4, paddingTop: 8 }}>
                    {presets.map(preset => {
                        const isSelected = preset.value === currentValue
                        return (
                            <Pressable
                                key={preset.value || 'none'}
                                onPress={() => onSelect(preset.value)}
                                style={{
                                    paddingHorizontal: 12,
                                    paddingVertical: 10,
                                    borderRadius: 6,
                                    ...(isSelected && {
                                        backgroundColor: `${accentColor}20`,
                                    }),
                                }}
                            >
                                <Text
                                    style={{
                                        fontSize: 14,
                                        color: isSelected ? accentFgColor : fgColor,
                                        fontWeight: isSelected ? '600' : '400',
                                    }}
                                >
                                    {preset.label}
                                </Text>
                            </Pressable>
                        )
                    })}
                </View>
            </ModalContent>
        </Modal>
    )
}

interface CustomState {
    freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
    interval: number
    byDay: string[]
    endType: 'never' | 'on' | 'after'
    untilDate: string
    count: number
    monthlyMode: 'dayOfMonth' | 'dayOfWeek'
}

function initCustomState(eventStartDate: Date, initialValue?: string): CustomState {
    const defaults: CustomState = {
        freq: 'WEEKLY',
        interval: 1,
        byDay: [DAY_CODES[eventStartDate.getDay()]],
        endType: 'never',
        untilDate: '',
        count: 13,
        monthlyMode: 'dayOfMonth',
    }

    if (!initialValue) return defaults

    const parsed = parseRRule(initialValue)
    if (!parsed) return defaults

    const state: CustomState = {
        ...defaults,
        freq: parsed.freq,
        interval: parsed.interval || 1,
    }

    if (parsed.byDay && parsed.byDay.length > 0) {
        if (parsed.freq === 'MONTHLY') {
            state.monthlyMode = 'dayOfWeek'
        } else {
            state.byDay = parsed.byDay
        }
    }

    if (parsed.count) {
        state.endType = 'after'
        state.count = parsed.count
    } else if (parsed.until) {
        state.endType = 'on'
        const y = parsed.until.getFullYear()
        const m = String(parsed.until.getMonth() + 1).padStart(2, '0')
        const d = String(parsed.until.getDate()).padStart(2, '0')
        state.untilDate = `${y}-${m}-${d}`
    }

    return state
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
    const fgColor = useThemeColor('foreground')
    const borderColor = useThemeColor('border')
    const accentColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')
    const [state, setState] = useState<CustomState>(() =>
        initCustomState(eventStartDate, initialValue)
    )

    const updateState = (partial: Partial<CustomState>) => {
        setState(prev => ({ ...prev, ...partial }))
    }

    const handleDone = () => {
        const options: RRuleOptions = {
            freq: state.freq,
            interval: state.interval,
        }

        if (state.freq === 'WEEKLY' && state.byDay.length > 0) {
            options.byDay = state.byDay
        }

        if (state.freq === 'DAILY' && state.byDay.length > 0 && state.byDay.length < 7) {
            options.byDay = state.byDay
        }

        if (state.freq === 'MONTHLY') {
            if (state.monthlyMode === 'dayOfWeek') {
                const { position, day } = getWeekdayPosition(eventStartDate)
                options.byDay = [`${position}${day}`]
            } else {
                options.byMonthDay = [eventStartDate.getDate()]
            }
        }

        if (state.endType === 'after' && state.count > 0) {
            options.count = state.count
        } else if (state.endType === 'on' && state.untilDate) {
            options.until = new Date(`${state.untilDate}T23:59:59`)
        }

        onSave(buildRRule(options))
        onOpenChange(false)
    }

    return (
        <Modal isOpen={open} onClose={() => onOpenChange(false)}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-4">
                <Text
                    style={{
                        fontSize: 18,
                        fontWeight: '600',
                        color: fgColor,
                        marginBottom: 16,
                    }}
                >
                    Custom recurrence
                </Text>

                <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 14, color: fgColor }}>Repeat every</Text>
                        <Pressable
                            onPress={() => {
                                updateState({ interval: Math.min(state.interval + 1, 99) })
                            }}
                            onLongPress={() => {
                                updateState({ interval: Math.max(state.interval - 1, 1) })
                            }}
                            style={{
                                borderWidth: 1,
                                borderRadius: 6,
                                width: 44,
                                height: 36,
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderColor,
                            }}
                        >
                            <Text style={{ fontSize: 14, color: fgColor, textAlign: 'center' }}>
                                {state.interval}
                            </Text>
                        </Pressable>
                        <View
                            style={{
                                flexDirection: 'row',
                                gap: 4,
                                flexWrap: 'wrap',
                                flex: 1,
                            }}
                        >
                            {FREQ_OPTIONS.map(opt => {
                                const isSelected = state.freq === opt.value
                                return (
                                    <Pressable
                                        key={opt.value}
                                        onPress={() => updateState({ freq: opt.value })}
                                        style={{
                                            paddingHorizontal: 10,
                                            paddingVertical: 4,
                                            borderRadius: 6,
                                            borderWidth: 1,
                                            borderColor: isSelected ? accentColor : borderColor,
                                            backgroundColor: isSelected ? accentColor : undefined,
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: isSelected ? accentFgColor : fgColor,
                                            }}
                                        >
                                            {state.interval > 1 ? `${opt.label}s` : opt.label}
                                        </Text>
                                    </Pressable>
                                )
                            })}
                        </View>
                    </View>

                    <WeekDaySelector
                        isVisible={state.freq === 'WEEKLY'}
                        selectedDays={state.byDay}
                        onToggle={day => {
                            const has = state.byDay.includes(day)
                            if (has) {
                                if (state.byDay.length > 1) {
                                    updateState({
                                        byDay: state.byDay.filter(d => d !== day),
                                    })
                                }
                            } else {
                                updateState({ byDay: [...state.byDay, day] })
                            }
                        }}
                    />

                    <MonthlyModeSelector
                        isVisible={state.freq === 'MONTHLY'}
                        monthlyMode={state.monthlyMode}
                        eventStartDate={eventStartDate}
                        onChange={mode => updateState({ monthlyMode: mode })}
                    />

                    <View style={{ gap: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: fgColor }}>
                            Ends
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                            {(['never', 'on', 'after'] as const).map(type => {
                                const isSelected = state.endType === type
                                const label =
                                    type === 'never' ? 'Never' : type === 'on' ? 'On date' : 'After'
                                return (
                                    <Pressable
                                        key={type}
                                        onPress={() => updateState({ endType: type })}
                                        style={{
                                            paddingHorizontal: 10,
                                            paddingVertical: 4,
                                            borderRadius: 6,
                                            borderWidth: 1,
                                            borderColor: isSelected ? accentColor : borderColor,
                                            backgroundColor: isSelected ? accentColor : undefined,
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: isSelected ? accentFgColor : fgColor,
                                            }}
                                        >
                                            {label}
                                        </Text>
                                    </Pressable>
                                )
                            })}
                        </View>

                        <EndDateInput
                            isVisible={state.endType === 'on'}
                            value={state.untilDate}
                            onChange={val => updateState({ untilDate: val })}
                        />

                        <EndCountInput
                            isVisible={state.endType === 'after'}
                            value={state.count}
                            onIncrement={() =>
                                updateState({ count: Math.min(state.count + 1, 999) })
                            }
                            onDecrement={() => updateState({ count: Math.max(state.count - 1, 1) })}
                        />
                    </View>
                </View>

                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'flex-end',
                        gap: 8,
                        paddingTop: 8,
                    }}
                >
                    <Pressable
                        onPress={() => onOpenChange(false)}
                        style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor,
                        }}
                    >
                        <Text style={{ fontSize: 14, color: fgColor }}>Cancel</Text>
                    </Pressable>
                    <Pressable
                        onPress={handleDone}
                        style={{
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 6,
                            backgroundColor: accentColor,
                        }}
                    >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: accentFgColor }}>
                            Done
                        </Text>
                    </Pressable>
                </View>
            </ModalContent>
        </Modal>
    )
}

function WeekDaySelector({
    isVisible,
    selectedDays,
    onToggle,
}: {
    isVisible: boolean
    selectedDays: string[]
    onToggle: (day: string) => void
}) {
    const fgColor = useThemeColor('foreground')
    const borderColor = useThemeColor('border')
    const accentColor = useThemeColor('accent')

    if (!isVisible) return null

    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: fgColor }}>Repeat on</Text>
            <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
                {DAY_CODES.map((code, i) => {
                    const isSelected = selectedDays.includes(code)
                    return (
                        <Pressable
                            key={code}
                            onPress={() => onToggle(code)}
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 18,
                                borderWidth: 1,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: isSelected ? accentColor : 'transparent',
                                borderColor: isSelected ? accentColor : borderColor,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 12,
                                    color: isSelected ? 'white' : fgColor,
                                    fontWeight: isSelected ? '600' : '400',
                                }}
                            >
                                {DAY_LABELS[i]}
                            </Text>
                        </Pressable>
                    )
                })}
            </View>
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
    const fgColor = useThemeColor('foreground')
    const borderColor = useThemeColor('border')
    const accentColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')

    if (!isVisible) return null

    const dayOfMonth = eventStartDate.getDate()
    const { position } = getWeekdayPosition(eventStartDate)
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayName = dayNames[eventStartDate.getDay()]
    const ordinals = ['', 'first', 'second', 'third', 'fourth', 'fifth']
    const ordinal = ordinals[position] ?? `${position}th`

    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: fgColor }}>Monthly on</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                    onPress={() => onChange('dayOfMonth')}
                    style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: monthlyMode === 'dayOfMonth' ? accentColor : borderColor,
                        backgroundColor: monthlyMode === 'dayOfMonth' ? accentColor : undefined,
                    }}
                >
                    <Text
                        style={{
                            fontSize: 12,
                            color: monthlyMode === 'dayOfMonth' ? accentFgColor : fgColor,
                        }}
                    >
                        Day {dayOfMonth}
                    </Text>
                </Pressable>
                <Pressable
                    onPress={() => onChange('dayOfWeek')}
                    style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: monthlyMode === 'dayOfWeek' ? accentColor : borderColor,
                        backgroundColor: monthlyMode === 'dayOfWeek' ? accentColor : undefined,
                    }}
                >
                    <Text
                        style={{
                            fontSize: 12,
                            color: monthlyMode === 'dayOfWeek' ? accentFgColor : fgColor,
                        }}
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
    value,
    onChange,
}: {
    isVisible: boolean
    value: string
    onChange: (val: string) => void
}) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('field-placeholder')
    const borderColor = useThemeColor('border')

    if (!isVisible) return null

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 14, color: fgColor }}>End date:</Text>
            <PlainInput
                value={value}
                onChangeText={onChange}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={mutedColor}
                style={{
                    borderWidth: 1,
                    borderColor,
                    borderRadius: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    color: fgColor,
                    fontSize: 14,
                    flex: 1,
                }}
            />
        </View>
    )
}

function EndCountInput({
    isVisible,
    value,
    onIncrement,
    onDecrement,
}: {
    isVisible: boolean
    value: number
    onIncrement: () => void
    onDecrement: () => void
}) {
    const fgColor = useThemeColor('foreground')
    const borderColor = useThemeColor('border')

    if (!isVisible) return null

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 14, color: fgColor }}>After</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Pressable
                    onPress={onDecrement}
                    style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor,
                    }}
                >
                    <Text style={{ fontSize: 12, color: fgColor }}>-</Text>
                </Pressable>
                <Text
                    style={{
                        fontSize: 14,
                        color: fgColor,
                        textAlign: 'center',
                        width: 40,
                    }}
                >
                    {value}
                </Text>
                <Pressable
                    onPress={onIncrement}
                    style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor,
                    }}
                >
                    <Text style={{ fontSize: 12, color: fgColor }}>+</Text>
                </Pressable>
            </View>
            <Text style={{ fontSize: 14, color: fgColor }}>occurrences</Text>
        </View>
    )
}
