import { z } from '@tinycld/core/ui/form'

export const addMemberSchema = z.object({
    query: z.string(),
    role: z.enum(['owner', 'editor', 'viewer']),
})

export type AddMemberFormValues = z.infer<typeof addMemberSchema>

export const addMemberDefaults: AddMemberFormValues = { query: '', role: 'viewer' }
