import { SuretyGuard } from '@tinycld/core/components/SuretyGuard'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import * as Clipboard from 'expo-clipboard'
import { Check, MoreVertical } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { CalendarColorKey, CalendarWithGroup } from '../types'
import { CALENDAR_COLOR_GRID, getCalendarColorResolved } from './calendar-colors'

interface CalendarMenuProps {
    currentColor: CalendarColorKey
    onColorChange: (color: CalendarColorKey) => void
    onShowOnly: () => void
    calendar?: CalendarWithGroup
    onRefresh?: () => void
    onDelete?: () => void
    /** When provided, renders a "Settings & sharing" item. Caller decides
     *  whether the current user can manage this calendar. */
    onOpenSettings?: () => void
}

function formatLastSync(dateStr: string): string {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return `${Math.floor(diffHours / 24)}d ago`
}

export function CalendarMenu({
    currentColor,
    onColorChange,
    onShowOnly,
    calendar,
    onRefresh,
    onDelete,
    onOpenSettings,
}: CalendarMenuProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const isSubscribed = !!calendar?.subscription_url

    const deleteLabel = isSubscribed ? 'Remove subscription' : 'Delete calendar'
    const deleteMessage = isSubscribed
        ? `Remove "${calendar?.name}" subscription? This will remove the calendar and all its events.`
        : `Delete "${calendar?.name}"? This will delete the calendar and all its events. This cannot be undone.`

    const copySubscriptionUrl = () => {
        if (calendar?.subscription_url) Clipboard.setStringAsync(calendar.subscription_url)
    }

    return (
        <SuretyGuard
            title={deleteLabel}
            message={deleteMessage}
            confirmLabel={isSubscribed ? 'Remove' : 'Delete'}
            onConfirmed={() => onDelete?.()}
        >
            {onConfirmOpen => (
                <Menu
                    trigger={
                        <Pressable className="p-1 rounded" hitSlop={8}>
                            <MoreVertical size={14} color={mutedColor} />
                        </Pressable>
                    }
                    placement="bottom-start"
                    title={calendar?.name ?? 'Calendar'}
                >
                    <Menu.Item label="Display this only" onSelect={onShowOnly} />
                    <SettingsItem onSelect={onOpenSettings} />
                    <SubscriptionRows
                        isVisible={isSubscribed}
                        calendar={calendar}
                        onRefresh={onRefresh}
                        onCopyUrl={copySubscriptionUrl}
                    />
                    <Menu.Separator />
                    <Menu.Custom className="px-3 py-2 gap-1.5">
                        <ColorGrid currentColor={currentColor} onColorChange={onColorChange} />
                    </Menu.Custom>
                    <DeleteItem
                        isVisible={!!onDelete}
                        label={deleteLabel}
                        onSelect={onConfirmOpen}
                    />
                </Menu>
            )}
        </SuretyGuard>
    )
}

function SettingsItem({ onSelect }: { onSelect?: () => void }) {
    if (!onSelect) return null
    return <Menu.Item label="Settings & sharing" onSelect={onSelect} />
}

function DeleteItem({
    isVisible,
    label,
    onSelect,
}: {
    isVisible: boolean
    label: string
    onSelect: () => void
}) {
    if (!isVisible) return null
    return (
        <>
            <Menu.Separator />
            <Menu.Item label={label} isDestructive onSelect={onSelect} />
        </>
    )
}

function SubscriptionRows({
    isVisible,
    calendar,
    onRefresh,
    onCopyUrl,
}: {
    isVisible: boolean
    calendar?: CalendarWithGroup
    onRefresh?: () => void
    onCopyUrl: () => void
}) {
    if (!isVisible) return null
    return (
        <>
            <Menu.Separator />
            <SyncStatus
                lastSync={calendar?.subscription_last_sync ?? ''}
                error={calendar?.subscription_error ?? ''}
            />
            <Menu.Item label="Refresh now" onSelect={onRefresh} />
            <Menu.Item label="Copy URL" onSelect={onCopyUrl} />
        </>
    )
}

function SyncStatus({ lastSync, error }: { lastSync: string; error: string }) {
    const mutedColor = useThemeColor('muted-foreground')
    const dangerColor = useThemeColor('danger')
    if (!lastSync && !error) return null
    return (
        <Menu.Custom className="px-3 py-1.5 gap-1">
            <StatusLine isVisible={!!lastSync} color={mutedColor}>
                Synced {formatLastSync(lastSync)}
            </StatusLine>
            <StatusLine isVisible={!!error} color={dangerColor}>
                {error}
            </StatusLine>
        </Menu.Custom>
    )
}

function StatusLine({
    isVisible,
    color,
    children,
}: {
    isVisible: boolean
    color: string
    children: ReactNode
}) {
    if (!isVisible) return null
    return (
        <Text style={{ fontSize: 11, color }} numberOfLines={2}>
            {children}
        </Text>
    )
}

function ColorGrid({
    currentColor,
    onColorChange,
}: {
    currentColor: CalendarColorKey
    onColorChange: (color: CalendarColorKey) => void
}) {
    return (
        <>
            {CALENDAR_COLOR_GRID.map(row => (
                <View key={row.join('-')} className="flex-row gap-1.5">
                    {row.map(colorKey => (
                        <ColorSwatch
                            key={colorKey}
                            colorKey={colorKey}
                            isSelected={currentColor === colorKey}
                            onPress={() => onColorChange(colorKey)}
                        />
                    ))}
                </View>
            ))}
        </>
    )
}

function ColorSwatch({
    colorKey,
    isSelected,
    onPress,
}: {
    colorKey: CalendarColorKey
    isSelected: boolean
    onPress: () => void
}) {
    const { bg, text } = getCalendarColorResolved(colorKey)
    return (
        <Pressable
            onPress={onPress}
            className="p-0.5 rounded-full size-7 items-center justify-center"
        >
            <View
                className="size-6 rounded-full items-center justify-center"
                style={{ backgroundColor: bg }}
            >
                <SwatchCheck isVisible={isSelected} color={text} />
            </View>
        </Pressable>
    )
}

function SwatchCheck({ isVisible, color }: { isVisible: boolean; color: string }) {
    if (!isVisible) return null
    return <Check size={12} color={color} />
}
