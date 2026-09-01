// =============================================================================
// B.R.A.N.D 2.0 — TEST classroom fixture Auth-admin bridge
//
// This is the only component that creates or resets passwords for auth.users.
// The browser never receives the service-role key.  The database migration
// receives only pre-created Auth UUIDs through its service-role-only RPC.
// =============================================================================

import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const fixtureCode = 'BRAND_TEST_V1';
const testStudentCodes = ['TEST01', 'TEST02', 'TEST03', 'TEST04', 'TEST05'] as const;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type RequestBody =
  | { action: 'reconcile'; initialPassword: string }
  | { action: 'reset_passwords'; newPassword: string };

interface FixtureIdentity {
  subject: 'TEST_TEACHER' | (typeof testStudentCodes)[number];
  email: string;
  user: User;
  created: boolean;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function requireEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} environment variable is required.`);
  return value;
}

function fixtureEmails(domain: string) {
  const normalizedDomain = domain.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalizedDomain)) {
    throw new Error('TEST_FIXTURE_EMAIL_DOMAIN must be a valid mail domain.');
  }

  return {
    TEST_TEACHER: `brand-test-teacher@${normalizedDomain}`,
    TEST01: `brandtest01@${normalizedDomain}`,
    TEST02: `brandtest02@${normalizedDomain}`,
    TEST03: `brandtest03@${normalizedDomain}`,
    TEST04: `brandtest04@${normalizedDomain}`,
    TEST05: `brandtest05@${normalizedDomain}`,
  } as const;
}

function generateSyntheticEmail(studentName: string, classroomId: number): string {
  const hex = Array.from(studentName.trim())
    .map((character) => character.codePointAt(0)!.toString(16).padStart(4, '0'))
    .join('');
  return `${hex}@cls${classroomId}.brand.local`;
}

function validatePassword(password: unknown): password is string {
  return typeof password === 'string'
    && password.length >= 6
    && password.length <= 128;
}

function isFixtureUser(user: User, subject: FixtureIdentity['subject']): boolean {
  const metadata = user.user_metadata ?? {};
  return metadata.fixture_code === fixtureCode && metadata.fixture_subject === subject;
}

async function listFixtureUsers(admin: ReturnType<typeof createClient>): Promise<User[]> {
  const users: User[] = [];

  // Auth Admin API has no safe exact e-mail lookup.  Page through bounded
  // result pages and accept only accounts carrying our explicit metadata.
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Auth user list failed: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  return users;
}

async function findOrCreateFixtureIdentity(
  admin: ReturnType<typeof createClient>,
  users: User[],
  subject: FixtureIdentity['subject'],
  email: string,
  password: string,
  allowCreate: boolean,
  acceptedExistingEmails: string[] = [email],
): Promise<FixtureIdentity> {
  const managed = users.filter((user) => isFixtureUser(user, subject));
  if (managed.length > 1) {
    throw new Error(`More than one managed ${subject} Auth account exists. Stop and inspect Auth users.`);
  }

  const accepted = new Set(acceptedExistingEmails.map((value) => value.toLowerCase()));
  accepted.add(email.toLowerCase());

  if (managed.length === 1) {
    const user = managed[0];
    if (!user.email || !accepted.has(user.email.toLowerCase())) {
      throw new Error(`${subject} Auth account has an unexpected e-mail address. Stop and inspect Auth users.`);
    }
    return { subject, email: user.email, user, created: false };
  }

  const sameEmail = users.find((user) => accepted.has(user.email?.toLowerCase() ?? ''));
  if (sameEmail) {
    throw new Error(`${sameEmail.email ?? email} already exists but is not the managed ${subject} fixture account. It will not be adopted.`);
  }

  if (!allowCreate) {
    throw new Error(`The registered TEST fixture is missing its managed ${subject} Auth account. It will not be recreated or relinked automatically.`);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      fixture_code: fixtureCode,
      fixture_subject: subject,
    },
  });
  if (error || !data.user) throw new Error(`Could not create ${subject}: ${error?.message ?? 'missing user result'}`);

  return { subject, email, user: data.user, created: true };
}

async function validateTeacherRequest(request: Request, projectUrl: string, anonKey: string) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return { error: json(401, { error: '로그인 정보를 확인할 수 없어요.' }) };

  const caller = createClient(projectUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return { error: json(401, { error: '로그인 세션이 만료되었어요. 다시 로그인해주세요.' }) };

  const { data: isTeacher, error: roleError } = await caller.rpc('is_teacher_or_admin');
  if (roleError || isTeacher !== true) return { error: json(403, { error: '교사 또는 관리자 계정만 TEST fixture를 관리할 수 있어요.' }) };

  return { userId: userData.user.id };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'POST 요청만 사용할 수 있어요.' });

  try {
    const projectUrl = requireEnvironment('SUPABASE_URL');
    const anonKey = requireEnvironment('SUPABASE_ANON_KEY');
    const serviceRoleKey = requireEnvironment('SUPABASE_SERVICE_ROLE_KEY');
    const emailDomain = requireEnvironment('TEST_FIXTURE_EMAIL_DOMAIN');

    const identity = await validateTeacherRequest(request, projectUrl, anonKey);
    if ('error' in identity) return identity.error;

    const body = await request.json() as Partial<RequestBody>;
    if (body.action !== 'reconcile' && body.action !== 'reset_passwords') {
      return json(400, { error: '지원하지 않는 TEST fixture 작업이에요.' });
    }

    const password = body.action === 'reconcile' ? body.initialPassword : body.newPassword;
    if (!validatePassword(password)) {
      return json(400, { error: 'TEST 계정 비밀번호는 6자 이상 128자 이하로 입력해주세요.' });
    }

    const admin = createClient(projectUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const emails = fixtureEmails(emailDomain);
    const { data: existingFixtures, error: fixtureReadError } = await admin
      .from('test_classroom_fixtures')
      .select('id, classroom_id')
      .eq('fixture_code', fixtureCode)
      .limit(2);
    if (fixtureReadError) throw new Error(`Fixture registry read failed. Apply the TEST fixture SQL migration first: ${fixtureReadError.message}`);
    if ((existingFixtures?.length ?? 0) > 1) throw new Error('More than one BRAND_TEST_V1 registry row exists. Stop and inspect the database.');

    // Only the first reconcile may create Auth accounts. Once the marker
    // exists, missing or mismatched identities are an integrity incident, not
    // something this endpoint silently repairs.
    const allowCreate = body.action === 'reconcile' && (existingFixtures?.length ?? 0) === 0;
    const knownUsers = await listFixtureUsers(admin);
    const teacher = await findOrCreateFixtureIdentity(admin, knownUsers, 'TEST_TEACHER', emails.TEST_TEACHER, password, allowCreate);

    const existingClassroomId = existingFixtures?.[0]?.classroom_id == null
      ? null
      : Number(existingFixtures[0].classroom_id);
    const students: FixtureIdentity[] = [];
    for (const studentCode of testStudentCodes) {
      const bootstrapEmail = emails[studentCode];
      const syntheticEmail = existingClassroomId == null
        ? null
        : generateSyntheticEmail(studentCode, existingClassroomId);
      students.push(await findOrCreateFixtureIdentity(
        admin,
        knownUsers,
        studentCode,
        syntheticEmail ?? bootstrapEmail,
        password,
        allowCreate,
        syntheticEmail ? [bootstrapEmail, syntheticEmail] : [bootstrapEmail],
      ));
    }

    if (body.action === 'reset_passwords') {
      for (const account of [teacher, ...students]) {
        const { error } = await admin.auth.admin.updateUserById(account.user.id, { password });
        if (error) throw new Error(`${account.subject} password reset failed: ${error.message}`);
      }

      return json(200, {
        status: 'PASSWORDS_RESET',
        fixture_code: fixtureCode,
        emails: [teacher, ...students].map((account) => ({ subject: account.subject, email: account.email })),
      });
    }

    const { data: fixture, error: reconcileError } = await admin.rpc('service_reconcile_test_classroom_fixture', {
      p_manager_user_id: identity.userId,
      p_test_teacher_user_id: teacher.user.id,
      p_test_student_auth_user_ids: students.map((student) => student.user.id),
    });
    if (reconcileError) throw new Error(`Fixture database reconciliation failed: ${reconcileError.message}`);

    const classroomId = Number((fixture as { classroom_id?: number } | null)?.classroom_id);
    if (!Number.isInteger(classroomId) || classroomId <= 0) {
      throw new Error('Fixture reconciliation did not return a valid classroom_id.');
    }

    // Reconcile is intentionally self-healing for TEST identities. A previous
    // attempt may have created Auth users before a later DB step failed. Always
    // align the managed fixture passwords with the value the teacher entered on
    // this run, so retrying the single "create/check" action is sufficient.
    const { data: updatedTeacher, error: teacherUpdateError } = await admin.auth.admin.updateUserById(teacher.user.id, {
      password,
    });
    if (teacherUpdateError || !updatedTeacher.user) {
      throw new Error(`TEST_TEACHER password synchronization failed: ${teacherUpdateError?.message ?? 'missing user result'}`);
    }
    const finalTeacher: FixtureIdentity = { ...teacher, user: updatedTeacher.user };

    const finalStudents: FixtureIdentity[] = [];
    for (const student of students) {
      const desiredEmail = generateSyntheticEmail(student.subject, classroomId);
      const collision = knownUsers.find((user) =>
        user.id !== student.user.id && user.email?.toLowerCase() === desiredEmail.toLowerCase()
      );
      if (collision) {
        throw new Error(`${desiredEmail} already belongs to another Auth account. Stop and inspect Auth users.`);
      }

      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(student.user.id, {
        email: desiredEmail,
        email_confirm: true,
        password,
      });
      if (updateError || !updated.user) {
        throw new Error(`${student.subject} login identity synchronization failed: ${updateError?.message ?? 'missing user result'}`);
      }
      finalStudents.push({ ...student, email: desiredEmail, user: updated.user });
    }

    return json(200, {
      status: 'RECONCILED',
      fixture,
      accounts: [finalTeacher, ...finalStudents].map((account) => ({
        subject: account.subject,
        email: account.email,
        created: account.created,
      })),
    });
  } catch (error) {
    console.error('[test-classroom-fixture]', error);
    return json(500, {
      error: 'TEST fixture 준비를 완료하지 못했어요.',
      detail: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});
