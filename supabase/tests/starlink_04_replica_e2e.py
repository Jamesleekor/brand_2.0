#!/usr/bin/env python3
"""
B.R.A.N.D 2.0 — Starlink #04 + period force-finalize E2E on an ISOLATED replica.

Never point this at production. It rebuilds a local database from
supabase/tests/replica (production-identical arcade/tikatuka schema+functions)
and calls the real RPCs with real Supabase-style JWT context
(request.jwt.claim.sub + ROLE authenticated), exactly like PostgREST.

Clock note: the shared core requires a real 5 s countdown and ~60 s play.
Most scenarios age countdown_started_at / play_started_at as superuser to save
time; scenario RT runs 24 students in real time with no clock manipulation.

usage: python3 supabase/tests/starlink_04_replica_e2e.py [--skip-realtime]
"""
import json, os, subprocess, sys, threading, time, uuid, traceback
import psycopg2, psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DB = os.environ.get('STARLINK_E2E_DB', 'starlink_e2e')
DSN = f"host={os.environ.get('PGHOST','/tmp')} port={os.environ.get('PGPORT','54329')} user={os.environ.get('PGUSER','postgres')} dbname={DB}"
BOT = os.path.join(ROOT, '.starlink-test-build/src/features/arcade/games/starlink_04/tests/bot-cli.js')
SKIP_RT = '--skip-realtime' in sys.argv

RESULTS = []
def check(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ''), flush=True)
    return cond

# ---------------------------------------------------------------- db helpers
def su():
    c = psycopg2.connect(DSN); c.autocommit = True; return c
SU = None
def q(sql, args=None, one=False):
    with SU.cursor() as cur:
        cur.execute(sql, args)
        if cur.description is None: return None
        rows = cur.fetchall()
        return rows[0] if one else rows
def q1(sql, args=None):
    r = q(sql, args, one=True); return None if r is None else r[0]

class Actor:
    def __init__(self, uid):
        self.uid = uid
        self.conn = psycopg2.connect(DSN); self.conn.autocommit = True
        with self.conn.cursor() as cur:
            cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid,))
            cur.execute("set role authenticated")
    def call(self, sql, args=None):
        """Returns (result, pgcode). pgcode None on success."""
        try:
            with self.conn.cursor() as cur:
                cur.execute(sql, args)
                r = cur.fetchone()
                return (r[0] if r else None), None
        except psycopg2.Error as e:
            return None, (e.pgcode or 'ERR') + ':' + (e.pgerror or '').split('\n')[0][:160]
    def close(self): self.conn.close()

def code(err): return None if err is None else err.split(':', 1)[0]

def bots(seeds):
    if not seeds: return {}
    out = subprocess.run(['node', BOT] + [str(s) for s in seeds], capture_output=True, text=True, check=True).stdout
    return {r['seed']: r for r in json.loads(out)}

# ---------------------------------------------------------------- fixture
TEACHER = str(uuid.UUID(int=1))
STUDENT_UIDS = [str(uuid.UUID(int=1000 + i)) for i in range(1, 25)]
TEST_ACCOUNT_UID = str(uuid.UUID(int=999))
SID = {}  # uid -> student id
CLASSROOM = None
G1, G7 = 1, 7
G4 = None

def fixture():
    global CLASSROOM, G4
    CLASSROOM = q1("insert into classrooms(teacher_user_id,is_active,name) values (%s,true,'5-4 replica') returning id", (TEACHER,))
    for i, uid in enumerate(STUDENT_UIDS, 1):
        SID[uid] = q1("insert into students(user_id,classroom_id,role,name,brand_name) values (%s,%s,'STUDENT',%s,%s) returning id", (uid, CLASSROOM, f'학생{i:02d}', f'B{i:02d}'))
    SID[TEST_ACCOUNT_UID] = q1("insert into students(user_id,classroom_id,role,name,is_test_account) values (%s,%s,'STUDENT','QA',true) returning id", (TEST_ACCOUNT_UID, CLASSROOM))
    G4 = q1("select id from arcade_games where code='starlink_04'")

def make_period(name, ym, start_offset, end_offset, status='ACTIVE'):
    return q1("""insert into arcade_ranking_periods(classroom_id,period_kind,display_name,contribution_year_month,starts_at,ends_at_exclusive,status,created_by_user_id)
                 values (%s,'MONTHLY',%s,%s,now()+%s::interval,now()+%s::interval,%s,%s) returning id""",
              (CLASSROOM, name, ym, start_offset, end_offset, status, TEACHER))

