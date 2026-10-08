'use client';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Send, Search, Trash2, Users, Wand2, X, AlertTriangle } from 'lucide-react';
import type { ModalConfig } from '@/components/Modal';
import { buildNormalRecordDefaults } from '@/lib/reporting';

type RosterStudent = { studentId: string; studentCode: string; studentName: string };
type RosterOption = { id: string; studentCode: string; studentName: string };
type RecordRow = {
  studentId: string; punctuality: string | null;
  performance: string | null; participation: string | null; homework: string | null; conduct: string | null; comment: string | null;
};
type EntryHeader = { id: string; month: string; status: string; sessionsHeld: number; topics: string; reviewComment: string | null };
type FormPayload = {
  entry: EntryHeader | null; month: string; classId: string; subjectId: string;
  className: string; subjectName: string; teacherName: string | null;
  roster: RosterStudent[]; rosterDefault: boolean; records: RecordRow[]; monthClosed: boolean; editable: boolean;
};
type ChecklistItem = {
  id?: string; classId: string; subjectId: string; className: string; subjectName: string;
  teacherName: string; status: string; month: string; studentCount?: number; sessionsHeld?: number; topics?: string;
};
type Checklist = { month: string; entries: ChecklistItem[]; planned: ChecklistItem[]; closed: boolean };

type Row = {
  punctuality: string | null;
  performance: string | null; participation: string | null; homework: string | null; conduct: string | null;
  comment: string;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', APPROVED: 'Approved', RETURNED: 'Returned', MISSING: 'Not started',
};

// §193 v3: one punctuality select per student — seven categories carry the whole attendance story.
const PUNCTUALITY_OPTIONS = [
  ['ALWAYS_ON_TIME', 'Always On Time'],
  ['USUALLY_ON_TIME', 'Usually On Time'],
  ['OCCASIONALLY_LATE', 'Occasionally Late'],
  ['FREQUENTLY_LATE', 'Frequently Late'],
  ['OCCASIONALLY_ABSENT', 'Occasionally Absent'],
  ['FREQUENTLY_ABSENT', 'Frequently Absent'],
  ['ALWAYS_ABSENT', 'Always Absent'],
] as const;

