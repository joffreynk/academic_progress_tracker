'use client';
import { useState } from 'react';
import { X, AlertCircle, CheckCircle2, ChevronRight, LockKeyhole } from 'lucide-react';

export type ModalConfig =
  | {
      type: 'submit';
      title: string;
      className: string;
      subjectName: string;
      date: string;
      total: number;
      present: number;
      late: number;
      absent: number;
      onConfirm: () => void;
    }
  | {
      type: 'reason';
      title: string;
      prompt: string;
      actionLabel: string;
      onConfirm: (reason: string) => void;
    }
  | {
      type: 'date_correction';
      currentDate: string;
      minDate: string;
      maxDate: string;
      onConfirm: (newDate: string, reason: string) => void;
    }
  | {
      type: 'behaviour';
      studentId: string;
      studentName: string;
      classId?: string;
      onConfirm: (data: {
        category: string;
        severity: string;
        description: string;
        actionTaken: string;
        followUpRequired: boolean;
      }) => void;
    }
  | {
      type: 'reset_password';
      title: string;
      targetName: string;
      onConfirm: (password: string) => void;
    }
  | {
      type: 'confirm';
      title: string;
      message: string;
      confirmLabel?: string;
      isDanger?: boolean;
      onConfirm: () => void;
    }
  | {
      type: 'edit_entity';
      title: string;
      fields: { key: string; label: string; type?: string; value: string | number | boolean; options?: { label: string; value: string }[] }[];
      onConfirm: (values: Record<string, any>) => void;
    };

export default function Modal({
  config,
  onClose,
}: {
  config: ModalConfig | null;
  onClose: () => void;
}) {
  if (!config) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {config.type === 'submit' && (
          <SubmitModal config={config} onClose={onClose} />
        )}
        {config.type === 'reason' && (
          <ReasonModal config={config} onClose={onClose} />
        )}
        {config.type === 'date_correction' && (
          <DateCorrectionModal config={config} onClose={onClose} />
        )}
        {config.type === 'behaviour' && (
          <BehaviourModal config={config} onClose={onClose} />
        )}
        {config.type === 'reset_password' && (
          <ResetPasswordModal config={config} onClose={onClose} />
        )}
        {config.type === 'confirm' && (
          <ConfirmModal config={config} onClose={onClose} />
        )}
        {config.type === 'edit_entity' && (
          <EditEntityModal config={config} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function SubmitModal({ config, onClose }: { config: Extract<ModalConfig, { type: 'submit' }>; onClose: () => void }) {
  return (
    <>
      <div className="modal-header">
        <h3>{config.title}</h3>
        <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="modal-body">
        <div className="modal-summary-box">
          <strong>{config.className} · {config.subjectName}</strong>
          <span>Lesson Date: {config.date}</span>
          <div className="modal-summary-stats">
            <div><small>Enrolled</small><strong>{config.total}</strong></div>
            <div><small>Present</small><strong style={{ color: '#22a57d' }}>{config.present}</strong></div>
            <div><small>Late</small><strong style={{ color: '#d79c41' }}>{config.late}</strong></div>
            <div><small>Absent</small><strong style={{ color: '#c67a53' }}>{config.absent}</strong></div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: '#748792', margin: 0 }}>
          Once submitted, this daily report enters the administrative review queue and cannot be altered unless returned.
        </p>
      </div>
      <div className="modal-footer">
        <button className="btn outline" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => { config.onConfirm(); onClose(); }}>
          Confirm & Submit <ChevronRight size={16} />
        </button>
      </div>
    </>
  );
}

function ReasonModal({ config, onClose }: { config: Extract<ModalConfig, { type: 'reason' }>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <>
      <div className="modal-header">
        <h3>{config.title}</h3>
        <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="modal-body">
        <label>
          {config.prompt}
          <textarea
            autoFocus
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Provide a clear, detailed rationale..."
            style={{ width: '100%', marginTop: 8 }}
          />
        </label>
      </div>
      <div className="modal-footer">
        <button className="btn outline" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={!reason.trim()}
          onClick={() => { config.onConfirm(reason.trim()); onClose(); }}
        >
          {config.actionLabel}
        </button>
      </div>
    </>
  );
}

