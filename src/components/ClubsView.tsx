'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, CheckCircle2, Edit3, Trash2, X, Search, Users, Clock3, FileArchive, Wand2, ClipboardList } from 'lucide-react';
import type { ModalConfig } from '@/components/Modal';
import { downloadClubReportsZip } from '@/lib/reportPdf';

type Club = { id: string; name: string; description: string | null; academicYearId: string | null; active: boolean };
type ClubTeacherRow = { clubId: string; teacherId: string; role: string; teacherName: string; active: boolean };
type MemberRow = { clubId: string; studentId: string; studentName: string; studentCode: string; className: string | null };
type ActivityRow = {
  id: string; clubId: string; title: string; activityDate: string; description: string; status: string;
  submittedAt: string | null; reviewedAt: string | null; reviewComment: string | null; createdAt: string;
};
type ActivityRecordRow = {
  id: string; clubActivityId: string; studentId: string; studentName: string; studentCode: string;
  punctuality: string | null; performance: string | null; participation: string | null; conduct: string | null; comment: string | null;
};
type Payload = {
  clubs: Club[];
  teachers: ClubTeacherRow[];
  members: MemberRow[];
  activities: ActivityRow[];
  records: ActivityRecordRow[];
  teacherOptions: { id: string; name: string; active: boolean }[];
  studentOptions?: { id: string; studentId: string; fullName: string; classId: string; className: string | null }[];
};

type ClubForm = { id?: string; name: string; description: string; academicYearId: string; active: boolean; teacherIds: string[]; studentIds: string[] };
type MemberRecord = { punctuality: string | null; performance: string | null; participation: string | null; conduct: string | null; comment: string };
type ActivityForm = { id?: string; clubId: string; title: string; activityDate: string; description: string; records: Record<string, MemberRecord> };

const PUNCTUALITY_OPTIONS = [
  ['ALWAYS_ON_TIME', 'Always On Time'],
  ['USUALLY_ON_TIME', 'Usually On Time'],
  ['OCCASIONALLY_LATE', 'Occasionally Late'],
  ['FREQUENTLY_LATE', 'Frequently Late'],
  ['OCCASIONALLY_ABSENT', 'Occasionally Absent'],
  ['FREQUENTLY_ABSENT', 'Frequently Absent'],
  ['ALWAYS_ABSENT', 'Always Absent'],
] as const;

const LEVEL_OPTIONS: Record<'performance' | 'participation' | 'conduct', string[]> = {
  performance: ['EXCELLENT', 'GOOD', 'NEEDS_IMPROVEMENT'],
  participation: ['ACTIVE', 'MODERATE', 'PASSIVE'],
  conduct: ['EXCELLENT', 'GOOD', 'NEEDS_IMPROVEMENT'],
};

const defaultRecord = (): MemberRecord => ({ punctuality: 'ALWAYS_ON_TIME', performance: 'GOOD', participation: 'ACTIVE', conduct: 'GOOD', comment: '' });

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', RETURNED: 'Returned',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase().replace(/_/g, '-')}`}>{STATUS_LABEL[status] || status}</span>;
}

