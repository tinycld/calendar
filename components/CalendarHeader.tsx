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
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const breakpoint = useBreakpoint()
    const isMobile = breakpoint === 'mobile'
    const { setDrawerOpen } = useWorkspaceLayout()

    const dateLabel = formatDateLabel(focusDate, viewMode)

    if (isMobile) {
        return (
            <View className="flex-row items-center px-3 py-2 gap-2">
                <Pressable onPress={() => setDrawerOpen(true)} hitSlop={8}>
                    <Menu size={22} color={fgColor} />
                </Pressable>

                <Pressable onPress={() => setViewMode('month')} className="flex-row items-center gap-0.5" hitSlop={4}>
                    <Text style={{ fontSize: 18, fontWeight: '600', color: fgColor }}>{dateLabel}</Text>
                    <ChevronDown size={16} color={mutedColor} />
                </Pressable>

                <View className="flex-1" />

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
        <View className="flex-row items-center px-4 py-2 gap-2">
            <Button onPress={goToday} variant="outline" size="sm">
                <ButtonText>Today</ButtonText>
            </Button>

            <Pressable onPress={goPrevious} hitSlop={8}>
                <ChevronLeft size={20} color={fgColor} />
            </Pressable>
            <Pressable onPress={goNext} hitSlop={8}>
                <ChevronRight size={20} color={fgColor} />
            </Pressable>

            <Text style={{ fontSize: 20, fontWeight: '600', color: fgColor, flex: 1 }}>{dateLabel}</Text>

            <View
                className="flex-row border rounded-md overflow-hidden"
                style={{
                    borderColor,
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
                            backgroundColor: viewMode === mode ? primaryColor : undefined,
                            borderLeftWidth: i > 0 ? 1 : 0,
                            borderLeftColor: borderColor,
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 14,
                                color: viewMode === mode ? primaryFgColor : fgColor,
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
