import { Avatar } from '@tinycld/core/components/Avatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChevronDown, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { type CalendarRole, ROLE_OPTIONS, roleLabel } from './roles'

export interface CalendarMemberRowData {
    membershipId: string
    userId: string
    name: string
    email: string
    role: CalendarRole
    isCurrentUser: boolean
}

interface MemberRowProps {
    member: CalendarMemberRowData
    canEdit: boolean
    canRemove: boolean
    onRoleChange: (membershipId: string, role: CalendarRole) => void
    onRemove: (membershipId: string) => void
}

export function MemberRow({ member, canEdit, canRemove, onRoleChange, onRemove }: MemberRowProps) {
    const dangerColor = useThemeColor('danger')

    return (
        <View
            testID={`calendar-member-row-${member.userId}`}
            className="flex-row items-center gap-3 py-2.5 px-3"
        >
            <Avatar
                name={member.name}
                email={member.email}
                size={36}
                palette="soft"
                shape="squircle"
            />

            <View className="flex-1">
                <View className="flex-row items-center gap-1.5">
                    <Text className="text-foreground font-medium" style={{ fontSize: 14 }}>
                        {member.name || member.email}
                    </Text>
                    {member.isCurrentUser ? (
                        <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                            (you)
                        </Text>
                    ) : null}
                </View>
                {member.name ? (
                    <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                        {member.email}
                    </Text>
                ) : null}
            </View>

            <RolePill
                canEdit={canEdit}
                role={member.role}
                onChange={role => onRoleChange(member.membershipId, role)}
            />

            {canRemove ? (
                <Pressable
                    onPress={() => onRemove(member.membershipId)}
                    hitSlop={8}
                    className="p-1.5 rounded-md"
                    accessibilityLabel={`Remove ${member.name || member.email}`}
                >
                    <X size={16} color={dangerColor} />
                </Pressable>
            ) : (
                <View style={{ width: 28, height: 28 }} />
            )}
        </View>
    )
}

function RolePill({
    canEdit,
    role,
    onChange,
}: {
    canEdit: boolean
    role: CalendarRole
    onChange: (role: CalendarRole) => void
}) {
    const mutedColor = useThemeColor('muted-foreground')

    if (!canEdit) {
        return (
            <View className="px-2.5 py-1 rounded-md bg-surface-secondary">
                <Text className="text-foreground text-xs font-medium">{roleLabel(role)}</Text>
            </View>
        )
    }

    return (
        <Menu
            trigger={
                <Pressable className="flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background">
                    <Text className="text-foreground text-xs font-medium">{roleLabel(role)}</Text>
                    <ChevronDown size={14} color={mutedColor} />
                </Pressable>
            }
            placement="bottom-end"
            presentation="popover"
            title="Role"
        >
            {ROLE_OPTIONS.map(opt => (
                <Menu.Item
                    key={opt.value}
                    label={opt.label}
                    isSelected={opt.value === role}
                    onSelect={() => onChange(opt.value)}
                />
            ))}
        </Menu>
    )
}
