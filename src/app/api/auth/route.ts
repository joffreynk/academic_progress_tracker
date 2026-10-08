import { db } from '@/db';
import { users, loginAttempts, organizations } from '@/db/schema';
import { and, eq, like, or } from 'drizzle-orm';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { audit, checkOrigin, createSession, currentUser, destroySession, hashToken, AppError } from '@/lib/security';
import { passwordSchema } from '@/lib/passwordSchema';

export const dynamic = 'force-dynamic';

// Public branding lookup for the sign-in screen: resolves the organization logo without
// exposing whether an account exists. Returns {logoUrl} or {logoUrl:null}.
async function logoFor(identity: string): Promise<string | null> {
  const value = identity.trim().toLowerCase().slice(0, 200);
  const domain = value.includes('@') ? (value.split('@').pop() || '') : '';
  if (/^[a-z0-9.-]{3,120}$/.test(domain)) {
    const joined = await db
      .select({ logoUrl: organizations.logoUrl })
      .from(organizations)
      .innerJoin(users, eq(users.organizationId, organizations.id))
      .where(and(like(users.email, `%@${domain}`), eq(organizations.active, true)))
      .limit(1);
    if (joined[0]?.logoUrl) return joined[0].logoUrl;
    const byDomain = await db
      .select({ logoUrl: organizations.logoUrl })
      .from(organizations)
      .where(and(eq(organizations.domain, domain), eq(organizations.active, true)))
      .limit(1);
    if (byDomain[0]?.logoUrl) return byDomain[0].logoUrl;
  }
  // Single-organization deployments show their logo for any identifier.
  const only = await db.select({ logoUrl: organizations.logoUrl }).from(organizations).where(eq(organizations.active, true)).limit(2);
  return only.length === 1 ? only[0].logoUrl || null : null;
}

export async function GET(req: Request) {
  const identity = new URL(req.url).searchParams.get('identity');
  if (identity !== null) return Response.json({ logoUrl: await logoFor(identity) }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  const user = await currentUser();
  return Response.json({user:user ? {id:user.id,name:user.name,username:user.username,role:user.role,organizationId:user.organizationId} : null});
}
export async function POST(req: Request) {
 try {
  await checkOrigin(req);
  const raw = await req.json();
  const action = z.enum(['login','logout','setup','password']).parse(raw.action);
  if(action==='logout') { const user=await currentUser(); if(user) await audit(user.organizationId,user.id,'LOGOUT','user',user.id); await destroySession(); return Response.json({ok:true}); }
  if(action==='setup') {
   if(!process.env.SETUP_TOKEN || raw.setupToken!==process.env.SETUP_TOKEN) throw new AppError('Setup is unavailable.',403);
   const existing=await db.select({id:users.id}).from(users).limit(1);
   if(existing.length) throw new AppError('Setup has already been completed.',403);
   const data=z.object({name:z.string().min(2),username:z.string().min(3),email:z.email(),password:passwordSchema}).parse(raw);
   const [user]=await db.insert(users).values({name:data.name,username:data.username.toLowerCase(),email:data.email.toLowerCase(),passwordHash:await hash(data.password,8),role:'SUPER_ADMIN'}).returning();
   await audit(null,user.id,'INITIAL_SETUP','user',user.id); await createSession(user.id); return Response.json({ok:true});
  }
  if(action==='password') {
   const user=await currentUser(); if(!user) throw new AppError('Sign in required.',401);
   const data=z.object({current:z.string(),password:passwordSchema}).parse(raw);
   if(!await compare(data.current,user.passwordHash)) throw new AppError('Current password is incorrect.',400);
   await db.update(users).set({passwordHash:await hash(data.password,8),updatedAt:new Date()}).where(eq(users.id,user.id));
   await audit(user.organizationId,user.id,'PASSWORD_CHANGE','user',user.id); await destroySession(); return Response.json({ok:true});
  }
  const data=z.object({identity:z.string().min(1).max(200),password:z.string().min(1)}).parse(raw);
  const key=hashToken(`${req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown'}:${data.identity.toLowerCase()}`);
  const [attempt]=await db.select().from(loginAttempts).where(eq(loginAttempts.key,key)).limit(1);
  if(attempt?.blockedUntil && attempt.blockedUntil>new Date()) throw new AppError('Too many attempts. Please try again later.',429);
  const [user]=await db.select().from(users).where(or(eq(users.email,data.identity.toLowerCase()),eq(users.username,data.identity.toLowerCase()))).limit(1);
  let allowed=!!user?.active;
  if(user?.organizationId) { const [org]=await db.select({active:organizations.active}).from(organizations).where(eq(organizations.id,user.organizationId)); allowed=allowed && !!org?.active; }
  if(!allowed || !user || !await compare(data.password,user.passwordHash)) {
   const count=(attempt && Date.now()-attempt.updatedAt.getTime()<15*60000 ? attempt.count : 0)+1;
   await db.insert(loginAttempts).values({key,count,blockedUntil:count>=5?new Date(Date.now()+15*60000):null,updatedAt:new Date()}).onConflictDoUpdate({target:loginAttempts.key,set:{count,blockedUntil:count>=5?new Date(Date.now()+15*60000):null,updatedAt:new Date()}});
   await audit(user?.organizationId||null,user?.id||null,'FAILED_LOGIN','auth');
   throw new AppError('Invalid credentials.',401);
  }
  await db.delete(loginAttempts).where(eq(loginAttempts.key,key));
  await db.update(users).set({lastLoginAt:new Date()}).where(eq(users.id,user.id));
  await createSession(user.id); await audit(user.organizationId,user.id,'LOGIN','auth',user.id);
  return Response.json({ok:true,role:user.role});
 } catch(e) { if(e instanceof AppError) return Response.json({error:e.message},{status:e.status}); if(e instanceof z.ZodError){ const passwordIssue=e.issues.find(i=>i.path.includes('password')); return Response.json({error:passwordIssue?.message||'Please check the information entered.'},{status:400}); } console.error('Auth request failed',e); return Response.json({error:'An unexpected error occurred.'},{status:500}); }
}
