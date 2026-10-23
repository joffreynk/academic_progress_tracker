'use client';
import { useCallback, useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, GraduationCap, RefreshCw } from 'lucide-react';

interface Observation {
  id: string;
  date: string;
  category: string;
  severity: string;
  description: string;
  actionTaken: string;
  followUpRequired: boolean;
  createdAt: string;
  studentId: string;
  studentName: string;
  studentCode: string;
  className: string;
  teacherName: string;
}

export default function BehaviourView({
  api,
  post,
  userRole,
  onOpenRoster,
}: {
  api: (view: string, params?: Record<string, string>) => Promise<any>;
  post: (action: string, data: unknown) => Promise<any>;
  userRole: string;
  onOpenRoster?: () => void;
}) {
  const [filterFollowUp, setFilterFollowUp] = useState(false);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(() => {
    let cancelled = false;
    // Deferred so the loading flag is not written synchronously from an effect body.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setLoadError(null);
    });
    api('behaviourObservations', filterFollowUp ? { followUp: '1' } : {})
      .then((d) => { if (!cancelled) setObservations(d.observations || []); })
      // Swallowing this into the console left a silent empty table, which reads as "no records"
      // rather than "the request failed".
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load behaviour records.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, filterFollowUp]);

  useEffect(() => loadData(), [loadData]);

  const resolveFollowUp = async (id: string) => {
    try {
      await post('resolveFollowUp', { id, resolved: true });
      setNotice('Follow-up marked as resolved.');
      loadData();
      setTimeout(() => setNotice(null), 3000);
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="panel behaviour-panel">
      <div className="list-toolbar">
        <div>
          <div className="eyebrow">BEHAVIOUR & DISCIPLINARY LOG</div>
          <h2>Behaviour & Pastoral Care Management</h2>
          <p>
            Track behavioral observations, pastoral actions, disciplinary records, and follow-up interventions.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filterFollowUp}
              onChange={(e) => setFilterFollowUp(e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Follow-up required only</span>
          </label>
          <button className="btn primary" onClick={() => onOpenRoster?.()}>
            <GraduationCap size={15} /> Log from Student Roster
          </button>
          <button className="btn outline" onClick={loadData} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spinning' : ''} /> Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="notice-banner" style={{ background: '#f0fdf4', color: '#166534', marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {loadError && (
        <div className="notice-banner" style={{ background: '#fef2f2', color: '#991b1b', marginBottom: 16 }}>
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="empty">
          <div className="empty-title">Loading behaviour records…</div>
        </div>
      ) : observations.length === 0 ? (
        <div className="empty">
          <AlertTriangle size={32} color="#748792" />
          <div className="empty-title">No behaviour observations found</div>
          <div className="empty-detail">
            {filterFollowUp
              ? 'No observations currently require follow-up attention.'
              : 'No behaviour observations have been logged.'}
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Student</th>
                <th>Class</th>
                <th>Teacher</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Description</th>
                <th>Action Taken</th>
                <th>Follow-up</th>
                {userRole === 'ADMIN' && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {observations.map((obs) => (
                <tr key={obs.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{obs.date}</td>
                  <td>
                    <strong>{obs.studentName}</strong>
                    <div style={{ fontSize: 11, color: '#748792' }}>{obs.studentCode}</div>
                  </td>
                  <td>{obs.className}</td>
                  <td>{obs.teacherName}</td>
                  <td>{obs.category.replace('_', ' ')}</td>
                  <td>
                    <span
                      className={`badge ${
                        obs.severity === 'URGENT' || obs.severity === 'HIGH'
                          ? 'badge-returned'
                          : obs.severity === 'MEDIUM'
                          ? 'badge-submitted'
                          : 'badge-draft'
                      }`}
                    >
                      {obs.severity}
                    </span>
                  </td>
                  <td style={{ maxWidth: 220, fontSize: 13 }}>{obs.description}</td>
                  <td style={{ maxWidth: 180, fontSize: 13 }}>{obs.actionTaken || '—'}</td>
                  <td>
                    {obs.followUpRequired ? (
                      <span className="badge badge-returned" style={{ fontWeight: 600 }}>Needs Follow-up</span>
                    ) : (
                      <span className="badge badge-approved">Resolved</span>
                    )}
                  </td>
                  {userRole === 'ADMIN' && (
                    <td>
                      {obs.followUpRequired ? (
                        <button
                          className="btn outline"
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          onClick={() => resolveFollowUp(obs.id)}
                        >
                          <CheckCircle size={13} /> Resolve
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: '#22a57d' }}>Done</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
