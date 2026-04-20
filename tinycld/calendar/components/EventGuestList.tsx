import { Check, HelpCircle, X as XIcon } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { EventGuest } from '../types'

function getInitials(name: string): string {
    const trimmed = name.trim()
    if (!trimmed) return '?'
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return trimmed.slice(0, 2).toUpperCase()
}

function RsvpIcon({ rsvp }: { rsvp: EventGuest['rsvp'] }) {
    const successColor = useThemeColor('success')
    const dangerColor = useThemeColor('danger')
    const warningColor = useThemeColor('warning')
    if (rsvp === 'accepted') return <Check size={14} color={successColor} />
    if (rsvp === 'declined') return <XIcon size={14} color={dangerColor} />
    if (rsvp === 'tentative') return <HelpCircle size={14} color={warningColor} />
    return null
}

export function EventGuestList({ guests }: EventGuestListProps) {
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const accentColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')

    if (guests.length === 0) {
        return (
            <View className="p-4">
                <Text style={{ fontSize: 14, color: mutedColor }}>No guests</Text>
            </View>
        )
    }

    return (
        <View className="gap-2">
            <Text
                className="px-1"
                style={{
                    fontSize: 16,
                    fontWeight: '600',
                    color: fgColor,
                }}
            >
                Guests ({guests.length})
            </Text>

            {guests.map((guest) => (
                <View key={guest.email} className="flex-row items-center gap-2.5 py-1.5 px-1">
                    <View
                        className="size-8 rounded-full items-center justify-center"
                        style={{
                            backgroundColor: accentColor,
                        }}
                    >
                        <Text style={{ fontSize: 12, fontWeight: '600', color: accentFgColor }}>
                            {getInitials(guest.name)}
                        </Text>
                    </View>
                    <View className="flex-1">
                        <View className="flex-row items-center gap-1.5">
                            <Text
                                style={{
                                    fontSize: 14,
                                    fontWeight: '500',
                                    color: fgColor,
                                }}
                                numberOfLines={1}
                            >
                                {guest.name}
                            </Text>
                            {guest.role === 'organizer' && (
                                <Text style={{ fontSize: 11, color: mutedColor }}>Organizer</Text>
                            )}
                        </View>
                        <View className="flex-row items-center gap-1">
                            <Text style={{ fontSize: 12, color: mutedColor, flex: 1 }} numberOfLines={1}>
                                {guest.email}
                            </Text>
                            <RsvpIcon rsvp={guest.rsvp} />
                        </View>
                    </View>
                </View>
            ))}
        </View>
    )
}

interface EventGuestListProps {
    guests: EventGuest[]
}