def synthetic_verified_run(student_id, game_id, score, at_offset):
    rv = q1("select id from arcade_game_rule_versions where game_id=%s and is_active", (game_id,))
    return q1("""insert into arcade_runs(classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,countdown_started_at,play_started_at,game_over_at,submitted_at,verified_at,official_score,official_duration_ms,stats)
                 values (%s,%s,%s,%s,'VERIFIED',12345,now()+%s::interval-interval '70 s',now()+%s::interval-interval '65 s',now()+%s::interval,now()+%s::interval,now()+%s::interval,%s,60000,'{}') returning id""",
              (CLASSROOM, student_id, game_id, rv, at_offset, at_offset, at_offset, at_offset, at_offset, score))

def ready_countdown(run_id): q("update arcade_runs set countdown_started_at=countdown_started_at-interval '6 seconds' where id=%s", (run_id,))
def age_play(run_id, ms): q("update arcade_runs set play_started_at=play_started_at-(%s||' milliseconds')::interval where id=%s", (str(ms), run_id))

def begin_sql(): return "select public.student_begin_starlink_04_run(%s)"
def submit_sql(): return "select public.student_submit_starlink_04_run(%s,%s::uuid,%s::jsonb,%s)"

def create_and_begin(actor, verification_session=None):
    if verification_session is None:
        boot, err = actor.call("select public.student_create_arcade_run('starlink_04')")
    else:
        boot, err = actor.call("select public.student_create_arcade_verification_run(%s,%s::uuid)", (verification_session, str(uuid.uuid4())))
    if err: return None, None, err
    ready_countdown(boot['run_id'])
    started, err = actor.call(begin_sql(), (boot['run_id'],))
    return boot, started, err

def submit_bot(actor, run_id, started, bot, age=True, events=None, end=None):
    if age: age_play(run_id, bot['submissionWallMs'] + 400)
    ev = bot['events'] if events is None else events
    return actor.call(submit_sql(), (run_id, started['run_nonce'], json.dumps(ev), bot['submissionWallMs'] if end is None else end))

# ---------------------------------------------------------------- scenarios
def scenario_hidden_and_access():
    s1 = Actor(STUDENT_UIDS[0])
    _, err = s1.call("select public.student_create_arcade_run('starlink_04')")
    check('H1 hidden Starlink cannot be started by a normal student', code(err) == 'P0197', err)
    acc, _ = s1.call("select public.student_get_arcade_game_access('starlink_04')")
    check('H2 game access reports CLOSED while hidden', acc and acc['mode'] == 'CLOSED', json.dumps(acc))
    # pre-release tester (existing teacher RPC)
    t = Actor(TEACHER)
    _, err = t.call("select public.teacher_set_arcade_prerelease_test_access(%s,'starlink_04',true)", (SID[STUDENT_UIDS[1]],))
    check('H3 teacher grants pre-release access with existing RPC', err is None, err)
    s2 = Actor(STUDENT_UIDS[1])
    boot, started, err = create_and_begin(s2)
    check('H4 pre-release tester can play; run is is_prerelease_test', err is None and boot['is_prerelease_test'] is True, err or '')
    if not err:
        bot = bots([started['gameplay_seed']])[started['gameplay_seed']]
        res, err = submit_bot(s2, boot['run_id'], started, bot)
        check('H5 pre-release run is server-verified (never ranked)', err is None and res['accepted'] and res['official_score'] == bot['score'], err or json.dumps(res)[:200])
    # freeze compatibility: a month that does not include 2099 ignores Starlink
    t.close(); s1.close(); s2.close()

def scenario_activate():
    q("update arcade_games set available_from=(now() at time zone 'Asia/Seoul')::date - 2 where code='starlink_04'")

