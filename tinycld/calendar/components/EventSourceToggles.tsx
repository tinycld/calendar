import { Check } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { CALENDAR_EVENT_SOURCES } from '../hooks/useSourceEvents'
import { useEventSourcesStore } from '../stores/event-sources-store'
import { getCalendarColorResolved } from './calendar-colors'

/**
 * Sidebar visibility toggles for contributed event sources, rendered by the
 * HOST so every contributor gets consistent rows for free. Mirrors
 * CalendarList's checkbox rows; sources have no menu (their color and label
 * come from the contributing package's manifest, not user settings).
 */
export function EventSourceToggles() {
    const hiddenSourceIds = useEventSourcesStore(s => s.hiddenSourceIds)
    const toggleSource = useEventSourcesStore(s => s.toggleSource)

    if (CALENDAR_EVENT_SOURCES.length === 0) return null

    return (
        <View>
            {CALENDAR_EVENT_SOURCES.map(source => {
                const colors = getCalendarColorResolved(source.color ?? 'graphite')
                const isChecked = !hiddenSourceIds.includes(source.id)
                return (
                    <View key={source.id} className="flex-row items-center pr-3 py-[5px]">
                        <Pressable
                            testID={`event-source-toggle-${source.id}`}
                            className="flex-row items-center gap-2.5 flex-1"
                            style={{ paddingLeft: 20 }}
                            onPress={() => toggleSource(source.id)}
                        >
                            <View
                                className="items-center justify-center"
                                style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: 3,
                                    backgroundColor: isChecked ? colors.bg : 'transparent',
                                    borderColor: colors.bg,
                                    borderWidth: isChecked ? 0 : 2,
                                }}
                            >
                                {isChecked && <Check size={12} color={colors.text} />}
                            </View>
                            <Text
                                className="flex-1 text-foreground"
                                style={{ fontSize: 15 }}
                                numberOfLines={1}
                            >
                                {source.label}
                            </Text>
                        </Pressable>
                    </View>
                )
            })}
        </View>
    )
}