export default function ClubsView({
  api, post, userRole, students, classes, years, teachers, today, setModalConfig, school, logoUrl,
}: {
  api: (view: string, params?: Record<string, string>) => Promise<any>;
  post: (action: string, data: unknown, extra?: Record<string, unknown>) => Promise<any>;
  userRole: string;
  students: { id: string; studentId: string; fullName: string; classId: string; status: string }[];
  classes: { id: string; name: string }[];
  years: { id: string; name: string; active?: boolean }[];
  teachers: { id: string; name: string; active?: boolean }[];
  today: string;
  setModalConfig: (config: ModalConfig | null) => void;
  school: string;
  logoUrl?: string | null;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clubForm, setClubForm] = useState<ClubForm | null>(null);
  const [activityForm, setActivityForm] = useState<ActivityForm | null>(null);
  const [recordRows, setRecordRows] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [memberClub, setMemberClub] = useState<string | null>(null);
  const [memberDraft, setMemberDraft] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');

  const isAdmin = userRole === 'ADMIN';
  const classNameOf = (id: string) => classes.find((c) => c.id === id)?.name || '';

  const loadData = () => {
    setLoading(true);
    return api('clubs')
      .then((d: Payload) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for a fetch triggered on mount
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clubs load once when the page opens
  }, []);

  const showToast = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 3500);
  };

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    }
  };

  const blankClub = (): ClubForm => ({
    name: '', description: '', academicYearId: years.find((y) => y.active)?.id || years[0]?.id || '',
    active: true, teacherIds: [], studentIds: [],
  });

  const openEditClub = (club: Club) => {
    if (!data) return;
    setStudentSearch('');
    setClubForm({
      id: club.id,
      name: club.name,
      description: club.description || '',
      academicYearId: club.academicYearId || '',
      active: club.active,
      teacherIds: data.teachers.filter((t) => t.clubId === club.id).map((t) => t.teacherId),
      studentIds: data.members.filter((m) => m.clubId === club.id).map((m) => m.studentId),
    });
  };

  const saveClub = () => run(async () => {
    if (!clubForm) return;
    const base = {
      name: clubForm.name.trim(),
      description: clubForm.description.trim() || null,
      academicYearId: clubForm.academicYearId || null,
      teacherIds: clubForm.teacherIds,
      studentIds: clubForm.studentIds,
    };
    await post(clubForm.id ? 'updateClub' : 'createClub', clubForm.id ? { ...base, id: clubForm.id, active: clubForm.active } : base);
    showToast(clubForm.id ? 'Club updated.' : 'Club created.');
    setClubForm(null);
    await loadData();
  });

  const openMemberEditor = (club: Club) => {
    if (!data) return;
    setMemberSearch('');
    setMemberDraft(data.members.filter((m) => m.clubId === club.id).map((m) => m.studentId));
    setMemberClub(club.id);
  };

  const saveMembers = (clubId: string) => run(async () => {
    await post('updateClubMembers', { clubId, studentIds: memberDraft });
    showToast(`${memberDraft.length} club member${memberDraft.length === 1 ? '' : 's'} saved.`);
    setMemberClub(null);
    await loadData();
  });

  const filteredMemberOptions = useMemo(() => {
    const options = data?.studentOptions || [];
    const term = memberSearch.trim().toLowerCase();
    if (!term) return options.slice(0, 500);
    return options
      .filter((s) => s.fullName.toLowerCase().includes(term) || s.studentId.toLowerCase().includes(term) || (s.className || '').toLowerCase().includes(term))
      .slice(0, 500);
  }, [data?.studentOptions, memberSearch]);

  const archiveClub = (club: Club) => setModalConfig({
    type: 'confirm',
    title: 'Archive Club',
    message: `Archive "${club.name}"? The club is hidden from the list and teachers lose access to it.`,
    confirmLabel: 'Archive Club',
    isDanger: true,
    onConfirm: () => {
      run(async () => {
        await post('deleteEntity', undefined, { type: 'club', id: club.id });
        showToast('Club archived.');
        await loadData();
      });
    },
  });

  const openActivity = (clubId: string, activity?: ActivityRow) => {
    if (!data) return;
    const members = data.members.filter((m) => m.clubId === clubId);
    const existing = activity ? data.records.filter((r) => r.clubActivityId === activity.id) : [];
    const records: Record<string, MemberRecord> = {};
    members.forEach((m) => {
      const saved = existing.find((r) => r.studentId === m.studentId);
      records[m.studentId] = saved
        ? { punctuality: saved.punctuality, performance: saved.performance, participation: saved.participation, conduct: saved.conduct, comment: saved.comment || '' }
        : defaultRecord();
    });
    setActivityForm({
      ...(activity ? { id: activity.id, title: activity.title, activityDate: activity.activityDate, description: activity.description } : { title: '', activityDate: today, description: '' }),
      clubId,
      records,
    });
    setError(null);
  };

  const setCell = (studentId: string, patch: Partial<MemberRecord>) => {
    if (!activityForm) return;
    setActivityForm({ ...activityForm, records: { ...activityForm.records, [studentId]: { ...(activityForm.records[studentId] || defaultRecord()), ...patch } } });
  };

  const fillAllRecords = () => {
    if (!activityForm) return;
    const next: Record<string, MemberRecord> = {};
    Object.keys(activityForm.records).forEach((id) => {
      next[id] = defaultRecord();
    });
    setActivityForm({ ...activityForm, records: next });
  };

  const recordProblems = () => {
    if (!activityForm || !data) return [] as string[];
    const members = data.members.filter((m) => m.clubId === activityForm.clubId);
    const problems: string[] = [];
    members.forEach((m) => {
      const r = activityForm.records[m.studentId];
      if (!r) { problems.push(`row for ${m.studentName}`); return; }
      if (!r.punctuality) problems.push(`punctuality for ${m.studentName}`);
      if (!r.performance || !r.participation || !r.conduct) problems.push(`levels for ${m.studentName}`);
      else if ((r.performance === 'NEEDS_IMPROVEMENT' || r.conduct === 'NEEDS_IMPROVEMENT') && !r.comment.trim()) problems.push(`comment for ${m.studentName}`);
    });
    return problems;
  };

  const saveActivity = (andSubmit: boolean) => run(async () => {
    if (!activityForm) return;
    // Only rows for the club's current members are sent, so a member list that
    // changed while the form was open can never produce a rejected save.
    const members = data?.members.filter((m) => m.clubId === activityForm.clubId) || [];
    if (andSubmit) {
      const problems = recordProblems();
      if (problems.length) {
        setError(`Before submitting, complete: ${problems.slice(0, 6).join(', ')}${problems.length > 6 ? '…' : ''}.`);
        return;
      }
    }
    let saved: any;
    try {
      saved = await post('saveClubActivity', {
        ...(activityForm.id ? { id: activityForm.id } : {}),
        clubId: activityForm.clubId,
        title: activityForm.title.trim(),
        activityDate: activityForm.activityDate,
        description: activityForm.description.trim(),
        ...(members.length
          ? { records: members.map((m) => ({ studentId: m.studentId, ...(activityForm.records[m.studentId] || defaultRecord()) })) }
          : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message.includes('does not belong to this club')) {
        await loadData();
        throw new Error('The club member list changed while this form was open. The rows have been refreshed — please review them and save again.');
      }
      if (message.includes('your own clubs')) {
        await loadData();
        throw new Error('You are no longer assigned to this club. The club list has been refreshed — open the club again if you still have access.');
      }
      throw e;
    }
    if (andSubmit && saved?.id) {
      await post('submitClubActivity', { id: saved.id });
      showToast('Activity submitted for review.');
    } else {
      showToast(activityForm.id ? 'Activity updated.' : 'Activity saved as a draft.');
    }
    setActivityForm(null);
    await loadData();
  });

  const downloadClubReports = (club: Club) => {
    if (!data || building) return;
    const members = data.members.filter((m) => m.clubId === club.id);
    if (!members.length) { setError('Add club members before building reports.'); return; }
    const activities = data.activities.filter((a) => a.clubId === club.id);
    const activityIds = new Set(activities.map((a) => a.id));
    const records = data.records.filter((r) => activityIds.has(r.clubActivityId));
    setBuilding(true);
    setError(null);
    setNotice(`Building one club report for each of ${members.length} members.`);
    downloadClubReportsZip({
      school, club: { name: club.name, description: club.description || '' },
      members: members.map((m) => ({ id: m.studentId, name: m.studentName, code: m.studentCode, className: m.className || undefined })),
      activities: activities.map((a) => ({ id: a.id, title: a.title, activityDate: a.activityDate, status: a.status })),
      records: records.map((r) => ({ studentId: r.studentId, activityId: r.clubActivityId, punctuality: r.punctuality, performance: r.performance, participation: r.participation, conduct: r.conduct, comment: r.comment })),
      logoUrl: logoUrl || '/icons/school_logo.png',
      onProgress: (done, total) => setNotice(`Building club PDFs. ${done} of ${total}`),
    })
      .then((result) => setNotice(`Club reports ZIP downloaded: ${result.filename} (${result.count} student PDFs).`))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not build the club reports.'))
      .finally(() => setBuilding(false));
  };

  const submitActivity = (activity: ActivityRow) => run(async () => {
    try {
      await post('submitClubActivity', { id: activity.id });
    } catch (e) {
      if (e instanceof Error && e.message.includes('your own clubs')) {
        await loadData();
        throw new Error('You are no longer assigned to this club. The club list has been refreshed — open the club again if you still have access.');
      }
      throw e;
    }
    showToast('Activity submitted for review.');
    await loadData();
  });

  const reviewActivity = (activity: ActivityRow, status: 'UNDER_REVIEW' | 'APPROVED' | 'RETURNED' | 'SUBMITTED') => {
    const needsReason = status === 'RETURNED' || status === 'SUBMITTED';
    const apply = (reason?: string) => run(async () => {
      await post('reviewClubActivity', { id: activity.id, status, ...(reason ? { comment: reason } : {}) });
      showToast(`Activity marked as ${STATUS_LABEL[status]?.toLowerCase() || status}.`);
      await loadData();
    });
    if (needsReason) {
      setModalConfig({
        type: 'reason',
        title: status === 'RETURNED' ? 'Return Activity for Revision' : 'Reopen Approved Activity',
        prompt: status === 'RETURNED' ? 'Tell the teacher what needs to be corrected:' : 'Reason for reopening this approved activity:',
        actionLabel: status === 'RETURNED' ? 'Return Activity' : 'Reopen Activity',
        onConfirm: (reason) => apply(reason),
      });
    } else {
      apply();
    }
  };

  const filteredStudents = useMemo(() => {
    const term = studentSearch.trim().toLowerCase();
    const active = students.filter((s) => s.status === 'ACTIVE');
    if (!term) return active.slice(0, 500);
    return active.filter((s) => s.fullName.toLowerCase().includes(term) || s.studentId.toLowerCase().includes(term)).slice(0, 500);
  }, [students, studentSearch]);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div>
      <div className="panel list-toolbar">
        <div>
          <div className="eyebrow">CLUBS &amp; ACTIVITIES</div>
          <h2>Clubs &amp; Co-curricular Activities</h2>
          <p>Record club activities and route them through administrator review (draft → submitted → approved or returned).</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {isAdmin && !clubForm && (
            <button className="btn primary" onClick={() => { setStudentSearch(''); setClubForm(blankClub()); }}>
              <Plus size={15} /> New Club
            </button>
          )}
          <button className="btn outline" onClick={loadData} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spinning' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="message error">{error}</div>}
      {notice && <div className="message success">{notice}</div>}

      {clubForm && (
        <div className="panel form-panel" style={{ marginBottom: 20 }}>
          <div className="panel-title">
            <div>
              <h2>{clubForm.id ? 'Edit Club' : 'New Club'}</h2>
              <p>{clubForm.id ? 'Update the club details, teachers in charge and member roster.' : 'Create a club and assign the teacher-in-charge plus the student members.'}</p>
            </div>
            <button className="icon-link" onClick={() => setClubForm(null)} title="Close"><X size={18} /></button>
          </div>
          <div className="form-grid">
            <label>
              Club name
              <input value={clubForm.name} onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })} placeholder="Debate Club" />
            </label>
            <label>
              Academic year
              <select value={clubForm.academicYearId} onChange={(e) => setClubForm({ ...clubForm, academicYearId: e.target.value })}>
                <option value="">No specific year</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Description
              <input value={clubForm.description} onChange={(e) => setClubForm({ ...clubForm, description: e.target.value })} placeholder="What the club does, meeting days, venue" />
            </label>
            {clubForm.id && (
              <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" style={{ width: 16, height: 16 }} checked={clubForm.active} onChange={(e) => setClubForm({ ...clubForm, active: e.target.checked })} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>Active club</span>
              </label>
            )}
          </div>

          <div className="divider" />
          <h3 style={{ fontSize: 13, marginBottom: 10 }}>Teachers in charge</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
            {teachers.map((t) => (
              <label key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  style={{ width: 16, height: 16 }}
                  checked={clubForm.teacherIds.includes(t.id)}
                  onChange={() => setClubForm({ ...clubForm, teacherIds: toggle(clubForm.teacherIds, t.id) })}
                />
                <span>{t.name}{t.active === false ? ' (inactive)' : ''}</span>
              </label>
            ))}
            {!teachers.length && <p className="muted" style={{ fontSize: 12 }}>No teachers available.</p>}
          </div>

          <div className="divider" />
          <div className="panel-title" style={{ marginBottom: 10 }}>
            <div>
              <h2 style={{ fontSize: 14 }}>Student members</h2>
              <p>{clubForm.studentIds.length} selected</p>
            </div>
            <div className="search-box">
              <Search size={15} />
              <input value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Search name or student ID" />
            </div>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #ebeff1', borderRadius: 9, padding: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 }}>
              {filteredStudents.map((s) => (
                <label key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px' }}>
                  <input
                    type="checkbox"
                    style={{ width: 16, height: 16 }}
                    checked={clubForm.studentIds.includes(s.id)}
                    onChange={() => setClubForm({ ...clubForm, studentIds: toggle(clubForm.studentIds, s.id) })}
                  />
                  <span>{s.fullName} <span className="muted">· {classNameOf(s.classId)} · {s.studentId}</span></span>
                </label>
              ))}
              {!filteredStudents.length && <p className="muted" style={{ fontSize: 12 }}>No students match that search.</p>}
            </div>
          </div>

          <div className="footer-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn outline" onClick={() => setClubForm(null)}>Cancel</button>
            <button className="btn primary" disabled={!clubForm.name.trim()} onClick={saveClub}>
              <CheckCircle2 size={15} /> {clubForm.id ? 'Save Club' : 'Create Club'}
            </button>
          </div>
        </div>
      )}

      {activityForm && (() => {
        const members = data?.members.filter((m) => m.clubId === activityForm.clubId) || [];
        const problems = activityForm.title.trim().length < 2 ? [] : recordProblems();
        return (
        <div className="panel form-panel" style={{ marginBottom: 20 }}>
          <div className="panel-title">
            <div>
              <h2>{activityForm.id ? 'Edit Activity' : 'Record Activity'}</h2>
              <p>One observation row per member: punctuality, performance, participation, conduct and a comment. Saved as a draft until submitted.</p>
            </div>
            <button className="icon-link" onClick={() => setActivityForm(null)} title="Close"><X size={18} /></button>
          </div>
          <div className="form-grid">
            <label>
              Activity title
              <input value={activityForm.title} onChange={(e) => setActivityForm({ ...activityForm, title: e.target.value })} placeholder="Inter-school debate practice" />
            </label>
            <label>
              Activity date
              <input type="date" value={activityForm.activityDate} onChange={(e) => setActivityForm({ ...activityForm, activityDate: e.target.value })} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              What happened
              <input value={activityForm.description} onChange={(e) => setActivityForm({ ...activityForm, description: e.target.value })} placeholder="Attendance, outcomes, next steps" />
            </label>
          </div>

          <div className="divider" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Member records ({members.length})</strong>
            <button className="btn outline" style={{ padding: '5px 10px', fontSize: 12 }} onClick={fillAllRecords} disabled={!members.length}>
              <Wand2 size={13} /> Fill all typical
            </button>
          </div>
          {problems.length > 0 && (
            <div className="notice-banner" style={{ background: '#fffbeb', color: '#92400e', marginBottom: 10 }}>
              Before submitting, complete: {problems.slice(0, 6).join(', ')}{problems.length > 6 ? '…' : ''}.
            </div>
          )}
          <div className="table-scroll" style={{ maxHeight: 420 }}>
            <table>
              <thead>
                <tr>
                  <th>STUDENT</th>
                  <th>PUNCTUALITY</th>
                  <th>PERFORMANCE</th>
                  <th>PARTICIPATION</th>
                  <th>CONDUCT</th>
                  <th>COMMENT</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const row = activityForm.records[m.studentId] || defaultRecord();
                  const missingPunctuality = !row.punctuality;
                  const needsComment = (row.performance === 'NEEDS_IMPROVEMENT' || row.conduct === 'NEEDS_IMPROVEMENT') && !row.comment.trim();
                  return (
                    <tr key={m.studentId} style={missingPunctuality || needsComment ? { background: '#fffbeb' } : undefined}>
                      <td>
                        <strong>{m.studentName}</strong>
                        <div style={{ fontSize: 11, color: '#748792' }}>{m.studentCode}</div>
                      </td>
                      <td>
                        <select
                          value={row.punctuality || ''}
                          style={{ minWidth: 170, borderColor: missingPunctuality ? '#f59e0b' : undefined }}
                          onChange={(e) => setCell(m.studentId, { punctuality: e.target.value || null })}
                        >
                          <option value="">— Choose —</option>
                          {PUNCTUALITY_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={row.performance || ''} onChange={(e) => setCell(m.studentId, { performance: e.target.value || null })}>
                          <option value="">—</option>
                          {LEVEL_OPTIONS.performance.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={row.participation || ''} onChange={(e) => setCell(m.studentId, { participation: e.target.value || null })}>
                          <option value="">—</option>
                          {LEVEL_OPTIONS.participation.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={row.conduct || ''} onChange={(e) => setCell(m.studentId, { conduct: e.target.value || null })}>
                          <option value="">—</option>
                          {LEVEL_OPTIONS.conduct.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          value={row.comment}
                          maxLength={1000}
                          placeholder="Short note"
                          style={{ borderColor: needsComment ? '#f59e0b' : undefined }}
                          onChange={(e) => setCell(m.studentId, { comment: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
                {!members.length && (
                   <tr><td colSpan={6} className="muted">This club has no members yet. {isAdmin ? 'Add members from Edit Club first.' : 'Use Manage members above to add students.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="footer-actions" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn outline" onClick={() => setActivityForm(null)}>Cancel</button>
            <button className="btn outline" disabled={activityForm.title.trim().length < 2} onClick={() => saveActivity(false)}>
              Save Draft
            </button>
            <button className="btn primary" disabled={activityForm.title.trim().length < 2} onClick={() => saveActivity(true)}>
              <CheckCircle2 size={15} /> Save &amp; Submit
            </button>
          </div>
        </div>
        );
      })()}

      {!data && <div className="panel empty">Loading clubs…</div>}

      {data && !data.clubs.length && (
        <div className="panel empty">
          <div className="empty-icon"><Users size={22} /></div>
          <strong>No clubs yet</strong>
          <p>{isAdmin ? 'Create the first club to start recording co-curricular activities.' : 'You are not assigned to any club yet. Ask an administrator to add you.'}</p>
        </div>
      )}

      {data && data.clubs.map((club) => {
        const clubTeachers = data.teachers.filter((t) => t.clubId === club.id);
        const clubMembers = data.members.filter((m) => m.clubId === club.id);
        const clubActivities = data.activities.filter((a) => a.clubId === club.id);
        const lead = clubTeachers.find((t) => t.role === 'LEAD')?.teacherName || clubTeachers[0]?.teacherName || 'Not assigned';
        const yearName = years.find((y) => y.id === club.academicYearId)?.name;
        const open = expanded === club.id;
        return (
          <div className="panel" key={club.id} style={{ marginBottom: 14 }}>
            <div className="list-toolbar">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <h2>{club.name}</h2>
                  <span className={`badge ${club.active ? 'badge-active' : 'badge-inactive'}`}>{club.active ? 'Active' : 'Archived'}</span>
                  {yearName && <span className="badge badge-submitted">{yearName}</span>}
                </div>
                <p>{club.description || 'No description provided.'}</p>
              </div>
              <div className="table-actions">
                <span className="badge badge-under-review"><Clock3 size={11} style={{ marginRight: 4 }} />Lead: {lead}</span>
                <button className="btn outline" disabled={building || !clubMembers.length} title="One PDF per member, packed into a ZIP" onClick={() => downloadClubReports(club)}>
                  <FileArchive size={14} /> {building ? 'Building…' : 'Club Reports ZIP'}
                </button>
                <button className="btn outline" onClick={() => setExpanded(open ? null : club.id)}>
                  {open ? 'Hide details' : 'Manage'}
                </button>
                {isAdmin && (
                  <>
                    <button className="icon-link" title="Edit club" onClick={() => openEditClub(club)}><Edit3 size={15} /></button>
                    {club.active && <button className="icon-link" title="Archive club" onClick={() => archiveClub(club)}><Trash2 size={15} /></button>}
                  </>
                )}
              </div>
            </div>

            {open && (
              <div style={{ padding: '0 25px 22px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(0, 2fr)', gap: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 13, marginBottom: 8 }}>Teachers in charge</h3>
                    {clubTeachers.map((t) => (
                      <div key={t.teacherId} className="reference-item" style={{ padding: '9px 0', borderTop: 0 }}>
                        <span>{t.teacherName}</span>
                        <span>{t.role === 'LEAD' ? <em className="badge badge-approved" style={{ fontStyle: 'normal' }}>Teacher-in-charge</em> : <span className="badge">Co-teacher</span>}</span>
                      </div>
                    ))}
                    {!clubTeachers.length && <p className="muted" style={{ fontSize: 12 }}>No teacher assigned.</p>}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px' }}>
                      <h3 style={{ fontSize: 13, margin: 0 }}>Members ({clubMembers.length})</h3>
                      {!isAdmin && club.active && (
                        <button className="btn outline" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => (memberClub === club.id ? setMemberClub(null) : openMemberEditor(club))}>
                          <Users size={13} style={{ marginRight: 4 }} />{memberClub === club.id ? 'Close' : 'Manage members'}
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #ebeff1', borderRadius: 9 }}>
                      {clubMembers.map((m) => (
                        <div key={m.studentId} className="reference-item" style={{ padding: '9px 13px' }}>
                          <span><strong>{m.studentName}</strong><br /><small className="muted">{m.studentCode}{m.className ? ` · ${m.className}` : ''}</small></span>
                        </div>
                      ))}
                      {!clubMembers.length && <p className="muted" style={{ fontSize: 12, padding: 13 }}>No members yet.</p>}
                    </div>
                    {memberClub === club.id && (
                      <div style={{ marginTop: 10, border: '1px solid #ebeff1', borderRadius: 9, padding: 10 }}>
                        <div className="search-box" style={{ marginBottom: 8 }}>
                          <Search size={15} />
                          <input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Search name or student ID" />
                        </div>
                        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                          {filteredMemberOptions.map((s) => (
                            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px' }}>
                              <input
                                type="checkbox"
                                style={{ width: 16, height: 16 }}
                                checked={memberDraft.includes(s.id)}
                                onChange={() => setMemberDraft(toggle(memberDraft, s.id))}
                              />
                              <span>{s.fullName} <span className="muted">{s.className ? `${s.className} ` : ''}{s.studentId}</span></span>
                            </label>
                          ))}
                          {!filteredMemberOptions.length && <p className="muted" style={{ fontSize: 12 }}>No students match that search.</p>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                          <button className="btn outline" onClick={() => setMemberClub(null)}>Cancel</button>
                          <button className="btn primary" onClick={() => saveMembers(club.id)}>
                            <CheckCircle2 size={14} /> Save Members
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="section-top" style={{ marginTop: 0 }}>
                      <h2>Activities</h2>
                      {club.active && (
                        <button className="btn outline" onClick={() => openActivity(club.id)}>
                          <Plus size={14} /> Record Activity
                        </button>
                      )}
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>DATE</th>
                            <th>ACTIVITY</th>
                            <th>STATUS</th>
                            <th>REVIEW NOTE</th>
                            <th>ACTIONS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clubActivities.map((a) => {
                            const editable = ['DRAFT', 'RETURNED'].includes(a.status);
                            const rowsForActivity = data.records.filter((r) => r.clubActivityId === a.id);
                            const showing = recordRows === a.id;
                            return (
                              <Fragment key={a.id}>
                                <tr>
                                  <td>{a.activityDate}</td>
                                  <td>
                                    <strong>{a.title}</strong>
                                    {a.description && <small>{a.description}</small>}
                                  </td>
                                  <td><StatusBadge status={a.status} /></td>
                                  <td className={a.status === 'RETURNED' ? 'return-note' : undefined}>
                                    {a.reviewComment || '—'}
                                    {a.reviewedAt && <small>Reviewed {new Date(a.reviewedAt).toLocaleDateString()}</small>}
                                  </td>
                                  <td>
                                    <div className="table-actions">
                                      <button className="tiny-button" onClick={() => setRecordRows(showing ? null : a.id)}>
                                        <ClipboardList size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{showing ? 'Hide' : 'Records'}{rowsForActivity.length ? ` (${rowsForActivity.length})` : ''}
                                      </button>
                                      {editable && (
                                        <button className="tiny-button" onClick={() => openActivity(a.clubId, a)}>
                                          <Edit3 size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Edit
                                        </button>
                                      )}
                                    {editable && (
                                      <button className="tiny-button green" onClick={() => submitActivity(a)}>
                                        <CheckCircle2 size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Submit
                                      </button>
                                    )}
                                    {isAdmin && a.status === 'SUBMITTED' && (
                                      <>
                                        <button className="tiny-button green" onClick={() => reviewActivity(a, 'UNDER_REVIEW')}>Start review</button>
                                        <button className="tiny-button red" onClick={() => reviewActivity(a, 'RETURNED')}>Return</button>
                                      </>
                                    )}
                                    {isAdmin && a.status === 'UNDER_REVIEW' && (
                                      <>
                                        <button className="tiny-button green" onClick={() => reviewActivity(a, 'APPROVED')}>Approve</button>
                                        <button className="tiny-button red" onClick={() => reviewActivity(a, 'RETURNED')}>Return</button>
                                      </>
                                    )}
                                    {isAdmin && a.status === 'APPROVED' && (
                                      <button className="tiny-button" onClick={() => reviewActivity(a, 'SUBMITTED')}>Reopen</button>
                                    )}
                                    {a.status === 'SUBMITTED' && !isAdmin && <span className="muted" style={{ fontSize: 11 }}>Awaiting review</span>}
                                    {a.status === 'UNDER_REVIEW' && !isAdmin && <span className="muted" style={{ fontSize: 11 }}>Under review</span>}
                                    {a.status === 'APPROVED' && !isAdmin && <span className="muted" style={{ fontSize: 11 }}>Approved</span>}
                                  </div>
                                  </td>
                                </tr>
                                {showing && (
                                  <tr>
                                    <td colSpan={5} style={{ padding: 12, background: '#f8fafc' }}>
                                      <strong style={{ fontSize: 12 }}>Member records — {a.title}</strong>
                                      {rowsForActivity.length ? (
                                        <div className="table-scroll" style={{ marginTop: 8, maxHeight: 260 }}>
                                          <table>
                                            <thead>
                                              <tr>
                                                <th>STUDENT</th>
                                                <th>PUNCTUALITY</th>
                                                <th>PERFORMANCE</th>
                                                <th>PARTICIPATION</th>
                                                <th>CONDUCT</th>
                                                <th>COMMENT</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {rowsForActivity.map((r) => (
                                                <tr key={r.id}>
                                                  <td>
                                                    <strong>{r.studentName}</strong>
                                                    <div style={{ fontSize: 11, color: '#748792' }}>{r.studentCode}</div>
                                                  </td>
                                                  <td>{r.punctuality ? r.punctuality.replaceAll('_', ' ') : '—'}</td>
                                                  <td>{r.performance ? r.performance.replaceAll('_', ' ') : '—'}</td>
                                                  <td>{r.participation ? r.participation.replaceAll('_', ' ') : '—'}</td>
                                                  <td>{r.conduct ? r.conduct.replaceAll('_', ' ') : '—'}</td>
                                                  <td>{r.comment || '—'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      ) : (
                                        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>No member rows saved for this activity yet.</p>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          {!clubActivities.length && (
                            <tr><td colSpan={5} className="muted">No activities recorded for this club yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