def scenario_standard_security():
    s = Actor(STUDENT_UIDS[2]); other = Actor(STUDENT_UIDS[3])
    boot, err = s.call("select public.student_create_arcade_run('starlink_04')")
    check('S1 public Starlink run created (COUNTDOWN)', err is None and boot['game_code'] == 'starlink_04', err or '')
    run_id = boot['run_id']
    check('S2 no gameplay binding exists during countdown', q1("select count(*) from arcade_starlink_04_run_bindings where run_id=%s", (run_id,)) == 0)
    _, err = s.call(begin_sql(), (run_id,))
    check('S3 begin refused before the 5 s countdown ends', code(err) == 'P0201', err)
    ready_countdown(run_id)
    _, err = other.call(begin_sql(), (run_id,))
    check('S4 another student cannot begin my run', code(err) == 'P0199', err)
    started, err = s.call(begin_sql(), (run_id,))
    check('S5 begin returns hidden gameplay_seed + nonce (schedule_seed not reused)', err is None and started['gameplay_seed'] != boot['schedule_seed'] and 'schedule_seed' not in started, err or '')
    seed = started['gameplay_seed']
    bot = bots([seed])[seed]
    # direct access attempts
    _, err = s.call("select gameplay_seed from public.arcade_starlink_04_run_bindings limit 1")
    check('S6 students cannot read seed bindings table', code(err) == '42501', err)
    _, err = s.call("select public.arcade_starlink_04_replay(1,'[]'::jsonb,60000)")
    check('S7 students cannot execute server replay helper', code(err) == '42501', err)
    _, err = s.call("update public.arcade_runs set official_score=999999 where id=%s returning 1", (run_id,))
    check('S8 students cannot write arcade_runs directly', code(err) == '42501', err)
    # nonce / ownership / timing
    _, err = s.call(submit_sql(), (run_id, str(uuid.uuid4()), json.dumps(bot['events']), bot['submissionWallMs']))
    check('S9 forged nonce rejected without touching the run', code(err) == 'P0285' and q1("select status from arcade_runs where id=%s", (run_id,)) == 'PLAYING', err)
    _, err = other.call(submit_sql(), (run_id, started['run_nonce'], json.dumps(bot['events']), bot['submissionWallMs']))
    check('S10 another student cannot submit my run', code(err) == 'P0199', err)
    res, err = s.call(submit_sql(), (run_id, started['run_nonce'], json.dumps(bot['events']), bot['submissionWallMs']))
    check('S11 submit before real game end → SERVER_TIME_TOO_EARLY (wall envelope)', err is None and res['code'] == 'SERVER_TIME_TOO_EARLY', err or json.dumps(res)[:200])
    # fresh run: valid
    boot, started, err = create_and_begin(s)
    seed = started['gameplay_seed']; bot = bots([seed])[seed]
    res, err = submit_bot(s, boot['run_id'], started, bot)
    ok = err is None and res['accepted'] and res['official_score'] == bot['score']
    check('S12 valid run accepted; server score == client/TS score', ok, err or f"server={res and res.get('official_score')} ts={bot['score']}")
    st = res['stats'] if res else {}
    check('S13 official stats bundle from same replay (snake_case)', st.get('max_combo') == bot['stats']['maxCombo'] and st.get('loop_count') == bot['stats']['loopCount'] and st.get('reshuffle_count') == bot['stats']['reshuffleCount'], json.dumps(st))
    go = q("select extract(epoch from game_over_at-play_started_at)*1000 from arcade_runs where id=%s", (boot['run_id'],))[0][0]
    check('S14 game_over_at = PLAYING + 60 s + reshuffle pauses', int(round(float(go))) == bot['gameEndWallMs'], f"{go} vs {bot['gameEndWallMs']}")
    res2, err2 = s.call(submit_sql(), (boot['run_id'], started['run_nonce'], json.dumps(bot['events']), bot['submissionWallMs']))
    check('S15 duplicate identical submit is idempotent', err2 is None and res2['idempotent_replay'] and res2['official_score'] == res['official_score'], err2 or '')
    tampered = list(bot['events'])[:-1]
    _, err3 = s.call(submit_sql(), (boot['run_id'], started['run_nonce'], json.dumps(tampered), bot['submissionWallMs']))
    check('S16 different payload for a submitted run rejected (P0286)', code(err3) == 'P0286', err3)
    # structurally impossible input
    boot, started, err = create_and_begin(s)
    seed = started['gameplay_seed']; bot = bots([seed])[seed]
    bad = [{'type': 'CELL_ENTER', 'elapsed_ms': 10, 'cell': 3}]
    res, err = submit_bot(s, boot['run_id'], started, bot, events=bad, end=60000)
    check('S17 impossible input log → REJECTED (REPLAY_REJECTED)', err is None and res['accepted'] is False and res['code'] == 'REPLAY_REJECTED', err or json.dumps(res)[:200])
    boot, started, err = create_and_begin(s)
    seed = started['gameplay_seed']; bot = bots([seed])[seed]
    fat = [{'type': 'PATH_START', 'elapsed_ms': 1, 'cell': 0}] * 5001
    res, err = submit_bot(s, boot['run_id'], started, bot, events=fat, end=60000)
    check('S18 >5,000 events → INPUT_EVENTS_INVALID', err is None and res['code'] == 'INPUT_EVENTS_INVALID', err or json.dumps(res)[:200])
    s.close(); other.close()

