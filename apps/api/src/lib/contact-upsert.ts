import { contacts, type createDb } from '@sequencer/db'
import { eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export async function createOrLoadContactByEmail(
  db: Db,
  values: {
    id: string
    email: string
    first_name?: string | null
    last_name?: string | null
    properties?: Record<string, unknown>
  },
): Promise<{ contact: typeof contacts.$inferSelect; isNew: boolean }> {
  try {
    await db.insert(contacts).values(values)
    const [created] = await db.select().from(contacts).where(eq(contacts.id, values.id)).limit(1)
    if (created) return { contact: created, isNew: true }
  } catch (error) {
    if (!isContactEmailUniqueConflict(error)) throw error
  }

  const [existing] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.email, values.email))
    .limit(1)
  if (existing) return { contact: existing, isNew: false }

  throw new Error(`Contact insert did not return a contact: ${values.email}`)
}

export function isContactEmailUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('unique') &&
    (message.includes('seq_contacts.email') ||
      message.includes('contacts.email') ||
      message.includes('idx_contacts_email') ||
      message.includes('sqlite_constraint_unique'))
  )
}
