import { Check, MoreVertical } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useThemeColor } from '~/lib/use-app-theme'
import { Menu, MenuItem, MenuItemLabel, MenuSeparator } from '~/ui/menu'
import type { CalendarColorKey } from '../types'
import { CALENDAR_COLOR_GRID, getCalendarColorResolved } from './calendar-colors'

interface CalendarMenuProps {
    currentColor: CalendarColorKey
    onColorChange: (color: CalendarColorKey) => void
    onShowOnly: () => void
}

export function CalendarMenu({ currentColor, onColorChange, onShowOnly }: CalendarMenuProps) {
    const mutedColor = useThemeColor('muted')

    return (
        <Menu
            trigger={({ ...triggerProps }) => (
                <View {...triggerProps}>
                    <Pressable style={{ padding: 4, borderRadius: 4 }} hitSlop={8}>
                        <MoreVertical size={14} color={mutedColor} />
                    </Pressable>
                </View>
            )}
            placement="bottom left"
            className="min-w-[220px]"
        >
            <MenuItem onPress={onShowOnly}>
                <MenuItemLabel>Display this only</MenuItemLabel>
            </MenuItem>

            <MenuSeparator />

            <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}>
                {CALENDAR_COLOR_GRID.map(row => (
                    <View key={row.join('-')} style={{ flexDirection: 'row', gap: 6 }}>
                        {row.map(colorKey => {
                            const { bg } = getCalendarColorResolved(colorKey)
                            return (
                                <Pressable
                                    key={colorKey}
                                    onPress={() => onColorChange(colorKey)}
                                    style={{
                                        padding: 2,
                                        borderRadius: 14,
                                        width: 28,
                                        height: 28,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <View
                                        style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: 12,
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            backgroundColor: bg,
                                        }}
                                    >
                                        {currentColor === colorKey && (
                                            <Check size={12} color="#ffffff" />
                                        )}
                                    </View>
                                </Pressable>
                            )
                        })}
                    </View>
                ))}
            </View>
        </Menu>
    )
}
