import { SuretyGuard } from '@tinycld/core/components/SuretyGuard'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ColorPickerGrid } from '@tinycld/core/ui/color-picker/ColorPickerGrid'
import { Menu } from '@tinycld/core/ui/menu'
import * as Clipboard from 'expo-clipboard'
import { MoreVertical } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, Text } from 'react-native'
import type { CalendarWithGroup } from '../types'
import { CALENDAR_COLOR_SWATCHES, normalizeCalendarColor } from './calendar-colors'

interface CalendarMenuProps {
    currentColor: string
    onColorChange: (color: string) => void
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
    currentColor: string
    onColorChange: (color: string) => void
}) {
    return (
        <ColorPickerGrid
            selected={normalizeCalendarColor(currentColor)}
            onSelect={onColorChange}
            palette={CALENDAR_SWATCHES}
        />
    )
}

const CALENDAR_SWATCHES = CALENDAR_COLOR_SWATCHES.map(hex => ({ hex, label: hex }))
