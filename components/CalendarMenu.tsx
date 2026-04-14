import { Check, MoreVertical } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useThemeColor } from '~/lib/use-app-theme'
import { Menu, Separator } from '~/ui/menu'
import type { CalendarColorKey } from '../types'
import { CALENDAR_COLOR_GRID, getCalendarColorResolved } from './calendar-colors'

interface CalendarMenuProps {
    currentColor: CalendarColorKey
    onColorChange: (color: CalendarColorKey) => void
    onShowOnly: () => void
}

export function CalendarMenu({ currentColor, onColorChange, onShowOnly }: CalendarMenuProps) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        <Menu>
            <Menu.Trigger>
                <Pressable className="p-1 rounded" hitSlop={8}>
                    <MoreVertical size={14} color={mutedColor} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    <Menu.Item onPress={onShowOnly}>
                        <Menu.ItemTitle>Display this only</Menu.ItemTitle>
                    </Menu.Item>

                    <Separator />

                    <View className="px-3 py-2 gap-1.5">
                        {CALENDAR_COLOR_GRID.map(row => (
                            <View key={row.join('-')} className="flex-row gap-1.5">
                                {row.map(colorKey => {
                                    const { bg } = getCalendarColorResolved(colorKey)
                                    return (
                                        <Pressable
                                            key={colorKey}
                                            onPress={() => onColorChange(colorKey)}
                                            className="p-0.5 rounded-full size-7 items-center justify-center"
                                        >
                                            <View
                                                className="size-6 rounded-full items-center justify-center"
                                                style={{
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
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
