import { cookies, headers } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users, organizations, teachers, auditLogs } from '@/db/schema';

export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function audit(organizationId: string | null, userId: string | null, action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
  await db.insert(auditLogs).values({ organizationId, userId, action, entityType, entityId, metadata });
}
export async function currentUser() {
  const token = (await cookies()).get('school_session')?.value;
  if (!token) return null;
  const [row] = await db.select({ user: users, session: sessions }).from(sessions).innerJoin(users, eq(sessions.userId,users.id)).where(and(eq(sessions.tokenHash,hashToken(token)),gt(sessions.expiresAt,new Date()))).limit(1);
  if (!row || !row.user.active) return null;
  if (row.user.organizationId) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id,row.user.organizationId)).limit(1);
    if (!org?.active) return null;
  }
  return row.user;
}
export async function requireUser(roles?: string[]) {
  const user = await currentUser();
  if (!user) throw new AppError('Your session has expired. Please sign in again.',401);
  if (roles && !roles.includes(user.role)) throw new AppError('You do not have permission to do that.',403);
  return user;
}
export async function teacherFor(user: typeof users.$inferSelect) {
  if (user.role !== 'TEACHER' || !user.organizationId) throw new AppError('Teacher access required.',403);
  const [teacher] = await db.select().from(teachers).where(and(eq(teachers.userId,user.id),eq(teachers.organizationId,user.organizationId),eq(teachers.active,true))).limit(1);
  if (!teacher) throw new AppError('Your teacher account is inactive.',403);
  return teacher;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({userId,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+7*86400000)});
  (await cookies()).set('school_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:7*86400});
}
export async function destroySession() {
  const token = (await cookies()).get('school_session')?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash,hashToken(token)));
  (await cookies()).delete('school_session');
}
export async function checkOrigin(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('JSON requests are required.',415);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('Cross-site requests are not allowed.',403);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== (await headers()).get('host')) throw new AppError('Invalid request origin.',403);
}
export function schoolToday(timezone: string) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export function dateMinus(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-days); return d.toISOString().slice(0,10); }
export function validLessonDate(date: string, today: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)===date && date>=dateMinus(today,14) && date<=today; }
export async function orgFor(user: typeof users.$inferSelect, targetOrgId?: string | null) {
  const orgId = (user.role === 'SUPER_ADMIN' && targetOrgId) ? targetOrgId : user.organizationId;
  if (!orgId) throw new AppError('Organization context required.',403);
  const [org] = await db.select().from(organizations).where(eq(organizations.id,orgId)).limit(1);
  if (!org) throw new AppError('Organization not found.',404);
  if (!org.active && user.role !== 'SUPER_ADMIN') throw new AppError('Organization unavailable.',403);
  return org;
}