function DateCorrectionModal({ config, onClose }: { config: Extract<ModalConfig, { type: 'date_correction' }>; onClose: () => void }) {
  const [date, setDate] = useState(config.currentDate);
  const [reason, setReason] = useState('');
  return (
    <>
      <div className="modal-header">
        <h3>Correct Lesson Date</h3>
        <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="modal-body">
        <p style={{ fontSize: 13, color: '#748792' }}>
          Correct an inadvertent date entry. The new date must remain within the 14-day policy window ({config.minDate} to {config.maxDate}).
        </p>
        <label>
          New Lesson Date
          <input
            type="date"
            min={config.minDate}
            max={config.maxDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label style={{ marginTop: 12 }}>
          Correction Reason
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why the date is being adjusted..."
          />
        </label>
      </div>
      <div className="modal-footer">
        <button className="btn outline" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={!date || !reason.trim() || date === config.currentDate}
          onClick={() => { config.onConfirm(date, reason.trim()); onClose(); }}
        >
          Save Date Correction
        </button>
      </div>
    </>
  );
}

function BehaviourModal({ config, onClose }: { config: Extract<ModalConfig, { type: 'behaviour' }>; onClose: () => void }) {
  const [category, setCategory] = useState('DISRUPTION');
  const [severity, setSeverity] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [followUp, setFollowUp] = useState(false);

  return (
    <>
      <div className="modal-header">
        <h3>Record Behaviour Observation</h3>
        <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="modal-body">
        <p style={{ fontSize: 13, color: '#748792', margin: '0 0 12px 0' }}>
          Recording observation for <strong>{config.studentName}</strong>
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="DISRUPTION">Disruption</option>
              <option value="BULLYING">Bullying / Conflict</option>
              <option value="HOMEWORK_NEGLECT">Homework Neglect</option>
              <option value="PARTICIPATION_DROP">Participation Drop</option>
              <option value="EXCELLENT_CITIZENSHIP">Positive Recognition</option>
              <option value="OTHER">Other Observation</option>
            </select>
          </label>
          <label>
            Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="LOW">Low (Noted)</option>
              <option value="MEDIUM">Medium (Needs Monitoring)</option>
              <option value="HIGH">High (Parent / Admin Attention)</option>
              <option value="URGENT">Urgent (Immediate Action)</option>
            </select>
          </label>
        </div>
        <label style={{ marginTop: 12 }}>
          Incident Description
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what occurred with specific facts..."
          />
        </label>
        <label style={{ marginTop: 12 }}>
          Action Taken
          <input
            type="text"
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            placeholder="e.g. Spoke with student, moved seating, contacted homeroom..."
          />
        </label>
        <label style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={followUp}
            onChange={(e) => setFollowUp(e.target.checked)}
          />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Require administrative / counselor follow-up</span>
        </label>
      </div>
      <div className="modal-footer">
        <button className="btn outline" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={!description.trim()}
          onClick={() => {
            config.onConfirm({
              category,
              severity,
              description: description.trim(),
              actionTaken: actionTaken.trim(),
              followUpRequired: followUp,
            });
            onClose();
          }}
        >
          Record Observation
        </button>
      </div>
    </>
  );
}

function ResetPasswordModal({ config, onClose }: { config: Extract<ModalConfig, { type: 'reset_password' }>; onClose: () => void }) {
  const [password, setPassword] = useState('');
  return (
    <>
      <div className="modal-header">
        <h3>{config.title}</h3>
        <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="modal-body">
        <p style={{ fontSize: 13, color: '#748792', margin: '0 0 12px 0' }}>
          Resetting password for <strong>{config.targetName}</strong>. New password must be at least 12 characters.
        </p>
        <label>
          New Password
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 12 characters"
          />
        </label>
      </div>
      <div className="modal-footer">
        <button className="btn outline" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={password.length < 12}
          onClick={() => { config.onConfirm(password); onClose(); }}
        >
          <LockKeyhole size={15} /> Update Password
        </button>
      </div>
    </>
  );
}

function ConfirmModal({ config, onClose }: { config: Extract<ModalConfig, { type: 'confirm' }>; onClose: () => void }) {
  return (
    <>
      <div className="modal-header">
        <h3>{config.title}</h3>
        <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="modal-body">
        <p style={{ fontSize: 14, color: '#31444d', margin: 0 }}>{config.message}</p>
      </div>
      <div className="modal-footer">
        <button className="btn outline" onClick={onClose}>Cancel</button>
        <button
          className={`btn ${config.isDanger ? 'danger' : 'primary'}`}
          onClick={() => { config.onConfirm(); onClose(); }}
        >
          {config.confirmLabel || 'Confirm'}
        </button>
      </div>
    </>
  );
}

function EditEntityModal({ config, onClose }: { config: Extract<ModalConfig, { type: 'edit_entity' }>; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, any>>(() =>
    Object.fromEntries(config.fields.map((f) => [f.key, f.value]))
  );

  return (
    <>
      <div className="modal-header">
        <h3>{config.title}</h3>
        <button className="icon-link" onClick={onClose} title="Close"><X size={18} /></button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {config.fields.map((f) => (
          <div key={f.key}>
            {f.type === 'checkbox' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(vals[f.key])}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.checked })}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{f.label}</span>
              </label>
            ) : f.options ? (
              <label>
                {f.label}
                <select
                  value={String(vals[f.key] ?? '')}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                >
                  {f.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                {f.label}
                <input
                  type={f.type || 'text'}
                  value={String(vals[f.key] ?? '')}
                  onChange={(e) => setVals({ ...vals, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                />
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="modal-footer">
        <button className="btn outline" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          onClick={() => { config.onConfirm(vals); onClose(); }}
        >
          Save Changes
        </button>
      </div>
    </>
  );
}