def scenario_ts_sql_equivalence(n=160):
    seeds = [((i * 2654435761) ^ 0x5bd1e995) % 4294967295 + 1 for i in range(1, n + 1)] + [6059, 8]
    data = bots(seeds)
    mismatches, loops, resh = [], 0, 0
    for s in seeds:
        b = data[s]
        r = q1("select public.arcade_starlink_04_replay(%s,%s::jsonb,%s)", (s, json.dumps(b['events']), b['submissionWallMs']))
        if r['official_score'] != b['score'] or r['stats'] != b['stats'] or r['game_end_wall_ms'] != b['gameEndWallMs']:
            mismatches.append(s)
        loops += r['stats']['loopCount']; resh += r['stats']['reshuffleCount']
    check(f'E1 TS == PostgreSQL replay for {len(seeds)} bot runs (score, stats, end wall)', not mismatches, f"mismatch seeds={mismatches[:5]} loops={loops} reshuffles={resh}")

def scenario_october_like():
    """Reproduces the 2026-10-30 production state: VERIFICATION, GAME1 open,
    GAME2 closed, 18 ACTIVE sessions, 1 in-progress verification run, 1 ACTIVE
    Rakaruka challenge. The old Guild5 function aborts; the new one finalizes."""
    t = Actor(TEACHER)
    pid = make_period('2026년 10월 Arcade (replica)', '2026-10', '-25 days', '-6 days')
    for i, uid in enumerate(STUDENT_UIDS):
        synthetic_verified_run(SID[uid], G1, 1000 + i * 37, '-10 days')
        if i % 2 == 0: synthetic_verified_run(SID[uid], G7, 500 + i * 11, '-9 days')
    _, err = t.call("select public.teacher_freeze_arcade_monthly_period(%s)", (pid,))
    check('O1 freeze succeeds with hidden Starlink registered (no P0260)', err is None, err)
    # GAME2 verification force-closed (as in production)
    _, err = t.call("select public.teacher_force_close_arcade_game_verification(%s,'pure_reaction_02','replica: game2 closed')", (pid,))
    check('O2 GAME2 closed with existing per-game function', err is None, err)
    sess = []
    for uid in STUDENT_UIDS[:18]:
        r, err = t.call("select public.teacher_start_arcade_verification_session(%s,'focus_reaction_01',%s)", (pid, SID[uid]))
        sess.append(r['session_id'])
    s = Actor(STUDENT_UIDS[0])
    boot, err = s.call("select public.student_create_arcade_verification_run(%s,%s::uuid)", (sess[0], str(uuid.uuid4())))
    check('O3 one verification attempt in progress (COUNTDOWN)', err is None, err)
    q("insert into tikatuka_official_sessions(classroom_id,student_id,period_key,difficulty,status,games_played,wins,draws,losses,points,arcade_period_id) values (%s,%s,current_date,4,'ACTIVE',2,1,0,1,3,%s)", (CLASSROOM, SID[STUDENT_UIDS[5]], pid))
    before_other = q1("select md5(string_agg(id||status, ',' order by id)) from arcade_ranking_periods where id<>%s", (pid,))
    # old production function (exact prod logic, renamed) must abort here
    old = open(os.path.join(HERE, 'replica', '02_functions.sql'), encoding='utf-8').read()
    import re
    m = re.search(r"CREATE OR REPLACE FUNCTION public\.teacher_force_finalize_arcade_month_for_guild5\(.*?\n\$function\$;", old, re.S)
    q(m.group(0).replace('public.teacher_force_finalize_arcade_month_for_guild5(', 'public._old_guild5_force(', 1))
    q("grant execute on function public._old_guild5_force(text,text) to authenticated")
    _, err = t.call("select public._old_guild5_force('2026-10','replica: old path')")
    check('O4 OLD Guild5 force function aborts in this state (reproduces the reported problem)', code(err) == 'P0268', err)
    prev, err = t.call("select public.teacher_get_arcade_force_finalize_preview(%s)", (pid,))
    g1 = next(g for g in prev['games'] if g['game_code'] == 'focus_reaction_01') if prev else {}
    check('O5 preview shows 18 active sessions, 1 in-progress run, 1 Rakaruka active', prev and g1['active_sessions'] == 18 and g1['in_progress_runs'] == 1 and prev['rakaruka']['active'] == 1, err or json.dumps({k: g1.get(k) for k in ('active_sessions', 'in_progress_runs', 'plan_counts')}))
    res, err = t.call("select public.teacher_force_finalize_arcade_month_for_guild5('2026-10','replica: 미완료 포함 즉시 확정')")
    check('O6 NEW Guild5 button path finalizes immediately', err is None and res['status'] == 'FINALIZED' and res['forced_ready'] is True, err or json.dumps(res)[:300])
    check('O7 period FINALIZED, snapshots for frozen games only (Starlink excluded)', q1("select status from arcade_ranking_periods where id=%s", (pid,)) == 'FINALIZED' and q1("select array_agg(game_id order by game_id) from arcade_monthly_snapshots where period_id=%s", (pid,)) == [G1, G7])
    check('O8 no ACTIVE session / no in-progress verification run remains', q1("select count(*) from arcade_verification_sessions where period_id=%s and status='ACTIVE'", (pid,)) == 0 and q1("select count(*) from arcade_runs r join arcade_verification_sessions s on s.id=r.verification_session_id where s.period_id=%s and r.status in ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')", (pid,)) == 0)
    check('O9 in-progress attempt returned (TECHNICAL_CANCELLED, not consumed)', q1("select status||'/'||consumed from arcade_verification_attempts where run_id=%s", (boot['run_id'],)) == 'TECHNICAL_CANCELLED/false')
    check('O10 Rakaruka unfinished challenge CANCELLED, not ranked', q1("select status from tikatuka_official_sessions where arcade_period_id=%s", (pid,)) == 'CANCELLED' and q1("select count(*) from tikatuka_monthly_official_snapshot_entries e join tikatuka_monthly_official_snapshots s on s.id=e.snapshot_id where s.period_id=%s", (pid,)) == 0)
    check('O11 Guild 2 refresh called exactly once', q1("select count(*) from _replica_guild2_refresh_calls where year_month='2026-10'") == 1)
    check('O12 other periods untouched', before_other == q1("select md5(string_agg(id||status, ',' order by id)) from arcade_ranking_periods where id<>%s", (pid,)))
    top = q("select e.rank,e.student_id,e.official_score from arcade_monthly_snapshot_entries e join arcade_monthly_snapshots s on s.id=e.snapshot_id where s.period_id=%s and s.game_id=%s order by e.rank", (pid, G1))
    proj = [(r['rank'], r['student_id'], r['score']) for r in g1.get('projected_top10', [])]
    check('O13 final GAME1 Top 10 == preview projection', [(a, b, int(c)) for a, b, c in top] == [(a, b, int(c)) for a, b, c in proj], f"top={top[:3]} proj={proj[:3]}")
    late, err = s.call("select public.student_begin_arcade_run(%s)", (boot['run_id'],))
    check('O14 late action on cancelled run cannot revive it', err is not None, err)
    again, err = t.call("select public.teacher_force_finalize_arcade_period(%s,'again')", (pid,))
    check('O15 repeat call is idempotent (already_finalized)', err is None and again['already_finalized'] is True, err or '')
    _, err = t.call("select public.teacher_restore_arcade_verification_attempt(%s,'after final')", (q1("select id from arcade_verification_attempts where run_id=%s", (boot['run_id'],)),))
    check('O16 FINALIZED period cannot be mutated afterwards (P0216)', code(err) == 'P0216', err)
    t.close(); s.close()

