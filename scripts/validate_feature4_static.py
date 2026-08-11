from pathlib import Path
import re, sys, json

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / 'supabase' / 'migrations'
MODULES = {
    'F4A': MIG / '20260807_02a_feature4_communications.sql',
    'F4B': MIG / '20260807_02b_feature4_operations.sql',
    'F4C': MIG / '20260807_02c_feature4_learning.sql',
    'F4D': MIG / '20260807_02d_feature4_records.sql',
}
PATCH = MIG / '20260808_01_feature4_1_stabilization.sql'
BASE_EXPECTED = {
 'F4A':['mark_mail_read','mark_global_alert_read','mark_all_global_alerts_read','teacher_send_mail','teacher_broadcast_alert'],
 'F4B':['activate_emergency','terminate_emergency','finalize_expired_emergencies_for_classroom','teacher_create_emergency_quest','teacher_close_emergency_quest','complete_emergency_quest','teacher_appoint_guard','teacher_end_guard_term'],
 'F4C':['submit_assignment','grade_assignment','teacher_create_assignment','teacher_set_assignment_status','teacher_record_attendance_bulk','teacher_correct_today_attendance'],
 'F4D':['teacher_refresh_classroom_records','teacher_add_hall_of_fame_entry','teacher_archive_hall_of_fame_entry','teacher_feature4_health_check'],
}
PATCH_EXPECTED = [
 'request_emergency_quest_completion','teacher_review_emergency_quest_request',
 'teacher_correct_attendance','refresh_all_classroom_records_kst','teacher_feature4_1_health_check'
]
FRONTEND_EXPECTED = {
 'F4A':['mark_mail_read','mark_global_alert_read','mark_all_global_alerts_read','teacher_send_mail','teacher_broadcast_alert'],
 'F4B':['activate_emergency','terminate_emergency','finalize_expired_emergencies_for_classroom','teacher_create_emergency_quest','teacher_close_emergency_quest','request_emergency_quest_completion','teacher_review_emergency_quest_request','teacher_appoint_guard','teacher_end_guard_term'],
 'F4C':['submit_assignment','grade_assignment','teacher_create_assignment','teacher_set_assignment_status','teacher_record_attendance_bulk','teacher_correct_attendance'],
 'F4D':['teacher_refresh_classroom_records','teacher_add_hall_of_fame_entry','teacher_archive_hall_of_fame_entry','teacher_feature4_1_health_check'],
}
errors=[]
for d,p in MODULES.items():
    if not p.exists(): errors.append(f'{d}: missing {p.name}'); continue
    s=p.read_text(encoding='utf-8')
    if s.count('$$') % 2: errors.append(f'{d}: unbalanced $$ delimiters')
    if len(re.findall(r'(?m)^BEGIN;\s*$',s)) != 1 or len(re.findall(r'(?m)^COMMIT;\s*$',s)) != 1:
        errors.append(f'{d}: expected exactly one BEGIN/COMMIT')
    if f'[{d}]' not in s: errors.append(f'{d}: diagnostic prefix missing')
    for fn in BASE_EXPECTED[d]:
        if f'FUNCTION public.{fn}' not in s: errors.append(f'{d}: base function definition missing: {fn}')

if not PATCH.exists():
    errors.append('Feature4.1 patch missing')
    patch=''
else:
    patch=PATCH.read_text(encoding='utf-8')
    if patch.count('$$') % 2: errors.append('F4.1: unbalanced $$ delimiters')
    if len(re.findall(r'(?m)^BEGIN;\s*$',patch)) != 1 or len(re.findall(r'(?m)^COMMIT;\s*$',patch)) != 1:
        errors.append('F4.1: expected exactly one BEGIN/COMMIT')
    for fn in PATCH_EXPECTED:
        if f'FUNCTION public.{fn}' not in patch: errors.append(f'F4.1: function definition missing: {fn}')
    for token in [
        "'brand_feature4_daily_records_2359_kst','59 14 * * *'",
        "ARRAY['emergency_quest_requests','assignments']",
        'REVOKE ALL ON FUNCTION public.complete_emergency_quest(integer,bigint) FROM PUBLIC,anon,authenticated',
    ]:
        if token not in patch: errors.append(f'F4.1: migration token missing: {token}')

bundle=(MIG/'20260807_02_feature4_bundle.sql')
if not bundle.exists(): errors.append('bundle missing')
else:
    s=bundle.read_text(encoding='utf-8')
    if len(re.findall(r'(?m)^BEGIN;\s*$',s)) != 4 or len(re.findall(r'(?m)^COMMIT;\s*$',s)) != 4:
        errors.append('bundle: expected four independent transactions')

app=(ROOT/'src/App.tsx').read_text(encoding='utf-8')
for route in ['/mail','/assignments','/records','/teacher/communications','/teacher/operations','/teacher/learning','/teacher/records']:
    if route not in app: errors.append(f'route missing: {route}')

rpc=(ROOT/'src/lib/rpc/feature4_rpc.ts').read_text(encoding='utf-8')
combined='\n'.join(p.read_text(encoding='utf-8') for p in MODULES.values()) + '\n' + patch
for d,names in FRONTEND_EXPECTED.items():
    for fn in names:
        if fn not in rpc and fn not in ('activate_emergency','terminate_emergency'):
            errors.append(f'{d}: RPC wrapper missing token: {fn}')
        if f'FUNCTION public.{fn}' not in combined:
            errors.append(f'{d}: SQL missing function: {fn}')

src_text='\n'.join(p.read_text(encoding='utf-8',errors='ignore') for p in (ROOT/'src').rglob('*') if p.suffix in ('.ts','.tsx'))
if re.search(r'(service[_-]?role\s*key|SUPABASE_SERVICE)',src_text,re.I):
    errors.append('frontend contains probable service-role credential reference')
if '돌발 퀘스트 백엔드가 아직 구현되지' in src_text:
    errors.append('old emergency-quest placeholder remains')
if "complete_emergency_quest',F4B" in rpc:
    errors.append('frontend still exposes direct emergency quest completion wrapper')

# Stabilization-specific UI tokens
checks={
 'dashboard_realtime':['emergency_quest_requests','assignments'],
 'communication_history':['{replace:true}',"navigate('/')"],
 'emergency_end_time':['datetime-local'],
 'attendance_calendar':['type="date"','correctAttendance'],
 'assignment_labels':['즉시 마감하기','종료된 과제'],
}
files={
 'dashboard_realtime':(ROOT/'src/features/dashboard/DashboardPage.tsx').read_text(encoding='utf-8'),
 'communication_history':(ROOT/'src/features/feature4/CommunicationPage.tsx').read_text(encoding='utf-8'),
 'emergency_end_time':(ROOT/'src/features/feature4/OperationsAdmin.tsx').read_text(encoding='utf-8'),
 'attendance_calendar':(ROOT/'src/features/feature4/LearningAdmin.tsx').read_text(encoding='utf-8'),
 'assignment_labels':(ROOT/'src/features/feature4/LearningAdmin.tsx').read_text(encoding='utf-8'),
}
for name,tokens in checks.items():
    for token in tokens:
        if token not in files[name]: errors.append(f'F4.1 UI check {name}: missing {token}')

result={'ok':not errors,'errors':errors,'modules':{d:p.name for d,p in MODULES.items()},'patch':PATCH.name}
print(json.dumps(result,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
