import { ChevronDown, ChevronLeft, ChevronRight, Menu } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useBreakpoint } from '~/components/workspace/useBreakpoint'
import { useWorkspaceLayout } from '~/components/workspace/useWorkspaceLayout'
import { useThemeColor } from '~/lib/use-app-theme'
import { Button, ButtonText } from '~/ui/button'
import { formatDateLabel } from '../hooks/useCalendarNavigation'
import { useCalendarView, type ViewMode } from '../hooks/useCalendarView'

const DESKTOP_VIEW_MODES: ViewMode[] = ['day', 'week', 'month']
const VIEW_LABELS: Record<ViewMode, string> = {
    day: 'Day',
    week: 'Week',
    month: 'Month',
    schedule: 'Schedule',
}

export function CalendarHeader() {
    const { viewMode, setViewMode, focusDate, goToday, goNext, goPrevious } = useCalendarView()
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted')
    const borderColor = useThemeColor('border')
    const accentColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')
    const breakpoint = useBreakpoint()
    const isMobile = breakpoint === 'mobile'
    const { setDrawerOpen } = useWorkspaceLayout()

    const dateLabel = formatDateLabel(focusDate, viewMode)

    if (isMobile) {
        return (
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    gap: 8,
                }}
            >
                <Pressable onPress={() => setDrawerOpen(true)} hitSlop={8}>
                    <Menu size={22} color={fgColor} />
                </Pressable>

                <Pressable
                    onPress={() => setViewMode('month')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
                    hitSlop={4}
                >
                    <Text style={{ fontSize: 18, fontWeight: '600', color: fgColor }}>
                        {dateLabel}
                    </Text>
                    <ChevronDown size={16} color={mutedColor} />
                </Pressable>

                <View style={{ flex: 1 }} />

                <Button onPress={goToday} variant="outline" size="sm">
                    <ButtonText>Today</ButtonText>
                </Button>

                <Pressable onPress={goPrevious} hitSlop={8}>
                    <ChevronLeft size={20} color={fgColor} />
                </Pressable>
                <Pressable onPress={goNext} hitSlop={8}>
                    <ChevronRight size={20} color={fgColor} />
                </Pressable>
            </View>
        )
    }

    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 8,
                gap: 8,
            }}
        >
            <Button onPress={goToday} variant="outline" size="sm">
                <ButtonText>Today</ButtonText>
            </Button>

            <Pressable onPress={goPrevious} hitSlop={8}>
                <ChevronLeft size={20} color={fgColor} />
            </Pressable>
            <Pressable onPress={goNext} hitSlop={8}>
                <ChevronRight size={20} color={fgColor} />
            </Pressable>

            <Text style={{ fontSize: 20, fontWeight: '600', color: fgColor, flex: 1 }}>
                {dateLabel}
            </Text>

            <View
                style={{
                    flexDirection: 'row',
                    borderWidth: 1,
                    borderColor,
                    borderRadius: 6,
                    overflow: 'hidden',
                }}
            >
                {DESKTOP_VIEW_MODES.map((mode, i) => (
                    <Button
                        key={mode}
                        onPress={() => setViewMode(mode)}
                        variant="ghost"
                        size="sm"
                        style={{
                            borderRadius: 0,
                            backgroundColor: viewMode === mode ? accentColor : undefined,
                            borderLeftWidth: i > 0 ? 1 : 0,
                            borderLeftColor: borderColor,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 14,
                                color: viewMode === mode ? accentFgColor : fgColor,
                            }}
                        >
                            {VIEW_LABELS[mode]}
                        </Text>
                    </Button>
                ))}
            </View>
        </View>
    )
}