def scenario_starlink_month():
    """Starlink inside a live monthly cycle: provisional freeze, A/B/C pack,
    24 concurrent verification runs, technical recovery, success/failure, and a
    force finalize racing 3 live submissions."""
    t = Actor(TEACHER)
    pid = make_period('2026년 11월 Arcade (replica)', '2026-11', '-3 hours', '+2 hours')
    actors = {uid: Actor(uid) for uid in STUDENT_UIDS}
    # real standard Starlink runs for 6 students (provisional source = real server runs)
    boots = {}
    for uid in STUDENT_UIDS[:6]:
        boot, started, err = create_and_begin(actors[uid]); boots[uid] = (boot, started)
    data = bots([b[1]['gameplay_seed'] for b in boots.values()])
    real_scores = {}
    for uid, (boot, started) in boots.items():
        res, err = submit_bot(actors[uid], boot['run_id'], started, data[started['gameplay_seed']])
        real_scores[uid] = res['official_score'] if res else None
    check('M1 six real standard Starlink runs verified', all(v is not None for v in real_scores.values()), json.dumps(real_scores))
    # synthetic provisional records for the rest: low → easy success, huge → failure
    for i, uid in enumerate(STUDENT_UIDS[6:], 6):
        score = 50 if i % 3 == 0 else (10_000_000 if i % 3 == 1 else 1500)
        synthetic_verified_run(SID[uid], G4, score, '-2 hours')
        synthetic_verified_run(SID[uid], G1, 900 + i, '-2 hours')
    _, err = t.call("select public.teacher_end_arcade_ranking_period_now(%s)", (pid,))
    _, err = t.call("select public.teacher_freeze_arcade_monthly_period(%s)", (pid,))
    check('M2 freeze includes Starlink once it is public', err is None and q1("select count(*) from arcade_verification_period_games where period_id=%s and game_id=%s", (pid, G4)) == 1, err)
    sessions = {}
    for uid in STUDENT_UIDS:
        r, err = t.call("select public.teacher_start_arcade_verification_session(%s,'starlink_04',%s)", (pid, SID[uid]))
        sessions[uid] = r['session_id']
    # 24 concurrent create+begin
    out, errs, barrier = {}, [], threading.Barrier(24)
    def go(uid):
        try:
            barrier.wait()
            boot, err = actors[uid].call("select public.student_create_arcade_verification_run(%s,%s::uuid)", (sessions[uid], str(uuid.uuid4())))
            if err: errs.append(err); return
            ready_countdown(boot['run_id'])
            started, err = actors[uid].call(begin_sql(), (boot['run_id'],))
            if err: errs.append(err); return
            out[uid] = (boot, started)
        except Exception as e: errs.append(repr(e))
    th = [threading.Thread(target=go, args=(u,)) for u in STUDENT_UIDS]; [x.start() for x in th]; [x.join() for x in th]
    check('M3 24 concurrent verification begins: no errors/deadlocks', not errs and len(out) == 24, '; '.join(errs[:3]))
    packs = q("select id,status from arcade_starlink_04_seed_packs where period_id=%s", (pid,))
    check('M4 exactly one A/B/C pack, LOCKED at first PLAYING', len(packs) == 1 and packs[0][1] == 'LOCKED', str(packs))
    pack_id = packs[0][0]
    slots = dict(q("select slot,gameplay_seed from arcade_starlink_04_seed_pack_slots where pack_id=%s", (pack_id,)))
    check('M5 three distinct SOFT-preflighted seeds', len(set(slots.values())) == 3 and q1("select bool_and(initial_accepted_by='SOFT' and initial_largest_component<=8) from arcade_starlink_04_seed_pack_slots where pack_id=%s", (pack_id,)))
    orders = dict((r[0], r[1]) for r in q("select student_id,slot_order from arcade_starlink_04_seed_orders where pack_id=%s", (pack_id,)))
    ok = all(started['gameplay_seed'] == slots[orders[SID[uid]][0]] for uid, (b, started) in out.items())
    check('M6 attempt #1 seed == slot of each student\'s immutable permutation', ok and len(orders) == 24)
    check('M7 permutations are randomized (not all identical)', len(set(tuple(v) for v in orders.values())) > 1, str(set(tuple(v) for v in orders.values())))
    _, err = Actor(STUDENT_UIDS[0]).call("select public.student_create_arcade_verification_run(%s,%s::uuid)", (sessions[STUDENT_UIDS[0]], str(uuid.uuid4())))
    check('M8 second concurrent verification execution refused (P0269)', code(err) == 'P0269', err)
    for sql, label in [("update arcade_starlink_04_seed_pack_slots set gameplay_seed=gameplay_seed+1 where pack_id=%s", 'update slot'),
                       ("delete from arcade_starlink_04_seed_pack_slots where pack_id=%s", 'delete slot'),
                       ("update arcade_starlink_04_seed_packs set status='READY', locked_at=null where id=%s", 'unlock pack'),
                       ("update arcade_starlink_04_seed_orders set slot_order=array['A','B','C'] where pack_id=%s", 'reroll order')]:
        try: q(sql, (pack_id,)); res = 'allowed'
        except psycopg2.Error as e: res = e.pgcode
        check(f'M9 pack immutability even for superuser: {label} blocked', res == 'P0280', res)
    # technical recovery for student #1: cancel → same opportunity, same seed, new nonce
    u0 = STUDENT_UIDS[0]; b0, s0 = out.pop(u0)
    _, err = t.call("select public.teacher_cancel_arcade_verification_run(%s,'replica: 크롬북 멈춤')", (b0['run_id'],))
    boot, started, err = create_and_begin(actors[u0], sessions[u0])
    check('M10 technical recovery: same opportunity → same seed, new run_id & nonce', err is None and started['gameplay_seed'] == s0['gameplay_seed'] and started['run_nonce'] != s0['run_nonce'] and boot['run_id'] != b0['run_id'], err or '')
    out[u0] = (boot, started)
    # 21 submit concurrently now; keep 3 PLAYING for the race
    racers = STUDENT_UIDS[21:24]
    seeds = sorted({started['gameplay_seed'] for (b, started) in out.values()})
    data = bots(seeds)
    errs2, barrier = [], threading.Barrier(21)
    def sub(uid):
        try:
            barrier.wait()
            b, st = out[uid]
            res, err = submit_bot(actors[uid], b['run_id'], st, data[st['gameplay_seed']])
            if err or not res['accepted'] or res['official_score'] != data[st['gameplay_seed']]['score']: errs2.append(err or json.dumps(res)[:120])
        except Exception as e: errs2.append(repr(e))
    th = [threading.Thread(target=sub, args=(u,)) for u in STUDENT_UIDS[:21]]; [x.start() for x in th]; [x.join() for x in th]
    check('M11 21 concurrent verification submits accepted, scores == TS', not errs2, '; '.join(errs2[:3]))
    check('M12 each submit captured exactly one attempt (no duplicates)', q1("select count(*) from arcade_verification_attempts a join arcade_verification_sessions s on s.id=a.session_id where s.period_id=%s and s.game_id=%s and a.status='TERMINAL' and a.consumed", (pid, G4)) == 21)
    # preview, then force finalize racing 3 live submissions
    prev, err = t.call("select public.teacher_get_arcade_force_finalize_preview(%s)", (pid,))
    g4 = next(g for g in prev['games'] if g['game_code'] == 'starlink_04')
    check('M13 preview shows Starlink plan incl. 3 live runs', g4['in_progress_runs'] == 3 and g4['active_sessions'] == 24, json.dumps({k: g4[k] for k in ('active_sessions', 'in_progress_runs', 'plan_counts')}))
    for uid in racers: age_play(out[uid][0]['run_id'], data[out[uid][1]['gameplay_seed']]['submissionWallMs'] + 400)
    race_res, barrier = {}, threading.Barrier(4)
    delays = {racers[0]: 0.0, racers[1]: 0.25, racers[2]: 0.6}   # mix: before / during / after the teacher
    def racer(uid):
        barrier.wait(); time.sleep(delays[uid])
        b, st = out[uid]
        race_res[uid] = submit_bot(actors[uid], b['run_id'], st, data[st['gameplay_seed']], age=False)
    def teacher():
        barrier.wait(); time.sleep(0.12)
        race_res['T'] = t.call("select public.teacher_force_finalize_arcade_period(%s,'replica: 미완료 포함 즉시 확정')", (pid,))
    th = [threading.Thread(target=racer, args=(u,)) for u in racers] + [threading.Thread(target=teacher)]
    [x.start() for x in th]; [x.join() for x in th]
    tres, terr = race_res['T']
    check('M14 force finalize succeeds while students submit (no deadlock)', terr is None and tres['status'] == 'FINALIZED', terr or '')
    dead = [v[1] for k, v in race_res.items() if v[1] and code(v[1]) == '40P01']
    check('M15 zero deadlocks (40P01) in the race', not dead, str(dead))
    consistent = True
    for uid in racers:
        res, err = race_res[uid]; rid = out[uid][0]['run_id']
        st = q1("select status from arcade_runs where id=%s", (rid,))
        at = q1("select status||'/'||consumed from arcade_verification_attempts where run_id=%s", (rid,))
        if err is None and res['accepted']:   # student won the race
            consistent &= st == 'VERIFIED' and at == 'TERMINAL/true'
        else:                                  # teacher won: run expired, never revived
            consistent &= st == 'EXPIRED' and at == 'TECHNICAL_CANCELLED/false' and code(err) == 'P0202'
    check('M16 each racing run is either captured-before-close or expired (never both)', consistent, json.dumps({u[-4:]: race_res[u][1] or 'accepted' for u in racers}))
    top = q("select e.rank,e.student_id,e.official_score from arcade_monthly_snapshot_entries e join arcade_monthly_snapshots s on s.id=e.snapshot_id where s.period_id=%s and s.game_id=%s order by e.rank", (pid, G4))
    check('M17 Starlink monthly Top 10 snapshot written', len(top) == 10, str(top[:3]))
    # every official Starlink source is a VERIFIED run of that student, stats from the same run
    bad = q1("""select count(*) from arcade_verification_official_results o join arcade_runs r on r.id=o.source_run_id
                where o.period_id=%s and o.game_id=%s and o.ranking_eligible and (r.student_id<>o.student_id or r.status<>'VERIFIED' or r.official_score<>o.official_score or r.stats<>o.stats)""", (pid, G4))
    check('M18 official score + stats always from one source run (bundle integrity)', bad == 0, f'bad={bad}')
    # success students whose verification beat their frozen 50-point record got the higher score
    up = q1("""select count(*) from arcade_verification_official_results o join arcade_verification_provisional_entries p on p.period_id=o.period_id and p.game_id=o.game_id and p.student_id=o.student_id
               where o.period_id=%s and o.game_id=%s and p.official_score=50 and o.official_score>50""", (pid, G4))
    check('M19 earned verification results preserved (higher than frozen record)', up > 0, f'upgraded={up}')
    for a in actors.values(): a.close()
    t.close()