const LEVEL_OPTIONS: Record<'performance' | 'participation' | 'homework' | 'conduct', string[]> = {
  performance: ['EXCELLENT', 'GOOD', 'NEEDS_IMPROVEMENT'],
  participation: ['ACTIVE', 'MODERATE', 'PASSIVE'],
  homework: ['ALWAYS_COMPLETED', 'USUALLY_COMPLETED', 'RARELY_COMPLETED'],
  conduct: ['EXCELLENT', 'GOOD', 'NEEDS_IMPROVEMENT'],
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const monthLabel = (m: string) => {
  const [y, mm] = m.split('-');
  return `${MONTH_NAMES[Number(mm) - 1] || mm} ${y}`;
};

const clampSessions = (v: string) => Math.min(400, Math.max(1, Math.round(Number(v) || 0) || 1));

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase().replace(/_/g, '-')}`}>{STATUS_LABEL[status] || status}</span>;
}

const blankRow = (): Row => ({
  punctuality: null, performance: null, participation: null, homework: null, conduct: null, comment: '',
});

export default function MonthlyEntryView({
  api, post, userRole, refData, today, setModalConfig, targetEntryId, onTargetConsumed, prefill, onPrefillConsumed, onNotice,
}: {
  api: (view: string, params?: Record<string, string>) => Promise<any>;
  post: (action: string, data: unknown, extra?: Record<string, unknown>) => Promise<any>;
  userRole: string;
  refData: any;
  today: string;
  setModalConfig: (config: ModalConfig | null) => void;
  targetEntryId: string | null;
  onTargetConsumed: () => void;
  prefill: { classId: string; subjectId: string } | null;
  onPrefillConsumed: () => void;
  onNotice: (message: string) => void;
}) {
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [form, setForm] = useState<FormPayload | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [sessionsHeld, setSessionsHeld] = useState(20);
  const [topics, setTopics] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setLocalNotice] = useState<string | null>(null);
  const [rosterEditor, setRosterEditor] = useState<{ students: RosterOption[]; selected: string[]; search: string; saving: boolean } | null>(null);

  const minMonth = `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`;
  const editable = !!form?.editable && !form?.monthClosed;

  const showToast = (message: string) => {
    setLocalNotice(message);
    setTimeout(() => setLocalNotice(null), 4000);
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    }
  };

  const loadChecklist = (m: string) =>
    api('monthlyEntries', { month: m })
      .then((d: Checklist) => setChecklist(d))
      .catch((e: Error) => setError(e.message));

  const applyForm = (d: FormPayload) => {
    const map: Record<string, Row> = {};
    for (const s of d.roster) {
      const r = d.records.find((x) => x.studentId === s.studentId);
      map[s.studentId] = r
        ? { punctuality: r.punctuality, performance: r.performance, participation: r.participation, homework: r.homework, conduct: r.conduct, comment: r.comment || '' }
        : blankRow();
    }
    const normal = buildNormalRecordDefaults();
    if (d.editable) {
      for (const s of d.roster) {
        if (d.records.some((r) => r.studentId === s.studentId)) continue;
        map[s.studentId] = {
          punctuality: normal.punctuality,
          performance: normal.performance,
          participation: normal.participation,
          homework: normal.homework,
          conduct: normal.conduct,
          comment: normal.comment,
        };
      }
    }
    setForm(d);
    setRows(map);
    setSessionsHeld(d.entry?.sessionsHeld ?? 20);
    setTopics(d.entry?.topics ?? '');
  };

  const loadEntry = (m: string, cId: string, sId: string) =>
    api('monthlyEntry', { month: m, classId: cId, subjectId: sId })
      .then(applyForm)
      .catch((e: Error) => setError(e.message));

  // Load by explicit entry id (opened from report history), otherwise by month + class + subject.
  useEffect(() => {
    if (prefill) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- applying the navigation prefill once before the entry loads
      setClassId(prefill.classId);
      setSubjectId(prefill.subjectId);
      onPrefillConsumed();
      return;
    }
    if (targetEntryId) {
      setLoading(true);
      api('monthlyEntry', { entryId: targetEntryId })
        .then((d: FormPayload) => {
          applyForm(d);
          setMonth(d.month);
          setClassId(d.classId);
          setSubjectId(d.subjectId);
          onTargetConsumed();
        })
        .catch((e: Error) => { setError(e.message); onTargetConsumed(); })
        .finally(() => setLoading(false));
      return;
    }
    if (classId && subjectId) {
      setLoading(true);
      loadEntry(month, classId, subjectId).finally(() => setLoading(false));
    } else {
      setForm(null);
      setRows({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, classId, subjectId, targetEntryId, prefill]);

  useEffect(() => {
    loadChecklist(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Preselect the first assigned class + subject for teachers — but never when the caller already
  // picked one: a card prefill (set in the same mount commit, so this effect would otherwise see an
  // empty classId and overwrite it) or an entry opened from report history wins over the default.
  useEffect(() => {
    if (prefill || targetEntryId || classId || !refData?.assignments?.length) return;
    const first = refData.assignments.find((a: any) => a.active !== false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preselects the first assignment once reference data arrives
    if (first) { setClassId(first.classId); setSubjectId(first.subjectId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refData, prefill, targetEntryId]);

  // The roster editor always belongs to the form it was opened from.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closes the roster panel when the form context changes
    setRosterEditor(null);
  }, [classId, subjectId, month]);

  const subjectOptions = useMemo(() => {
    if (!refData) return [];
    if (!classId) return refData.subjects;
    const ids = new Set(refData.assignments.filter((a: any) => a.classId === classId && a.active !== false).map((a: any) => a.subjectId));
    return refData.subjects.filter((s: any) => ids.has(s.id));
  }, [refData, classId]);

  const roster = form?.roster || [];

  const setCell = (studentId: string, patch: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] || blankRow()), ...patch } }));

  const fillAllNormal = () =>
    setRows((prev) => {
      const next: Record<string, Row> = {};
      for (const [id, r] of Object.entries(prev)) next[id] = { ...r, punctuality: 'ALWAYS_ON_TIME' };
      return next;
    });

  const openRosterEditor = () =>
    run(async () => {
      const d = await api('subjectRoster', { classId, subjectId });
      setRosterEditor({
        students: d.students,
        selected: d.isDefault ? (d.students as RosterOption[]).map((s) => s.id) : d.enrolled,
        search: '',
        saving: false,
      });
    });

  const toggleRosterStudent = (id: string) =>
    setRosterEditor((prev) =>
      prev ? { ...prev, selected: prev.selected.includes(id) ? prev.selected.filter((x) => x !== id) : [...prev.selected, id] } : prev,
    );

  const saveRosterEditor = () =>
    run(async () => {
      if (!rosterEditor) return;
      setRosterEditor({ ...rosterEditor, saving: true });
      try {
        const res = await post('saveSubjectRoster', { classId, subjectId, studentIds: rosterEditor.selected });
        setRosterEditor(null);
        showToast(res.isDefault ? 'Whole class restored for this subject.' : `Subject group saved for ${form?.subjectName}: ${res.count} student${res.count === 1 ? '' : 's'}.`);
        await Promise.all([loadChecklist(month), loadEntry(month, classId, subjectId)]);
        onNotice('Subject student group updated.');
      } finally {
        setRosterEditor((prev) => (prev ? { ...prev, saving: false } : prev));
      }
    });

  const buildPayload = (submit: boolean) => ({
    id: form?.entry?.id || undefined,
    month,
    classId,
    subjectId,
    sessionsHeld: Math.min(400, Math.max(1, Math.round(sessionsHeld) || 20)),
    topics,
    submit,
    records: roster.map((s) => ({ studentId: s.studentId, ...rows[s.studentId] })),
  });

  const doSave = (submit: boolean) =>
    run(async () => {
      setSaving(true);
      try {
        await post('saveMonthlyEntry', buildPayload(submit));
        showToast(submit ? 'Monthly record submitted for administrative review.' : 'Draft saved.');
        await Promise.all([loadChecklist(month), loadEntry(month, classId, subjectId)]);
        onNotice(submit ? 'Monthly record submitted.' : 'Draft monthly record saved.');
      } finally {
        setSaving(false);
      }
    });

  const saveDraft = () => doSave(false);

  const submitRecord = () => {
    const problems: string[] = [];
    if (!topics.trim()) problems.push('content covered');
    if (roster.length === 0) problems.push('class roster');
    for (const s of roster) {
      const r = rows[s.studentId];
      if (!r) { problems.push(`row for ${s.studentName}`); continue; }
      if (!r.punctuality) { problems.push(`punctuality for ${s.studentName}`); continue; }
      if (!r.performance || !r.participation || !r.homework || !r.conduct) problems.push(`levels for ${s.studentName}`);
      else if ((r.performance === 'NEEDS_IMPROVEMENT' || r.conduct === 'NEEDS_IMPROVEMENT') && !r.comment.trim()) problems.push(`comment for ${s.studentName}`);
      if (problems.length > 8) break;
    }
    if (problems.length) {
      setError(`Before submitting, complete: ${problems.slice(0, 6).join(', ')}${problems.length > 6 ? '…' : ''}.`);
      return;
    }
    setModalConfig({
      type: 'confirm',
      title: 'Submit Monthly Record',
      message: `Submit the ${monthLabel(month)} record for ${form?.className} · ${form?.subjectName} (${roster.length} students)?`,
      confirmLabel: 'Submit Record',
      onConfirm: () => { setModalConfig(null); doSave(true); },
    });
  };

  const deleteDraft = () => {
    if (!form?.entry) return;
    setModalConfig({
      type: 'confirm',
      title: 'Delete Monthly Record',
      message: `Delete the ${monthLabel(month)} record for ${form.className} · ${form.subjectName}? This cannot be undone.`,
      isDanger: true,
      confirmLabel: 'Delete Record',
      onConfirm: () => {
        setModalConfig(null);
        run(async () => {
          await post('deleteDraft', { id: form.entry!.id });
          showToast('Monthly record deleted.');
          setForm(null);
          setRows({});
          await loadChecklist(month);
        });
      },
    });
  };

  const openItem = (item: ChecklistItem) => {
    setClassId(item.classId);
    setSubjectId(item.subjectId);
  };

  const checklistRows = useMemo(() => {
    if (!checklist) return [];
    const entries = checklist.entries.map((e) => ({ ...e, kind: 'entry' as const }));
    const planned = checklist.planned.map((p) => ({ ...p, kind: 'planned' as const }));
    return [...entries, ...planned].sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
  }, [checklist]);

  const lateAbsentTotal = Object.values(rows).filter((r) => !r.punctuality).length;
  const rosterEditorQuery = rosterEditor?.search.trim().toLowerCase() || '';
  const rosterEditorFiltered = rosterEditor
    ? rosterEditor.students.filter((s) => !rosterEditorQuery || s.studentName.toLowerCase().includes(rosterEditorQuery) || s.studentCode.toLowerCase().includes(rosterEditorQuery))
    : [];

  return (
    <div>
      <div className="panel list-toolbar">
        <div>
          <div className="eyebrow">MONTHLY RECORD ENTRY (§193)</div>
          <h2>Monthly Record · {monthLabel(month)}</h2>
          <p>One record per class, subject and month. Choose each student’s punctuality for the month.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ margin: 0 }}>
            Month
            <input type="month" value={month} min={minMonth} max={currentMonth} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label style={{ margin: 0 }}>
            Class
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setSubjectId(''); }}>
              <option value="">Choose class…</option>
              {(refData?.classes || []).map((c: any) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </label>
          <label style={{ margin: 0 }}>
            Subject
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!classId}>
              <option value="">Choose subject…</option>
              {subjectOptions.map((s: any) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </label>
          <button className="btn outline" onClick={() => { loadChecklist(month); if (classId && subjectId) loadEntry(month, classId, subjectId); }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="notice-banner" style={{ background: '#fef2f2', color: '#991b1b', marginBottom: 16 }}>{error}</div>}
      {notice && <div className="notice-banner" style={{ background: '#ecfdf5', color: '#047857', marginBottom: 16 }}>{notice}</div>}

      {/* Filing checklist for the month */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="list-toolbar">
          <div>
            <h3 style={{ margin: 0 }}>{monthLabel(month)} filing checklist</h3>
            <p>Pick a row to open its record. Rows marked “Not started” still need a record.</p>
          </div>
          {checklist?.closed && (
            <span className="badge badge-returned"><AlertTriangle size={12} style={{ marginRight: 4 }} />Month closed</span>
          )}
        </div>
        {checklistRows.length === 0 ? (
          <div className="empty"><div className="empty-title">No assignments</div><div className="empty-detail">No class and subject combinations are assigned for this month.</div></div>
        ) : (
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table>
              <thead>
                <tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Students</th><th>Status</th></tr>
              </thead>
              <tbody>
                {checklistRows.map((item) => (
                  <tr
                    key={`${item.classId}|${item.subjectId}`}
                    style={{ cursor: 'pointer', background: item.classId === classId && item.subjectId === subjectId ? '#f0fdfa' : undefined }}
                    onClick={() => openItem(item)}
                  >
                    <td><strong>{item.className}</strong></td>
                    <td>{item.subjectName}</td>
                    <td>{item.teacherName}</td>
                    <td>{item.kind === 'entry' ? item.studentCount ?? '—' : '—'}</td>
                    <td><StatusBadge status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record form */}
      {!classId || !subjectId ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-title">Choose a class and subject</div>
            <div className="empty-detail">Select a row from the checklist, or pick a class and subject above to start the monthly record.</div>
          </div>
        </div>
      ) : loading ? (
        <div className="panel"><div className="empty"><div className="empty-detail">Loading record…</div></div></div>
      ) : !form ? (
        <div className="panel"><div className="empty"><div className="empty-detail">No record loaded.</div></div></div>
      ) : (
        <div className="panel form-panel">
          <div className="list-toolbar">
            <div>
              <div className="eyebrow">{monthLabel(month)} · {userRole === 'ADMIN' ? 'ADMINISTRATIVE ENTRY' : 'CLASS SUBJECT RECORD'}</div>
              <h3 style={{ margin: '4px 0' }}>{form.className} · {form.subjectName}</h3>
              <p>
                {form.teacherName ? <>Teacher: {form.teacherName} · </> : null}
                {form.entry ? <StatusBadge status={form.entry.status} /> : <StatusBadge status="DRAFT" />}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ margin: 0 }}>
                Sessions held
                <input type="number" min={1} max={400} value={sessionsHeld} disabled={!editable} onChange={(e) => setSessionsHeld(clampSessions(e.target.value))} />
              </label>
            </div>
          </div>

          {rosterEditor && (
            <div className="panel form-panel" style={{ marginBottom: 14, background: '#fbfdfe' }}>
              <div className="panel-title">
                <div>
                  <h2 style={{ fontSize: 14 }}>Students taking {form.subjectName}</h2>
                  <p>
                    {rosterEditor.selected.length} of {rosterEditor.students.length} class students selected.
                    {rosterEditor.selected.length === rosterEditor.students.length ? ' Saving this selection keeps the whole class.' : ' Only the selected students appear on this record.'}
                  </p>
                </div>
                <button className="icon-link" onClick={() => setRosterEditor(null)} title="Close"><X size={18} /></button>
              </div>
              <div className="search-box" style={{ marginBottom: 10 }}>
                <Search size={15} />
                <input value={rosterEditor.search} onChange={(e) => setRosterEditor({ ...rosterEditor, search: e.target.value })} placeholder="Search name or student ID" />
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #ebeff1', borderRadius: 9, padding: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 }}>
                  {rosterEditorFiltered.map((s) => (
                    <label key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px' }}>
                      <input
                        type="checkbox"
                        style={{ width: 16, height: 16 }}
                        checked={rosterEditor.selected.includes(s.id)}
                        onChange={() => toggleRosterStudent(s.id)}
                      />
                      <span>{s.studentName} <span className="muted">· {s.studentCode}</span></span>
                    </label>
                  ))}
                  {!rosterEditorFiltered.length && <p className="muted" style={{ fontSize: 12 }}>No students match that search.</p>}
                </div>
              </div>
              <div className="footer-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                <button
                  className="btn outline"
                  style={{ padding: '5px 10px', fontSize: 12 }}
                  disabled={!rosterEditor.selected.length || rosterEditor.saving}
                  onClick={() => setRosterEditor({ ...rosterEditor, selected: [] })}
                >
                  Use whole class
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn outline" onClick={() => setRosterEditor(null)} disabled={rosterEditor.saving}>Cancel</button>
                  <button className="btn primary" onClick={saveRosterEditor} disabled={rosterEditor.saving}>
                    <Save size={14} /> Save Group
                  </button>
                </div>
              </div>
            </div>
          )}

          {form.monthClosed && (
            <div className="notice-banner" style={{ background: '#fffbeb', color: '#92400e', marginBottom: 12 }}>
              <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
              This month is closed. Records cannot be changed until an administrator reopens it.
            </div>
          )}
          {form.entry?.status === 'RETURNED' && (
            <div className="notice-banner" style={{ background: '#fef2f2', color: '#991b1b', marginBottom: 12 }}>
              <strong>Returned for revision:</strong>&nbsp;{form.entry.reviewComment || 'No reason recorded.'}
            </div>
          )}
          {!editable && form.entry && form.entry.status !== 'RETURNED' && (
            <div className="notice-banner" style={{ background: '#f1f5f9', color: '#475569', marginBottom: 12 }}>
              This record has been submitted and is read-only until it is returned or reopened by an administrator.
            </div>
          )}
          {lateAbsentTotal > 0 && (
            <div className="notice-banner" style={{ background: '#fffbeb', color: '#92400e', marginBottom: 12 }}>
              Choose punctuality for {lateAbsentTotal} student{lateAbsentTotal === 1 ? '' : 's'} — every student needs a selection before submitting.
            </div>
          )}

          <label style={{ display: 'block', marginBottom: 12 }}>
            Content Covered
            <input
              type="text"
              maxLength={500}
              value={topics}
              disabled={!editable}
              placeholder="e.g. Fractions, Decimals and Percentage"
              onChange={(e) => setTopics(e.target.value)}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <strong style={{ fontSize: 13 }}>{roster.length} students{form.rosterDefault ? '' : ' · subject group'}</strong>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                {form.rosterDefault
                  ? 'Whole class included — use Manage students to pick who takes this subject.'
                  : 'Only this subject group is recorded and submitted.'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {editable && (
                <button className="btn outline" style={{ padding: '5px 10px', fontSize: 12 }} onClick={openRosterEditor} disabled={!!rosterEditor || saving}>
                  <Users size={13} /> Manage students
                </button>
              )}
              <button className="btn outline" style={{ padding: '5px 10px', fontSize: 12 }} onClick={fillAllNormal} disabled={!editable}>
                <Wand2 size={13} /> Fill all on time
              </button>
            </div>
          </div>

          <div className="table-scroll" style={{ maxHeight: 460 }}>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Punctuality</th>
                  <th>Performance</th>
                  <th>Participation</th>
                  <th>Homework</th>
                  <th>Conduct</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((s) => {
                  const r = rows[s.studentId] || blankRow();
                  const missing = !r.punctuality;
                  return (
                    <tr key={s.studentId} style={missing && editable ? { background: '#fffbeb' } : undefined}>
                      <td>
                        <strong>{s.studentName}</strong>
                        <div style={{ fontSize: 11, color: '#748792' }}>{s.studentCode}</div>
                      </td>
                      <td>
                        <select
                          value={r.punctuality || ''}
                          disabled={!editable}
                          style={{ minWidth: 180, borderColor: missing && editable ? '#f59e0b' : undefined }}
                          onChange={(e) => setCell(s.studentId, { punctuality: e.target.value || null })}
                        >
                          <option value="">— Choose —</option>
                          {PUNCTUALITY_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={r.performance || ''} disabled={!editable} onChange={(e) => setCell(s.studentId, { performance: e.target.value || null })}>
                          <option value="">—</option>
                          {LEVEL_OPTIONS.performance.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={r.participation || ''} disabled={!editable} onChange={(e) => setCell(s.studentId, { participation: e.target.value || null })}>
                          <option value="">—</option>
                          {LEVEL_OPTIONS.participation.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={r.homework || ''} disabled={!editable} onChange={(e) => setCell(s.studentId, { homework: e.target.value || null })}>
                          <option value="">—</option>
                          {LEVEL_OPTIONS.homework.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={r.conduct || ''} disabled={!editable} onChange={(e) => setCell(s.studentId, { conduct: e.target.value || null })}>
                          <option value="">—</option>
                          {LEVEL_OPTIONS.conduct.map((v) => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text" maxLength={1000} value={r.comment} disabled={!editable}
                          style={{ minWidth: 200 }}
                          placeholder={(r.performance === 'NEEDS_IMPROVEMENT' || r.conduct === 'NEEDS_IMPROVEMENT') ? 'Required for needs improvement' : ''}
                          onChange={(e) => setCell(s.studentId, { comment: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editable ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              {form.entry && ['DRAFT', 'RETURNED'].includes(form.entry.status) && (
                <button className="btn outline" style={{ color: '#c67a53', borderColor: '#c67a53' }} onClick={deleteDraft} disabled={saving}>
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button className="btn outline" onClick={saveDraft} disabled={saving}>
                <Save size={14} /> Save Draft
              </button>
              <button className="btn primary" onClick={submitRecord} disabled={saving}>
                <Send size={14} /> Submit Record
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
