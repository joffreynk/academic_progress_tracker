'use client';
import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Clock, FileText, UserX, BookOpen, RefreshCw } from 'lucide-react';
import PeriodPicker from './PeriodPicker';
import { periodLabel, type Period } from '@/lib/period';

interface DataQualityData {
  period: Period;
  drafts: {
    id: string;
    lessonDate: string;
    topic: string;
    className: string;
    subjectName: string;
    teacherName: string;
    updatedAt: string;
    recordsCount: number;
    rosterCount: number;
    completionRate: number;
  }[];
  returned: {
    id: string;
    lessonDate: string;
    topic: string;
    className: string;
    subjectName: string;
    teacherName: string;
    reviewComment: string | null;
    updatedAt: string;
  }[];
  studentsWithNoRecords: {
    id: string;
    studentId: string;
    fullName: string;
    className: string;
  }[];
  studentsWithNoRecordsCount: number;
  subjectsWithNoRecords: {
    id: string;
    name: string;
    code: string;
  }[];
  activeStudentsCount: number;
  recordedStudentsCount: number;
}

export default function DataQualityView({
  api,
  today,
  onOpenReport,
}: {
  api: (view: string, params?: Record<string, string>) => Promise<any>;
  today: string;
  onOpenReport?: (id: string) => void;
}) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState<DataQualityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = (r: { from: string; to: string }) => {
    setLoading(true);
    setError(null);
    api('dataQuality', { ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) })
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for a fetch triggered by the date range
    loadData(range);
  }, [range]);

  return (
    <div className="panel data-quality-panel">
      <div className="list-toolbar">
        <div>
          <div className="eyebrow">ADMINISTRATIVE AUDIT & INTEGRITY</div>
          <h2>Data Quality & Completeness Dashboard</h2>
          <p>
            Track in-progress drafts, returned lessons requiring revision, unrecorded students, and inactive curriculum areas.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: '#748792' }}>
            {data ? `Auditing ${periodLabel(data.period)}` : 'Loading period'}
          </span>
          <button className="btn outline" onClick={() => loadData(range)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spinning' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ padding: '0 25px 20px' }}>
        <PeriodPicker
          from={range.from}
          to={range.to}
          today={today}
          onChange={setRange}
          label="Audit period"
        />
      </div>

      {error && <div className="notice-banner" style={{ background: '#fef2f2', color: '#991b1b', marginBottom: 16 }}>{error}</div>}

      {data && (
        <>
          {/* Stat Grid */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat-card">
              <div className="stat-label">Students with Records</div>
              <div className="stat-value" style={{ color: '#22a57d' }}>
                {data.recordedStudentsCount} / {data.activeStudentsCount}
              </div>
              <small style={{ color: '#748792' }}>
                {data.activeStudentsCount > 0
                  ? Math.round((data.recordedStudentsCount / data.activeStudentsCount) * 100)
                  : 0}% student coverage
              </small>
            </div>

            <div className="stat-card">
              <div className="stat-label">Pending Draft Reports</div>
              <div className="stat-value" style={{ color: data.drafts.length ? '#d79c41' : '#22a57d' }}>
                {data.drafts.length}
              </div>
              <small style={{ color: '#748792' }}>Incomplete teacher entries</small>
            </div>

            <div className="stat-card">
              <div className="stat-label">Returned Reports</div>
              <div className="stat-value" style={{ color: data.returned.length ? '#c67a53' : '#22a57d' }}>
                {data.returned.length}
              </div>
              <small style={{ color: '#748792' }}>Awaiting teacher revisions</small>
            </div>

            <div className="stat-card">
              <div className="stat-label">Unrecorded Students</div>
              <div className="stat-value" style={{ color: data.studentsWithNoRecordsCount ? '#c67a53' : '#22a57d' }}>
                {data.studentsWithNoRecordsCount}
              </div>
              <small style={{ color: '#748792' }}>Zero observations in this period</small>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* INCOMPLETE DRAFTS */}
            <div className="panel sub-panel" style={{ padding: 16 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, marginBottom: 12 }}>
                <Clock size={16} color="#d79c41" /> In-Progress Drafts ({data.drafts.length})
              </h3>
              {data.drafts.length === 0 ? (
                <p style={{ color: '#748792', fontSize: 13 }}>No pending drafts found for this period.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Class & Subject</th>
                        <th>Teacher</th>
                        <th>Completion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.drafts.map((d) => (
                        <tr key={d.id}>
                          <td>{d.lessonDate}</td>
                          <td><strong>{d.className}</strong> · {d.subjectName}</td>
                          <td>{d.teacherName}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ flex: 1, height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                                <div
                                  style={{
                                    height: '100%',
                                    width: `${d.completionRate}%`,
                                    background: d.completionRate === 100 ? '#22a57d' : '#d79c41',
                                  }}
                                />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 600 }}>{d.completionRate}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* RETURNED REPORTS AWAITING REVISION */}
            <div className="panel sub-panel" style={{ padding: 16 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, marginBottom: 12 }}>
                <AlertTriangle size={16} color="#c67a53" /> Returned Reports Requiring Revision ({data.returned.length})
              </h3>
              {data.returned.length === 0 ? (
                <p style={{ color: '#748792', fontSize: 13 }}>No reports currently in returned status.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Class & Subject</th>
                        <th>Teacher</th>
                        <th>Admin Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.returned.map((r) => (
                        <tr key={r.id}>
                          <td>{r.lessonDate}</td>
                          <td><strong>{r.className}</strong> · {r.subjectName}</td>
                          <td>{r.teacherName}</td>
                          <td style={{ fontSize: 12, color: '#c67a53', maxWidth: 160 }}>{r.reviewComment || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
            {/* STUDENTS WITH NO RECORDS */}
            <div className="panel sub-panel" style={{ padding: 16 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, marginBottom: 12 }}>
                <UserX size={16} color="#c67a53" /> Active Students with No Records ({data.studentsWithNoRecordsCount})
              </h3>
              {data.studentsWithNoRecords.length === 0 ? (
                <p style={{ color: '#22a57d', fontSize: 13 }}>All active enrolled students have at least one record in this period!</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Student Name</th>
                        <th>ID</th>
                        <th>Class</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.studentsWithNoRecords.map((s) => (
                        <tr key={s.id}>
                          <td><strong>{s.fullName}</strong></td>
                          <td>{s.studentId}</td>
                          <td>{s.className}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* SUBJECTS WITH NO RECORDS */}
            <div className="panel sub-panel" style={{ padding: 16 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, marginBottom: 12 }}>
                <BookOpen size={16} color="#748792" /> Active Subjects with No Lessons ({data.subjectsWithNoRecords.length})
              </h3>
              {data.subjectsWithNoRecords.length === 0 ? (
                <p style={{ color: '#22a57d', fontSize: 13 }}>Every active curriculum subject has recorded lessons in this period.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Subject Name</th>
                        <th>Code</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.subjectsWithNoRecords.map((sub) => (
                        <tr key={sub.id}>
                          <td><strong>{sub.name}</strong></td>
                          <td>{sub.code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