def scenario_regression_game2():
    """Starlink trigger must not affect other games' lifecycle."""
    s = Actor(STUDENT_UIDS[4])
    boot, err = s.call("select public.student_create_arcade_run('pure_reaction_02')")
    ready_countdown(boot['run_id'])
    started, err = s.call("select public.student_begin_arcade_run(%s)", (boot['run_id'],))
    check('R1 GAME2 begin unchanged (returns schedule_seed, PLAYING)', err is None and started['schedule_seed'] == boot['schedule_seed'], err or '')
    check('R2 no Starlink binding for GAME2 runs', q1("select count(*) from arcade_starlink_04_run_bindings where run_id=%s", (boot['run_id'],)) == 0)
    age_play(boot['run_id'], 9000)
    res, err = s.call("select public.student_submit_pure_reaction_02_run(%s,'[]'::jsonb,8000)", (boot['run_id'],))
    check('R3 GAME2 submit path unchanged (server validator decides)', err is None and 'accepted' in res, err or json.dumps(res)[:160])
    _, err = s.call("select public.student_begin_starlink_04_run(%s)", (boot['run_id'],))
    check('R4 Starlink begin RPC refuses non-Starlink runs', code(err) == 'P0199', err)
    s.close()

def scenario_realtime():
    """24 students, real 5 s countdown + real 60 s play, no clock manipulation."""
    actors = [Actor(u) for u in STUDENT_UIDS]
    res, errs, barrier = {}, [], threading.Barrier(24)
    def life(a):
        try:
            barrier.wait()
            boot, err = a.call("select public.student_create_arcade_run('starlink_04')")
            if err: errs.append(err); return
            time.sleep(5.25)
            st, err = a.call(begin_sql(), (boot['run_id'],))
            if err: errs.append(err); return
            b = bots([st['gameplay_seed']])[st['gameplay_seed']]
            time.sleep(max(0, b['submissionWallMs'] / 1000 + 0.35 - 0.0))
            r, err = a.call(submit_sql(), (boot['run_id'], st['run_nonce'], json.dumps(b['events']), b['submissionWallMs']))
            if err or not r['accepted'] or r['official_score'] != b['score']: errs.append(err or json.dumps(r)[:120])
            res[a.uid] = r
        except Exception as e: errs.append(repr(e))
    t0 = time.time()
    th = [threading.Thread(target=life, args=(a,)) for a in actors]; [x.start() for x in th]; [x.join() for x in th]
    check(f'RT1 24 students real-time (countdown 5 s + 60 s play) all verified in {time.time()-t0:.0f}s', not errs and len(res) == 24, '; '.join(errs[:3]))
    for a in actors: a.close()

def main():
    global SU
    subprocess.run([os.path.join(HERE, 'replica', 'build.sh'), DB], check=True)
    SU = su()
    fixture()
    steps = [scenario_hidden_and_access, scenario_october_like, scenario_activate, scenario_standard_security,
             scenario_ts_sql_equivalence, scenario_starlink_month, scenario_regression_game2]
    if not SKIP_RT: steps.append(scenario_realtime)
    for step in steps:
        try: step()
        except Exception:
            check(f'{step.__name__} crashed', False, traceback.format_exc()[-600:])
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    with open(os.path.join(HERE, 'starlink_04_replica_e2e_last_run.json'), 'w', encoding='utf-8') as f:
        json.dump({'db': DB, 'at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'results': [{'name': n, 'pass': p, 'detail': d} for n, p, d in RESULTS]}, f, ensure_ascii=False, indent=1)
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
