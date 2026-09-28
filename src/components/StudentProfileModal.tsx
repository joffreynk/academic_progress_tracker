'use client';
import { useState, useEffect } from 'react';
import { X, Calendar, User, Clock, AlertTriangle, TrendingUp, CheckCircle, Award } from 'lucide-react';
import type { MonthlyTrend } from '@/lib/reporting';

interface TimelineRecord {
  lessonDate: string;
  subject: string;
  topic: string;
  attendance: string;
  performance: string | null;
  participation: string | null;
  homework: string | null;
  conduct: string | null;
  comment: string | null;
  status: string;
}

interface BehaviourItem {
  id: string;
  date: string;
  category: string;
  severity: string;
  description: string;
  actionTaken: string;
  followUpRequired: boolean;
}

interface StudentProfileData {
  student: {
    id: string;
    studentId: string;
    fullName: string;
    status: string;
    className: string;
  };
  timeline: TimelineRecord[];
  significant: BehaviourItem[];
}

export default function StudentProfileModal({
  data,
  onClose,
  api,
}: {
  data: StudentProfileData;
  onClose: () => void;
  api: (view: string, params?: Record<string, string>) => Promise<any>;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'daily' | 'trends' | 'attendance' | 'behaviour'>('overview');
  const [trends, setTrends] = useState<MonthlyTrend[]>([]);
  const [loadingTrends, setLoadingTrends] = useState(false);

  useEffect(() => {
    if (activeTab === 'trends' && trends.length === 0) {
      setLoadingTrends(true);
      api('trends', { studentId: data.student.id })
        .then((res) => {
          if (res?.trends) setTrends(res.trends);
        })
        .catch(() => {})
        .finally(() => setLoadingTrends(false));
    }
  }, [activeTab, data.student.id, trends.length, api]);

  const { student, timeline, significant } = data;

  // Compute attendance summary
  const presentCount = timeline.filter((t) => t.attendance === 'PRESENT').length;
  const lateCount = timeline.filter((t) => t.attendance === 'LATE').length;
  const absentCount = timeline.filter((t) => t.attendance === 'ABSENT').length;
  const totalLessons = timeline.length;
  const attendedCount = presentCount + lateCount;
  const attendanceRate = totalLessons > 0 ? Math.round((attendedCount / totalLessons) * 100) : 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-card modal-large" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 850 }}>
        <div className="modal-header">
          <div>
            <h3>{student.fullName} ({student.studentId})</h3>
            <span style={{ fontSize: 13, color: '#748792' }}>Class {student.className} · Status: </span>
            <span className={`badge ${student.status === 'ACTIVE' ? 'badge-approved' : 'badge-returned'}`}>
              {student.status}
            </span>
          </div>
          <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
        </div>

        {/* Tab Navigation */}
        <div className="profile-tabs">
          <button className={`profile-tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            <User size={15} /> Overview
          </button>
          <button className={`profile-tab-btn ${activeTab === 'daily' ? 'active' : ''}`} onClick={() => setActiveTab('daily')}>
            <Calendar size={15} /> Daily Records ({timeline.length})
          </button>
          <button className={`profile-tab-btn ${activeTab === 'trends' ? 'active' : ''}`} onClick={() => setActiveTab('trends')}>
            <TrendingUp size={15} /> Monthly Trends
          </button>
          <button className={`profile-tab-btn ${activeTab === 'attendance' ? 'active' : ''}`} onClick={() => setActiveTab('attendance')}>
            <Clock size={15} /> Attendance
          </button>
          <button className={`profile-tab-btn ${activeTab === 'behaviour' ? 'active' : ''}`} onClick={() => setActiveTab('behaviour')}>
            <AlertTriangle size={15} /> Behaviour & Conduct ({significant.length})
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div>
              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="stat-label">Total Lessons Recorded</div>
                  <div className="stat-value">{totalLessons}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Overall Attendance</div>
                  <div className="stat-value" style={{ color: attendanceRate >= 85 ? '#22a57d' : '#c67a53' }}>
                    {attendanceRate}%
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Behaviour Logs</div>
                  <div className="stat-value" style={{ color: significant.length ? '#d79c41' : '#22a57d' }}>
                    {significant.length}
                  </div>
                </div>
              </div>

              <h4>Recent Lesson Activity</h4>
              {timeline.length === 0 ? (
                <p style={{ color: '#748792' }}>No daily lesson records found for this student.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Subject</th>
                        <th>Attendance</th>
                        <th>Performance</th>
                        <th>Homework</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeline.slice(0, 5).map((t, i) => (
                        <tr key={i}>
                          <td>{t.lessonDate}</td>
                          <td><strong>{t.subject}</strong></td>
                          <td>
                            <span className={`badge badge-${t.attendance.toLowerCase()}`}>
                              {t.attendance}
                            </span>
                          </td>
                          <td>{t.performance ? t.performance.replace('_', ' ') : '—'}</td>
                          <td>{t.homework ? t.homework.replace('_', ' ') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DAILY RECORDS */}
          {activeTab === 'daily' && (
            <div>
              {timeline.length === 0 ? (
                <p style={{ color: '#748792' }}>No daily records recorded.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Subject</th>
                        <th>Topic</th>
                        <th>Attendance</th>
                        <th>Performance</th>
                        <th>Participation</th>
                        <th>Homework</th>
                        <th>Conduct</th>
                        <th>Observation Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeline.map((t, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}>{t.lessonDate}</td>
                          <td><strong>{t.subject}</strong></td>
                          <td style={{ maxWidth: 160 }}>{t.topic}</td>
                          <td>
                            <span className={`badge badge-${t.attendance.toLowerCase()}`}>
                              {t.attendance}
                            </span>
                          </td>
                          <td>{t.performance ? t.performance.replace('_', ' ') : '—'}</td>
                          <td>{t.participation || '—'}</td>
                          <td>{t.homework ? t.homework.replace('_', ' ') : '—'}</td>
                          <td>{t.conduct ? t.conduct.replace('_', ' ') : '—'}</td>
                          <td style={{ fontSize: 12, color: '#4b5563' }}>{t.comment || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MONTHLY TRENDS (§109) */}
          {activeTab === 'trends' && (
            <div>
              <p style={{ fontSize: 13, color: '#748792', marginBottom: 12 }}>
                Multi-month trajectory across consecutive reporting periods based on submitted and approved lesson records.
              </p>
              {loadingTrends ? (
                <p>Loading multi-month trend analysis...</p>
              ) : trends.length === 0 ? (
                <p style={{ color: '#748792' }}>No multi-month data available yet for this student.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Reporting Month</th>
                        <th>Lessons</th>
                        <th>Attendance %</th>
                        <th>Performance Result</th>
                        <th>Homework Result</th>
                        <th>Participation Result</th>
                        <th>Conduct Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trends.map((tr) => (
                        <tr key={tr.month}>
                          <td><strong>{tr.month}</strong></td>
                          <td>{tr.lessons}</td>
                          <td>
                            <span style={{ fontWeight: 600, color: (tr.attendanceRate ?? 0) >= 80 ? '#22a57d' : '#c67a53' }}>
                              {tr.attendanceRate !== null ? `${tr.attendanceRate}%` : '—'}
                            </span>
                          </td>
                          <td>
                            <span className={`badge ${tr.performanceResult === 'EXCELLENT' ? 'badge-approved' : tr.performanceResult === 'GOOD' ? 'badge-submitted' : 'badge-returned'}`}>
                              {tr.performanceResult.replace('_', ' ')}
                            </span>
                          </td>
                          <td>{tr.homeworkResult}</td>
                          <td>{tr.participationResult}</td>
                          <td>
                            <span className={`badge ${tr.conductResult === 'EXCELLENT' ? 'badge-approved' : tr.conductResult === 'GOOD' ? 'badge-submitted' : 'badge-returned'}`}>
                              {tr.conductResult.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ATTENDANCE */}
          {activeTab === 'attendance' && (
            <div>
              <div className="monthly-overview-grid" style={{ marginBottom: 16 }}>
                <div className="metric">
                  <span>Attendance Rate</span>
                  <strong style={{ color: attendanceRate >= 85 ? '#22a57d' : '#c67a53' }}>{attendanceRate}%</strong>
                  <small>{attendedCount} attended of {totalLessons} lessons</small>
                </div>
                <div className="metric">
                  <span>Present</span>
                  <strong style={{ color: '#22a57d' }}>{presentCount}</strong>
                  <small>On time and present</small>
                </div>
                <div className="metric">
                  <span>Late Arrivals</span>
                  <strong style={{ color: '#d79c41' }}>{lateCount}</strong>
                  <small>Contributes to punctuality flags</small>
                </div>
                <div className="metric">
                  <span>Absences</span>
                  <strong style={{ color: '#c67a53' }}>{absentCount}</strong>
                  <small>Academic scores omitted</small>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: BEHAVIOUR & CONDUCT */}
          {activeTab === 'behaviour' && (
            <div>
              <h4>Behaviour Observations & Disciplinary Records</h4>
              {significant.length === 0 ? (
                <p style={{ color: '#748792' }}>No behaviour incidents logged for this student.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Category</th>
                        <th>Severity</th>
                        <th>Description</th>
                        <th>Action Taken</th>
                        <th>Follow-up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {significant.map((b) => (
                        <tr key={b.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{b.date}</td>
                          <td><strong>{b.category.replace('_', ' ')}</strong></td>
                          <td>
                            <span className={`badge ${b.severity === 'URGENT' || b.severity === 'HIGH' ? 'badge-returned' : 'badge-submitted'}`}>
                              {b.severity}
                            </span>
                          </td>
                          <td style={{ maxWidth: 200 }}>{b.description}</td>
                          <td>{b.actionTaken || '—'}</td>
                          <td>
                            {b.followUpRequired ? (
                              <span style={{ color: '#c67a53', fontWeight: 600 }}>Required</span>
                            ) : (
                              <span style={{ color: '#22a57d' }}>None</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn outline" onClick={onClose}>Close Profile</button>
        </div>
      </div>
    </div>
  );
}
