import { useThemeColor } from 'heroui-native'
import { Check, HelpCircle, X as XIcon } from 'lucide-react-native'
import { Text, View } from 'react-native'
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
    const [successColor, dangerColor, warningColor] = useThemeColor([
        'success',
        'danger',
        'warning',
    ])
    if (rsvp === 'accepted') return <Check size={14} color={successColor} />
    if (rsvp === 'declined') return <XIcon size={14} color={dangerColor} />
    if (rsvp === 'tentative') return <HelpCircle size={14} color={warningColor} />
    return null
}

export function EventGuestList({ guests }: EventGuestListProps) {
    const [fgColor, mutedColor, accentColor, accentFgColor] = useThemeColor([
        'foreground',
        'muted',
        'accent',
        'accent-foreground',
    ])

    if (guests.length === 0) {
        return (
            <View style={{ padding: 16 }}>
                <Text style={{ fontSize: 14, color: mutedColor }}>No guests</Text>
            </View>
        )
    }

    return (
        <View style={{ gap: 8 }}>
            <Text
                style={{
                    fontSize: 16,
                    fontWeight: '600',
                    color: fgColor,
                    paddingHorizontal: 4,
                }}
            >
                Guests ({guests.length})
            </Text>

            {guests.map(guest => (
                <View
                    key={guest.email}
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 6,
                        paddingHorizontal: 4,
                    }}
                >
                    <View
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: accentColor,
                        }}
                    >
                        <Text style={{ fontSize: 12, fontWeight: '600', color: accentFgColor }}>
                            {getInitials(guest.name)}
                        </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text
                                style={{ fontSize: 12, color: mutedColor, flex: 1 }}
                                numberOfLines={1}
                            >
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
