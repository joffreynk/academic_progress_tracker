'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  FilePlus2,
  GraduationCap,
  Users,
  BookOpen,
  CalendarDays,
  Settings,
  ShieldCheck,
  LogOut,
  Search,
  ChevronRight,
  Plus,
  Check,
  Clock3,
  AlertCircle,
  BarChart3,
  School,
  Download,
  Printer,
  Menu,
  X,
  ArrowLeft,
  RefreshCw,
  LockKeyhole,
  Layers3,
  UserRound,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowUpDown,
  Trash2,
  Edit3,
  KeyRound,
} from 'lucide-react';
import type ExcelJS from 'exceljs';
import MonthlyOverview from './MonthlyOverview';
import Modal, { type ModalConfig } from '@/components/Modal';
import StudentProfileModal from '@/components/StudentProfileModal';
import DataQualityView from '@/components/DataQualityView';
import StatisticsView from '@/components/StatisticsView';
import BehaviourView from '@/components/BehaviourView';
import PeriodPicker from '@/components/PeriodPicker';
import { buildNormalRecordDefaults, resultTrend, type Observation, type Rules, type SubjectComparison } from '@/lib/reporting';
import { thisMonthPeriod, buildPeriod, periodLabel, periodSlug, type Period } from '@/lib/period';
import { downloadClassSummaryPdf } from '@/lib/reportPdf';
import { importFields, requiredImportFields, safeCsvCell, toCsv, type ImportKind } from '@/lib/importing';
import { readImageFile, LOGO_ACCEPT } from '@/lib/logo';
import { readImportFile } from '@/lib/importFile';

const TIMEZONE_OPTIONS = [
  'Africa/Bujumbura',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Manila',
  'Asia/Singapore',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'UTC',
];

function ToastStack({
  notice,
  error,
  onDismiss,
}: {
  notice: string | null;
  error: string | null;
  onDismiss: (kind: 'notice' | 'error') => void;
}) {
  if (!notice && !error) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {notice && (
        <div className="toast success">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button className="toast-close" onClick={() => onDismiss('notice')} aria-label="Dismiss notification">
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="toast error">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button className="toast-close" onClick={() => onDismiss('error')} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function LogoField({
  value,
  onChange,
  onNotice,
  onError,
}: {
  value: string;
  onChange: (v: string) => void;
  onNotice: (m: string) => void;
  onError: (m: string) => void;
}) {
  const uploaded = value.startsWith('data:');
  return (
    <>
      <label>
        Logo URL
        <input
          type="text"
          placeholder={uploaded ? 'Uploaded image (stored)' : '/icons/school_logo.png or https://...'}
          value={uploaded ? '' : value}
          onChange={(e) => onChange(e.target.value)}
        />
        <small className="field-hint">
          {uploaded
            ? 'Uploaded image stored with this organization only. Type a URL to replace it, or use Remove logo.'
            : 'Optional: a full https:// image URL, or a site path such as /icons/school_logo.png.'}
        </small>
      </label>
      <label>
        Upload logo file
        <input
          type="file"
          accept={LOGO_ACCEPT}
          style={{ height: 'auto', padding: '10px 12px' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const data = await readImageFile(file);
              onChange(data);
              onNotice(`Logo "${file.name}" loaded — save to apply it to this organization.`);
            } catch (err: any) {
              onError(err.message);
            }
          }}
        />
        <small className="field-hint">
          PNG, JPG, WebP or SVG up to 200 KB. Each organization keeps its own logo; other organizations are unaffected.
        </small>
      </label>
      {value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src={value}
            alt="Logo preview"
            style={{ width: 60, height: 60, objectFit: 'contain', border: '1px solid #e6ecee', borderRadius: 10, background: '#fff', padding: 5 }}
          />
          <button type="button" className="btn outline" onClick={() => onChange('')}>
            Remove logo
          </button>
        </div>
      )}
    </>
  );
}

type User = { id: string; name: string; role: string; organizationId: string | null };
type Assignment = { id: string; classId: string; className: string; subjectId: string; subjectName: string; academicYearId: string; yearName: string; teacherName: string };
type Student = { id: string; studentId: string; fullName: string; firstName?: string; lastName?: string; classId: string; gradeId: string; academicYearId: string; status: string; className: string };
type Ref = {
  years: { id: string; name: string; startDate: string; endDate: string; active?: boolean }[];
  terms: { id: string; name: string; academicYearId: string; startDate: string; endDate: string; active?: boolean }[];
  grades: { id: string; name: string; orderIndex: number; active?: boolean }[];
  classes: { id: string; name: string; gradeId: string; academicYearId: string; active?: boolean }[];
  subjects: { id: string; name: string; code: string; active?: boolean }[];
  teachers: { id: string; name: string; email: string; teacherId: string; active: boolean; department?: string }[];
  assignments: { id: string; teacherId: string; classId: string; subjectId: string; academicYearId: string; active?: boolean }[];
  today: string;
  minDate: string;
  windowDays: number;
  allowFutureDates?: boolean;
  organization?: { name?: string; logoUrl?: string | null };
};

type Summary = {
  studentId: string;
  studentName: string;
  studentCode: string;
  className: string;
  subjectName: string;
  teacherName?: string;
  lessons: number;
  attendance: Record<string, number>;
  performance: Record<string, number>;
  participation: Record<string, number>;
  homework: Record<string, number>;
  conduct: Record<string, number>;
  attendanceRate: number | null;
  performanceResult: string;
  participationResult: string;
  homeworkResult: string;
  conductResult: string;
  punctuality: Record<string, number>;
  punctualityResult: string;
  topics: string[];
  observations: { date: string; comment: string; subject: string }[];
  version: number;
};

const fieldMap: Record<string, { key: string; label: string; type?: string; options?: string; placeholder?: string }[]> = {
  year: [
    { key: 'name', label: 'Academic year', placeholder: '2026-2027' },
    { key: 'startDate', label: 'Start date', type: 'date' },
    { key: 'endDate', label: 'End date', type: 'date' },
  ],
  term: [
    { key: 'name', label: 'Term name', placeholder: 'Term 1' },
    { key: 'academicYearId', label: 'Academic year', options: 'years' },
    { key: 'startDate', label: 'Start date', type: 'date' },
    { key: 'endDate', label: 'End date', type: 'date' },
  ],
  grade: [
    { key: 'name', label: 'Grade name', placeholder: 'Grade 7' },
    { key: 'orderIndex', label: 'Display order', type: 'number' },
  ],
  class: [
    { key: 'name', label: 'Class name', placeholder: '7A' },
    { key: 'gradeId', label: 'Grade', options: 'grades' },
    { key: 'academicYearId', label: 'Academic year', options: 'years' },
  ],
  subject: [
    { key: 'name', label: 'Subject name', placeholder: 'Mathematics' },
    { key: 'code', label: 'Subject code', placeholder: 'MATH' },
  ],
  teacher: [
    { key: 'teacherId', label: 'Teacher ID' },
    { key: 'name', label: 'Full name' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'department', label: 'Department (optional)' },
    { key: 'username', label: 'Login username' },
    { key: 'password', label: 'Initial password (12+ characters)', type: 'password' },
  ],
  assignment: [
    { key: 'teacherId', label: 'Teacher', options: 'teachers' },
    { key: 'classId', label: 'Class', options: 'classes' },
    { key: 'subjectId', label: 'Subject', options: 'subjects' },
    { key: 'academicYearId', label: 'Academic year', options: 'years' },
  ],
  student: [
    { key: 'studentId', label: 'Student ID' },
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'gradeId', label: 'Grade', options: 'grades' },
    { key: 'classId', label: 'Class', options: 'classes' },
    { key: 'academicYearId', label: 'Academic year', options: 'years' },
  ],
};

async function api(view: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ view, ...params });
  const r = await fetch(`/api/app?${q.toString()}`);
  const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Request failed.');
  return data;
}

async function post(action: string, data: unknown, extra: Record<string, unknown> = {}) {
  const r = await fetch('/api/app', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data, ...extra }),
  });
  const res = await r.json();
  if (!r.ok) throw Error(res.error || 'Request failed.');
  return res;
}

const resolve = ({ from, to }: { from: string; to: string }): Period | null => (from && to ? buildPeriod(from, to) : null);
const periodText = (period: Period) => periodLabel(period);

function Badge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase().replace(/_/g, '-')}`}>{status.replace('_', ' ')}</span>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <div className="empty-detail">{detail}</div>
    </div>
  );
}

const NOT_APPLICABLE = (
  <span
    style={{
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: 4,
      background: '#f1f5f9',
      color: '#94a3b8',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.4,
    }}
  >
    N/A
  </span>
);

const naCell = (notApplicable: boolean, control: React.ReactNode) =>
  notApplicable ? NOT_APPLICABLE : control;

const pretty = (s: string) => s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const shiftDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const dayLabel = (days: number) => `${days} day${days === 1 ? '' : 's'}`;

type GeneratedCredential = {
  teacherId: string;
  name: string;
  email: string;
  username: string;
  password: string;
  emailProvided: boolean;
};

const downloadTextFile = (name: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Give the browser a moment to start the download before the blob is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const downloadCredentials = (credentials: GeneratedCredential[]) =>
  downloadTextFile(
    `teacher-passwords-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      ['Teacher ID', 'Name', 'Email', 'Username', 'Password', 'Email Status'],
      credentials.map((c) => ({
        'Teacher ID': c.teacherId,
        Name: c.name,
        Email: c.email,
        Username: c.username,
        Password: c.password,
        'Email Status': c.emailProvided ? 'Provided' : 'PENDING - organization must supply a real email',
      }))
    )
  );

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [login, setLogin] = useState({ identifier: '', password: '' });
  const [overview, setOverview] = useState<{
    organization: string;
    today: string;
    minDate: string;
    windowDays: number;
    counts: { students: number; teachers: number; classes: number; subjects: number; totalReports: number };
    statusCounts: Record<string, number>;
    assignedClasses: string[];
    assignedSubjects: string[];
    assignments: Assignment[];
    recent: { id: string; lessonDate: string; topic: string; status: string; className: string; subjectName: string; teacherName: string }[];
    reportsThisMonth?: number;
    approvalRate?: number;
    followUpCount?: number;
    teacherMonthClasses?: number;
    teacherMonthSubjects?: number;
  } | null>(null);

  const [ref, setRef] = useState<Ref | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentPage, setStudentPage] = useState(0);
  const [studentsHasMore, setStudentsHasMore] = useState(false);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [date, setDate] = useState('');
  const [topic, setTopic] = useState('');
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, { attendance: string; performance: string; conduct: string; punctuality: string; homework: string; participation: string; comment: string }>>({});
  const [reports, setReports] = useState<{ id: string; lessonDate: string; topic: string; status: string; className: string; subjectName: string; teacherName: string; reviewComment?: string | null; recordsCount?: number; rosterCount?: number; completionRate?: number }[]>([]);
  
  // History filter state
  const [reportFilterClass, setReportFilterClass] = useState('');
  const [reportFilterSubject, setReportFilterSubject] = useState('');
  const [reportFilterStatus, setReportFilterStatus] = useState('');
  const [reportFilterPeriod, setReportFilterPeriod] = useState({ from: '', to: '' });

  const [reviewDetail, setReviewDetail] = useState<{ lesson: any; records: any[] } | null>(null);
  const [studentProfile, setStudentProfile] = useState<{ student: any; timeline: any[]; significant: any[] } | null>(null);
  const [page, setPage] = useState('overview');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lessonValidationAttempted, setLessonValidationAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entity, setEntity] = useState('year');
  const [form, setForm] = useState<Record<string, any>>({});
  const [config, setConfig] = useState<{ settings: any; closures: { month: string; closed: boolean }[]; organization: any } | null>(null);
  const [organizations, setOrganizations] = useState<{ id: string; name: string; code: string; domain: string | null; logoUrl: string | null; timezone: string; active: boolean; primaryAdminUserId: string | null; studentCount?: number; teacherCount?: number; classCount?: number }[]>([]);
  const [orgForm, setOrgForm] = useState({ name: '', code: '', timezone: 'Africa/Bujumbura', domain: '', logoUrl: '/icons/school_logo.png', active: true });
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [mobile, setMobile] = useState(false);

  // Monthly state
  const [monthlyPeriod, setMonthlyPeriod] = useState({ from: '', to: '' });
  const [monthlyClass, setMonthlyClass] = useState('');
  const [monthlySubject, setMonthlySubject] = useState('');
  const [monthlyStudent, setMonthlyStudent] = useState('');
  const [monthlyYear, setMonthlyYear] = useState('');
  const [monthlyTerm, setMonthlyTerm] = useState('');
  const [monthlyGrade, setMonthlyGrade] = useState('');
  const [monthlyTeacher, setMonthlyTeacher] = useState('');
  const [monthlySortCol, setMonthlySortCol] = useState<string>('studentName');
  const [monthlySortDir, setMonthlySortDir] = useState<'asc' | 'desc'>('asc');
  const [monthly, setMonthly] = useState<{ organization: string; period: Period; closedMonths: string[]; rules: Rules; summaries: Summary[]; comparison: SubjectComparison[]; raw: Observation[] } | null>(null);

  // Import state
  const [importKind, setImportKind] = useState<ImportKind>('students');
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{
    imported: number;
    updated: number;
    skipped: number;
    errors: { row: number; reason: string }[];
    created?: { grades: number; classes: number; subjects: number; years: number };
    assignments?: { created: number; updated: number };
    credentials?: { teacherId: string; name: string; email: string; username: string; password: string; emailProvided: boolean }[];
  } | null>(null);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [teacherPage, setTeacherPage] = useState(0);
  const [teacherPageSize] = useState(10);

  // Modal state
  const [modalConfig, setModalConfig] = useState<ModalConfig | null>(null);
  const [logoOk, setLogoOk] = useState(true);
  const [loginLogo, setLoginLogo] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    const [o, r] = await Promise.all([api('overview'), api('reference').catch(() => null)]);
    setOverview(o);
    const today = o?.today || r?.today;
    if (r) {
      setRef(r);
      setDate((d) => d || today);
      setMonthlyPeriod((p) => (p.from || p.to ? p : { from: thisMonthPeriod(today).from, to: today }));
    }
  };

  useEffect(() => {
    fetch('/api/auth')
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  // Auto-dismiss operation result popups
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 9000);
    return () => clearTimeout(t);
  }, [error]);

  // Resolve the organization logo for the sign-in screen while the identifier is typed.
  useEffect(() => {
    if (user !== null) return;
    const identity = login.identifier.trim();
    const t = setTimeout(() => {
      if (!identity) {
        setLoginLogo(null);
        return;
      }
      fetch(`/api/auth?identity=${encodeURIComponent(identity)}`)
        .then((r) => r.json())
        .then((d) => setLoginLogo(d?.logoUrl || null))
        .catch(() => setLoginLogo(null));
    }, identity ? 400 : 0);
    return () => clearTimeout(t);
  }, [login.identifier, user]);

  useEffect(() => {
    if (!user) return;
    api('overview')
      .then(setOverview)
      .catch((e) => setError(e.message));
    api('reference')
      .then((r) => {
        if (r) {
          setRef(r);
          const today = r.today || overview?.today;
          setDate((d) => d || today);
          setMonthlyPeriod((p) => (p.from || p.to ? p : { from: thisMonthPeriod(today).from, to: today }));
        }
      })
      .catch(() => null);
  }, [user, overview?.today]);

  useEffect(() => {
    if (!user) return;
    if (page === 'reports') {
      api('reports', {
        ...(reportFilterClass ? { classId: reportFilterClass } : {}),
        ...(reportFilterSubject ? { subjectId: reportFilterSubject } : {}),
        ...(reportFilterStatus ? { status: reportFilterStatus } : {}),
        ...(reportFilterPeriod.from ? { from: reportFilterPeriod.from } : {}),
        ...(reportFilterPeriod.to ? { to: reportFilterPeriod.to } : {}),
      })
        .then((d) => setReports(d.reports))
        .catch((e) => setError(e.message));
    }
    if (page === 'students' && (user.role === 'ADMIN' || selectedClass)) {
      api('students', {
        ...(selectedClass ? { classId: selectedClass } : {}),
        ...(search ? { search } : {}),
        page: String(studentPage),
      })
        .then((d) => {
          setStudents(d.students);
          setStudentsHasMore(d.hasMore);
        })
        .catch((e) => setError(e.message));
    }
    if (page === 'organizations') {
      api('organizations')
        .then((d) => setOrganizations(d.organizations))
        .catch((e) => setError(e.message));
    }
    if (page === 'audit') {
      api('audit')
        .then((d) => setAuditLogs(d.logs))
        .catch((e) => setError(e.message));
    }
    if (page === 'settings' && user.role === 'ADMIN') {
      api('settings')
        .then(setConfig)
        .catch((e) => setError(e.message));
    }
  }, [page, user, selectedClass, search, studentPage, reportFilterClass, reportFilterSubject, reportFilterStatus, reportFilterPeriod.from, reportFilterPeriod.to]);

  useEffect(() => {
    if (page === 'new' && selectedClass && ref) {
      api('students', { classId: selectedClass, roster: '1' })
        .then((d) => {
          setStudents(d.students);
          setRecords((prev) => {
            const next = { ...prev };
            d.students.forEach((s: Student) => {
              if (!next[s.id]) {
                next[s.id] = buildNormalRecordDefaults();
              }
            });
            return next;
          });
        })
        .catch((e) => setError(e.message));
    }
  }, [page, selectedClass, ref]);

  const doLogin = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          identity: login.identifier,
          password: login.password,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw Error(d.error || 'Sign in failed.');

      const me = await fetch('/api/auth').then((r) => r.json());
      setUser(me.user);
      setPage('overview');
      await refresh();
    });
  };

  const logout = () => {
    run(async () => {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
      setUser(null);
    });
  };

  const activeYear = ref?.years?.find((y) => y.active) || ref?.years?.[0];

  const currentClassAssignment = useMemo(() => {
    if (!overview || !selectedClass || !selectedSubject) return null;
    return overview.assignments.find((a) => a.classId === selectedClass && a.subjectId === selectedSubject) || null;
  }, [overview, selectedClass, selectedSubject]);

  const classStudents = useMemo(() => {
    if (!ref || !monthlyClass) return [];
    return students.filter((s) => s.classId === monthlyClass);
  }, [students, monthlyClass, ref]);

  const filteredManagedTeachers = useMemo(() => {
    const rows = (ref?.teachers || []).filter((teacher) => {
      const qs = teacherSearch.trim().toLowerCase();
      if (!qs) return true;
      return [teacher.name, teacher.email, teacher.teacherId].some((value) => value.toLowerCase().includes(qs));
    });
    return rows.slice(teacherPage * teacherPageSize, teacherPage * teacherPageSize + teacherPageSize);
  }, [ref?.teachers, teacherPage, teacherPageSize, teacherSearch]);

  const managedTeachersPageCount = useMemo(() => {
    const total = (ref?.teachers || []).filter((teacher) => {
      const qs = teacherSearch.trim().toLowerCase();
      if (!qs) return true;
      return [teacher.name, teacher.email, teacher.teacherId].some((value) => value.toLowerCase().includes(qs));
    }).length;
    return Math.max(1, Math.ceil(total / teacherPageSize));
  }, [ref?.teachers, teacherPageSize, teacherSearch]);

  // Open existing lesson for editing or review
  const openLesson = (id: string) => {
    run(async () => {
      const data = await api('lesson', { id });
      if (user?.role === 'TEACHER') {
        setLessonId(data.lesson.id);
        setSelectedClass(data.lesson.classId);
        setSelectedSubject(data.lesson.subjectId);
        setDate(data.lesson.lessonDate);
        setTopic(data.lesson.topic);
        const map: Record<string, any> = {};
        data.records.forEach((r: any) => {
          map[r.studentId] = {
            attendance: r.attendanceStatus,
            performance: r.performance || 'GOOD',
            conduct: r.conduct || 'GOOD',
            punctuality: r.punctuality || 'ALWAYS_ON_TIME',
            homework: r.homework || 'ALWAYS_COMPLETED',
            participation: r.participation || 'ACTIVE',
            comment: r.comment || '',
          };
        });
        setRecords(map);
        setPage('new');
      } else {
        setReviewDetail(data);
      }
    });
  };

  // Submit report handler triggering Modal
  const initiateSubmitLesson = (isSubmit: boolean) => {
    setLessonValidationAttempted(true);
    const academicYearId = activeYear?.id;
    const missing: string[] = [];
    if (!academicYearId) missing.push('active academic year');
    if (!selectedClass) missing.push('class');
    if (!selectedSubject) missing.push('subject');
    if (!date) missing.push('lesson date');
    if (!topic.trim()) missing.push('lesson topic');
    if (missing.length) {
      setError(`Please complete the following before continuing: ${missing.join(', ')}.`);
      return;
    }
    const studentList = students.filter((s) => s.classId === selectedClass);
    if (isSubmit && studentList.length === 0) {
      setError('Cannot submit empty class roster.');
      return;
    }

    const recs = studentList.map((s) => {
      const r = records[s.id] || { attendance: 'PRESENT', performance: 'GOOD', conduct: 'GOOD', punctuality: 'ALWAYS_ON_TIME', homework: 'ALWAYS_COMPLETED', participation: 'ACTIVE', comment: '' };
      return {
        studentId: s.id,
        attendanceStatus: r.attendance as any,
        performance: r.attendance === 'ABSENT' ? null : (r.performance as any),
        conduct: r.attendance === 'ABSENT' ? null : (r.conduct as any),
        punctuality: r.attendance === 'ABSENT' ? null : (r.punctuality as any),
        homework: r.attendance === 'ABSENT' ? null : (r.homework as any),
        participation: r.attendance === 'ABSENT' ? null : (r.participation as any),
        comment: r.comment.trim() || null,
      };
    });

    const presentCount = recs.filter((r) => r.attendanceStatus === 'PRESENT').length;
    const lateCount = recs.filter((r) => r.attendanceStatus === 'LATE').length;
    const absentCount = recs.filter((r) => r.attendanceStatus === 'ABSENT').length;

    const commitSave = (submitFlag: boolean) => {
      run(async () => {
        const payload = {
          id: lessonId || undefined,
          classId: selectedClass,
          subjectId: selectedSubject,
          academicYearId,
          lessonDate: date,
          topic: topic.trim(),
          submit: submitFlag,
          records: recs,
        };
        const res = await post('saveLesson', payload);
        setNotice(submitFlag ? 'Report submitted successfully for administrative review.' : 'Draft report saved successfully.');
        setLessonId(res.lesson.id);
        if (submitFlag) {
          setPage('reports');
          setLessonId(null);
          setTopic('');
        }
        await refresh();
      });
    };

    if (isSubmit) {
      const clsName = ref?.classes.find((c) => c.id === selectedClass)?.name || selectedClass;
      const subName = ref?.subjects.find((s) => s.id === selectedSubject)?.name || selectedSubject;
      setModalConfig({
        type: 'submit',
        title: 'Confirm Daily Report Submission',
        className: clsName,
        subjectName: subName,
        date,
        total: studentList.length,
        present: presentCount,
        late: lateCount,
        absent: absentCount,
        onConfirm: () => commitSave(true),
      });
    } else {
      commitSave(false);
    }
  };

  // Review status transitions (Admin)
  const transitionReview = (id: string, newStatus: string) => {
    if (newStatus === 'RETURNED' || (reviewDetail?.lesson.status === 'APPROVED' && newStatus === 'SUBMITTED')) {
      setModalConfig({
        type: 'reason',
        title: newStatus === 'RETURNED' ? 'Return Report for Revision' : 'Reopen Approved Report',
        prompt: newStatus === 'RETURNED' ? 'Specify the corrections required from the teacher:' : 'Reason for reopening this approved report:',
        actionLabel: newStatus === 'RETURNED' ? 'Return Report' : 'Reopen Report',
        onConfirm: (reason) => {
          run(async () => {
            await post('review', { id, status: newStatus, comment: reason });
            setNotice('Report status updated.');
            setReviewDetail(null);
            await refresh();
          });
        },
      });
    } else {
      run(async () => {
        await post('review', { id, status: newStatus });
        setNotice(`Report marked as ${newStatus.replace('_', ' ')}.`);
        setReviewDetail(null);
        await refresh();
      });
    }
  };

  // Correct date action (Admin)
  const initiateDateCorrection = (id: string, currentDate: string) => {
    if (!ref) return;
    setModalConfig({
      type: 'date_correction',
      currentDate,
      minDate: ref.minDate,
      maxDate: ref.allowFutureDates ? shiftDays(ref.today, ref.windowDays) : ref.today,
      windowDays: ref.windowDays,
      onConfirm: (newDate, reason) => {
        run(async () => {
          await post('correctLessonDate', { id, lessonDate: newDate, reason });
          setNotice('Lesson date corrected successfully.');
          setReviewDetail(null);
          await refresh();
        });
      },
    });
  };

  // Delete draft action
  const initiateDeleteDraft = (id: string) => {
    setModalConfig({
      type: 'confirm',
      title: 'Delete Draft Report',
      message: 'Are you sure you want to permanently delete this draft lesson report?',
      isDanger: true,
      confirmLabel: 'Delete Draft',
      onConfirm: () => {
        run(async () => {
          await post('deleteDraft', { id });
          setNotice('Draft report deleted.');
          await refresh();
        });
      },
    });
  };

  // Monthly report fetch
  const getMonthly = () => {
    run(async () => {
      const period = resolve(monthlyPeriod);
      if (!period) throw new Error('Choose a valid reporting period before generating the report.');
      const p: Record<string, string> = { from: period.from, to: period.to };
      if (monthlyClass) p.classId = monthlyClass;
      if (monthlySubject) p.subjectId = monthlySubject;
      if (monthlyStudent) p.studentId = monthlyStudent;
      if (monthlyYear) p.academicYearId = monthlyYear;
      if (monthlyTerm) p.termId = monthlyTerm;
      if (monthlyGrade) p.gradeId = monthlyGrade;
      if (monthlyTeacher) p.teacherId = monthlyTeacher;
      const d = await api('monthly', p);
      setMonthly({
        organization: d.organization,
        period: d.period,
        closedMonths: d.closedMonths ?? [],
        rules: d.rules,
        summaries: d.summaries,
        comparison: d.comparison ?? [],
        raw: d.data ?? [],
      });
    });
  };

  // Sorted monthly summaries (§54)
  const sortedSummaries = useMemo(() => {
    if (!monthly) return [];
    return [...monthly.summaries].sort((a, b) => {
      let valA: any = (a as any)[monthlySortCol] ?? '';
      let valB: any = (b as any)[monthlySortCol] ?? '';
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return monthlySortDir === 'asc' ? -1 : 1;
      if (valA > valB) return monthlySortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [monthly, monthlySortCol, monthlySortDir]);

  const toggleMonthlySort = (col: string) => {
    if (monthlySortCol === col) {
      setMonthlySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setMonthlySortCol(col);
      setMonthlySortDir('asc');
    }
  };

  // Download Class Monthly Excel (§57, §105)
  const exportClassMonthlyExcel = async (fullClass = true) => {
    if (!monthly) return;
    const Excel = (await import('exceljs')).default;
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet(fullClass ? 'Full Class Follow-Up' : 'Subject Follow-Up');

    sheet.addRow([fullClass ? 'CLASS MONTHLY STUDENT ACADEMIC & BEHAVIOURAL FOLLOW-UP' : 'CLASS SUBJECT MONTHLY REPORT']);
    sheet.addRow([monthly.organization, `Reporting Period: ${periodText(monthly.period)}`]);
    sheet.addRow([
      'Student Name',
      'Student ID',
      'Class',
      'Subject',
      'Teacher',
      'Lessons',
      'Present',
      'Late',
      'Absent',
      'Attendance %',
      'Performance Level',
      'Classroom Participation',
      'Homework Status',
      'Conduct & Discipline',
    ]);

    sortedSummaries.forEach((s) => {
      sheet.addRow([
        s.studentName,
        s.studentCode,
        s.className,
        s.subjectName,
        s.teacherName || '—',
        s.lessons,
        s.attendance.PRESENT || 0,
        s.attendance.LATE || 0,
        s.attendance.ABSENT || 0,
        s.attendanceRate !== null ? `${s.attendanceRate}%` : '—',
        pretty(s.performanceResult),
        s.participationResult,
        s.homeworkResult,
        pretty(s.conductResult),
      ]);
    });

    sheet.columns.forEach((col) => { col.width = 20; });
    const buffer = await book.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `${monthly.organization.replace(/\s+/g, '_')}-${periodSlug(monthly.period)}-${fullClass ? 'Class-Report' : 'Subject-Report'}.xlsx`;
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Excel workbook downloaded: ${fileName}`);
  };

  const exportMonthlyCsv = () => {
    if (!monthly) return;
    const headers = ['Student ID', 'Student Name', 'Class', 'Subject', 'Teacher', 'Lessons', 'Present', 'Late', 'Absent', 'Attendance %', 'Performance', 'Participation', 'Homework', 'Conduct'];
    const rows = sortedSummaries.map((s) => [
      `"${s.studentCode}"`,
      `"${s.studentName}"`,
      `"${s.className}"`,
      `"${s.subjectName}"`,
      `"${s.teacherName || ''}"`,
      s.lessons,
      s.attendance.PRESENT || 0,
      s.attendance.LATE || 0,
      s.attendance.ABSENT || 0,
      `"${s.attendanceRate ?? ''}%"`,
      `"${pretty(s.performanceResult)}"`,
      `"${s.participationResult}"`,
      `"${s.homeworkResult}"`,
      `"${pretty(s.conductResult)}"`,
    ]);
    const text = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `${monthly.organization.replace(/\s+/g, '_')}-${periodSlug(monthly.period)}-monthly.csv`;
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`CSV export downloaded: ${fileName}`);
  };

  // CRUD Actions
  const assignmentDisplay = (a: { teacherId: string; classId: string; subjectId: string; academicYearId: string }) => ({
    teacher: ref?.teachers.find((t) => t.id === a.teacherId)?.name || 'Unknown teacher',
    cls: ref?.classes.find((c) => c.id === a.classId)?.name || a.classId,
    subject: ref?.subjects.find((s) => s.id === a.subjectId)?.name || a.subjectId,
    year: ref?.years.find((y) => y.id === a.academicYearId)?.name || '—',
  });

  const createEntity = () => {
    const missing = (fieldMap[entity] || [])
      .filter((f) => f.key !== 'department' && !String(form[f.key] ?? '').trim())
      .map((f) => f.label);
    if (missing.length) {
      setError(`Complete ${missing.join(', ')} before creating.`);
      return;
    }
    run(async () => {
      await post('create', form, { type: entity });
      setForm({});
      setNotice(`${pretty(entity)} created successfully.`);
      await refresh();
    });
  };

  const initiateEditEntity = (type: string, item: any) => {
    let fields: { key: string; label: string; type?: string; value: any; options?: any[] }[] = [];
    if (type === 'class') {
      fields = [
        { key: 'name', label: 'Class Name', value: item.name },
        { key: 'active', label: 'Active Status', type: 'checkbox', value: item.active !== false },
      ];
    } else if (type === 'subject') {
      fields = [
        { key: 'name', label: 'Subject Name', value: item.name },
        { key: 'code', label: 'Subject Code', value: item.code },
        { key: 'active', label: 'Active Status', type: 'checkbox', value: item.active !== false },
      ];
    } else if (type === 'grade') {
      fields = [
        { key: 'name', label: 'Grade Name', value: item.name },
        { key: 'orderIndex', label: 'Display Order', type: 'number', value: item.orderIndex },
        { key: 'active', label: 'Active Status', type: 'checkbox', value: item.active !== false },
      ];
    } else if (type === 'year') {
      fields = [
        { key: 'name', label: 'Academic Year', value: item.name },
        { key: 'startDate', label: 'Start Date', type: 'date', value: item.startDate },
        { key: 'endDate', label: 'End Date', type: 'date', value: item.endDate },
        { key: 'active', label: 'Active Status', type: 'checkbox', value: item.active !== false },
      ];
    } else if (type === 'term') {
      fields = [
        { key: 'name', label: 'Term Name', value: item.name },
        { key: 'startDate', label: 'Start Date', type: 'date', value: item.startDate },
        { key: 'endDate', label: 'End Date', type: 'date', value: item.endDate },
        { key: 'active', label: 'Active Status', type: 'checkbox', value: item.active !== false },
      ];
    } else if (type === 'teacher') {
      fields = [
        { key: 'name', label: 'Full Name', value: item.name },
        { key: 'email', label: 'Email', type: 'email', value: item.email },
        { key: 'department', label: 'Department', value: item.department || '' },
        { key: 'active', label: 'Active Status', type: 'checkbox', value: item.active },
      ];
    } else if (type === 'student') {
      fields = [
        { key: 'firstName', label: 'First Name', value: item.firstName || item.fullName.split(' ')[0] },
        { key: 'lastName', label: 'Last Name', value: item.lastName || item.fullName.split(' ').slice(1).join(' ') },
        { key: 'studentId', label: 'Student ID', value: item.studentId },
        { key: 'classId', label: 'Class', value: item.classId, options: ref?.classes.map((c) => ({ label: c.name, value: c.id })) },
        { key: 'gradeId', label: 'Grade', value: item.gradeId, options: ref?.grades.map((g) => ({ label: g.name, value: g.id })) },
        { key: 'academicYearId', label: 'Academic Year', value: item.academicYearId, options: ref?.years.map((y) => ({ label: y.name, value: y.id })) },
        { key: 'status', label: 'Status', value: item.status, options: [{ label: 'Active', value: 'ACTIVE' }, { label: 'Inactive', value: 'INACTIVE' }] },
      ];
    } else if (type === 'assignment') {
      fields = [
        { key: 'teacherId', label: 'Teacher', value: item.teacherId, options: (ref?.teachers || []).map((t) => ({ label: t.name, value: t.id })) },
        { key: 'classId', label: 'Class', value: item.classId, options: (ref?.classes || []).map((c) => ({ label: c.name, value: c.id })) },
        { key: 'subjectId', label: 'Subject', value: item.subjectId, options: (ref?.subjects || []).map((s) => ({ label: s.name, value: s.id })) },
        { key: 'academicYearId', label: 'Academic Year', value: item.academicYearId, options: (ref?.years || []).map((y) => ({ label: y.name, value: y.id })) },
        { key: 'active', label: 'Active assignment', type: 'checkbox', value: item.active !== false },
      ];
    }

    setModalConfig({
      type: 'edit_entity',
      title: `Edit ${pretty(type)}`,
      fields,
      onConfirm: (vals) => {
        run(async () => {
          await post('updateEntity', { id: item.id, ...vals }, { type });
          setNotice(`${pretty(type)} updated successfully.`);
          await refresh();
        });
      },
    });
  };

  const initiateDeleteEntity = (type: string, id: string, name: string) => {
    setModalConfig({
      type: 'confirm',
      title: `Deactivate / Delete ${pretty(type)}`,
      message: `Are you sure you want to deactivate or remove "${name}"? Related records may be affected.`,
      isDanger: true,
      confirmLabel: 'Confirm Removal',
      onConfirm: () => {
        run(async () => {
          await post('deleteEntity', { id }, { type });
          setNotice(`${pretty(type)} removed or deactivated.`);
          await refresh();
        });
      },
    });
  };

  const initiateResetTeacherPassword = (t: { id: string; name: string }) => {
    setModalConfig({
      type: 'reset_password',
      title: 'Reset Teacher Password',
      targetName: t.name,
      onConfirm: (password) => {
        run(async () => {
          await post('resetTeacherPassword', { teacherId: t.id, password });
          setNotice(`Password for ${t.name} reset successfully.`);
        });
      },
    });
  };

  // Record behaviour observation on student
  const openBehaviourModal = (s: Student) => {
    setModalConfig({
      type: 'behaviour',
      studentId: s.id,
      studentName: s.fullName,
      classId: s.classId,
      onConfirm: (data) => {
        run(async () => {
          await post('observation', { studentId: s.id, classId: s.classId, ...data });
          setNotice('Behaviour observation recorded successfully.');
          await refresh();
        });
      },
    });
  };

  // Open full student profile
  const openStudentProfile = (id: string) => {
    run(async () => {
      const data = await api('studentProfile', { id });
      setStudentProfile(data);
    });
  };

  // Navigation items based on role
  const nav = useMemo(() => {
    if (!user) return [];
    if (user.role === 'SUPER_ADMIN') {
      return [
        { id: 'overview', icon: LayoutDashboard, title: 'Overview' },
        { id: 'organizations', icon: School, title: 'Schools' },
        { id: 'audit', icon: ShieldCheck, title: 'Platform Audit' },
      ];
    }
    if (user.role === 'ADMIN') {
      return [
        { id: 'overview', icon: LayoutDashboard, title: 'Overview' },
        { id: 'reports', icon: ClipboardList, title: 'Daily Reports' },
        { id: 'students', icon: GraduationCap, title: 'Students' },
        { id: 'monthly', icon: CalendarDays, title: 'Monthly Reports' },
        { id: 'statistics', icon: BarChart3, title: 'Statistics' },
        { id: 'quality', icon: ShieldAlert, title: 'Data Quality' },
        { id: 'behaviour', icon: AlertCircle, title: 'Behaviour Log' },
        { id: 'manage', icon: Layers3, title: 'Management' },
        { id: 'import', icon: Download, title: 'Import' },
        { id: 'settings', icon: Settings, title: 'Settings' },
        { id: 'audit', icon: ShieldCheck, title: 'Audit' },
      ];
    }
    // Teacher
    return [
      { id: 'overview', icon: LayoutDashboard, title: 'Overview' },
      { id: 'new', icon: FilePlus2, title: 'New Report' },
      { id: 'reports', icon: ClipboardList, title: 'Report History' },
      { id: 'monthly', icon: CalendarDays, title: 'Monthly Reports' },
      { id: 'students', icon: GraduationCap, title: 'Class Rosters' },
      { id: 'behaviour', icon: AlertCircle, title: 'Behaviour Log' },
    ];
  }, [user]);

  // LOGIN SCREEN
  if (user === null) {
    return (
      <div className="login-backdrop">
        <div className="login-card">
          <div className="login-brand">
            {loginLogo || logoOk ? (
              <img
                className="login-logo"
                src={loginLogo || '/icons/school_logo.png'}
                alt="School logo"
                onError={() => (loginLogo ? setLoginLogo(null) : setLogoOk(false))}
              />
            ) : (
              <GraduationCap size={36} color="#0f766e" />
            )}
            <h1>Academic &amp; Behaviour reporting</h1>
            <p>Unified Daily Lesson Capture &amp; Deterministic Monthly Follow-Up</p>
          </div>
          {error && <div className="notice-banner" style={{ background: '#fef2f2', color: '#991b1b', marginBottom: 16 }}>{error}</div>}
          <form onSubmit={doLogin} className="login-form">
            <label>
              Username or Email
              <input
                type="text"
                autoFocus
                required
                value={login.identifier}
                onChange={(e) => setLogin({ ...login, identifier: e.target.value })}
                placeholder="teacher.name@school.org"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.target.value })}
                placeholder="••••••••••••"
              />
            </label>
            <button className="btn primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
              Sign In to Platform <ChevronRight size={16} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (user === undefined) {
    return <div className="loading-screen">Loading platform session...</div>;
  }

  return (
    <div className="app-shell">
      {/* SIDEBAR NAVIGATION */}
      <aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          {ref?.organization?.logoUrl ? (
            <img
              className="sidebar-logo"
              src={ref.organization.logoUrl}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="brand-mark">
              <GraduationCap size={20} />
            </div>
          )}
          <div className="sidebar-brand-text">
            <strong>School Portal</strong>
            <span>{ref?.organization?.name || overview?.organization || 'Academic Platform'}</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                className={`nav-link ${active ? 'active' : ''}`}
                onClick={() => {
                  setPage(item.id);
                  setMobile(false);
                }}
              >
                <Icon size={18} />
                <span>{item.title}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-user">
          <div className="user-info">
            <UserRound size={16} />
            <div>
              <strong>{user.name}</strong>
              <small>{user.role.replace('_', ' ')}</small>
            </div>
          </div>
          <button className="icon-link" onClick={logout} title="Sign Out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {mobile && <div className="mobile-overlay" onClick={() => setMobile(false)} aria-hidden />}

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMobile(!mobile)}>
            {mobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="topbar-title">
            <h2>{nav.find((n) => n.id === page)?.title || 'Portal'}</h2>
          </div>
          <div className="topbar-actions">
            {overview?.today && (
              <span className="badge badge-submitted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock3 size={13} /> {overview.today}
              </span>
            )}
            <button className="btn outline"               onClick={() =>
                run(async () => {
                  await refresh();
                  setNotice('Data refreshed.');
                })
              }
              title="Refresh Data"
              disabled={busy}>
              <RefreshCw size={14} className={busy ? 'spinning' : ''} />
            </button>
          </div>
        </header>

        <ToastStack
          notice={notice}
          error={error}
          onDismiss={(kind) => (kind === 'notice' ? setNotice(null) : setError(null))}
        />

        <div className="content-container">
          {/* ================= PAGE: OVERVIEW ================= */}
          {page === 'overview' && overview && (
            <div>
              <div className="welcome-banner" style={{ marginBottom: 20 }}>
                <div>
                  <span className="banner-kicker">WELCOME BACK, {user.name.toUpperCase()}</span>
                  <h1>{overview.organization} Daily Academic Portal</h1>
                  <p>
                    {user.role === 'TEACHER'
                      ? 'Record daily lesson attendance, performance, participation, homework, and conduct within the 14-day policy window.'
                      : 'School-wide tracking, review queues, compliance auditing, and deterministic monthly reporting.'}
                  </p>
                </div>
              </div>

              {/* ADMIN METRICS (§67, §81) */}
              {user.role === 'ADMIN' && (
                <>
                  <div className="stat-grid" style={{ marginBottom: 20 }}>
                    <div className="stat-card">
                      <div className="stat-label">Total Students</div>
                      <div className="stat-value">{overview.counts.students}</div>
                      <small style={{ color: '#748792' }}>Active enrolled</small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Faculty Teachers</div>
                      <div className="stat-value">{overview.counts.teachers}</div>
                      <small style={{ color: '#748792' }}>Active accounts</small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Classes Configured</div>
                      <div className="stat-value">{overview.counts.classes}</div>
                      <small style={{ color: '#748792' }}>Active cohorts</small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Total Lessons Recorded</div>
                      <div className="stat-value">{overview.counts.totalReports}</div>
                      <small style={{ color: '#748792' }}>All-time lessons</small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Approval Rate</div>
                      <div className="stat-value" style={{ color: '#22a57d' }}>{overview.approvalRate ?? 100}%</div>
                      <small style={{ color: '#748792' }}>Administrative queue</small>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Reports This Month</div>
                      <div className="stat-value">{overview.reportsThisMonth ?? 0}</div>
                      <small style={{ color: '#748792' }}>Current reporting cycle</small>
                    </div>
                  </div>

                  {/* Status Breakdown Cards */}
                  <div className="stat-grid" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <div className="stat-card">
                      <div className="stat-label">Draft Reports</div>
                      <div className="stat-value" style={{ color: '#748792' }}>{overview.statusCounts.DRAFT || 0}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Submitted Reports</div>
                      <div className="stat-value" style={{ color: '#3b82f6' }}>{overview.statusCounts.SUBMITTED || 0}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Approved Reports</div>
                      <div className="stat-value" style={{ color: '#22a57d' }}>{overview.statusCounts.APPROVED || 0}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Returned Reports</div>
                      <div className="stat-value" style={{ color: '#c67a53' }}>{overview.statusCounts.RETURNED || 0}</div>
                    </div>
                  </div>
                </>
              )}

              {/* TEACHER METRICS (§71) */}
              {user.role === 'TEACHER' && (
                <div className="stat-grid" style={{ marginBottom: 20 }}>
                  <div className="stat-card">
                    <div className="stat-label">Reports This Month</div>
                    <div className="stat-value" style={{ color: '#0f766e' }}>{overview.reportsThisMonth ?? 0}</div>
                    <small style={{ color: '#748792' }}>Recorded in current period</small>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Pending Drafts</div>
                    <div className="stat-value" style={{ color: overview.statusCounts.DRAFT ? '#d79c41' : '#748792' }}>
                      {overview.statusCounts.DRAFT || 0}
                    </div>
                    <small style={{ color: '#748792' }}>Awaiting completion</small>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Submitted</div>
                    <div className="stat-value" style={{ color: '#3b82f6' }}>{overview.statusCounts.SUBMITTED || 0}</div>
                    <small style={{ color: '#748792' }}>In administrative review</small>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Approved</div>
                    <div className="stat-value" style={{ color: '#22a57d' }}>{overview.statusCounts.APPROVED || 0}</div>
                    <small style={{ color: '#748792' }}>Approved by admin</small>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Returned</div>
                    <div className="stat-value" style={{ color: overview.statusCounts.RETURNED ? '#c67a53' : '#22a57d' }}>
                      {overview.statusCounts.RETURNED || 0}
                    </div>
                    <small style={{ color: '#748792' }}>Needs your correction</small>
                  </div>
                </div>
              )}

              {/* TEACHER ASSIGNMENT CARDS (§70) */}
              {user.role === 'TEACHER' && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <div className="list-toolbar">
                    <div>
                      <h2>My Teaching Assignments</h2>
                      <p>Authorized class and subject assignments for academic year {activeYear?.name}</p>
                    </div>
                  </div>
                  {overview.assignments.length === 0 ? (
                    <Empty title="No class assignments" detail="Contact your administrator to assign classes and subjects." />
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                      {overview.assignments.map((a) => (
                        <div key={a.id} className="panel sub-panel" style={{ padding: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <div>
                              <strong style={{ fontSize: 16 }}>Class {a.className}</strong>
                              <div style={{ color: '#0f766e', fontWeight: 600 }}>{a.subjectName}</div>
                            </div>
                            <span className="badge badge-submitted">{a.yearName}</span>
                          </div>
                          {/* 4 CLEAR ACTIONS REQUIRED BY §70 */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12 }}>
                            <button
                              className="btn primary"
                              style={{ fontSize: 12, padding: '6px 10px' }}
                              onClick={() => {
                                setSelectedClass(a.classId);
                                setSelectedSubject(a.subjectId);
                                setLessonValidationAttempted(false);
                                setPage('new');
                              }}
                            >
                              <FilePlus2 size={13} /> New Report
                            </button>
                            <button
                              className="btn outline"
                              style={{ fontSize: 12, padding: '6px 10px' }}
                              onClick={() => {
                                setReportFilterClass(a.classId);
                                setReportFilterSubject(a.subjectId);
                                setPage('reports');
                              }}
                            >
                              <ClipboardList size={13} /> History
                            </button>
                            <button
                              className="btn outline"
                              style={{ fontSize: 12, padding: '6px 10px' }}
                              onClick={() => {
                                setMonthlyClass(a.classId);
                                setMonthlySubject(a.subjectId);
                                setPage('monthly');
                              }}
                            >
                              <CalendarDays size={13} /> Monthly
                            </button>
                            <button
                              className="btn outline"
                              style={{ fontSize: 12, padding: '6px 10px' }}
                              onClick={() => {
                                setSelectedClass(a.classId);
                                setPage('students');
                              }}
                            >
                              <GraduationCap size={13} /> Students
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* RECENT LESSON ACTIVITY */}
              <div className="panel">
                <div className="list-toolbar">
                  <div>
                    <h2>Recent Daily Lesson Activity</h2>
                    <p>Chronological feed of latest recorded lessons</p>
                  </div>
                  <button className="btn outline" onClick={() => setPage('reports')}>
                    View All Reports <ChevronRight size={14} />
                  </button>
                </div>
                {!overview.recent?.length ? (
                  <Empty title="No recent lessons" detail="Recorded lessons will appear here." />
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Class</th>
                          <th>Subject</th>
                          {user.role === 'ADMIN' && <th>Teacher</th>}
                          <th>Topic</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.recent.map((l) => (
                          <tr key={l.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{l.lessonDate}</td>
                            <td><strong>{l.className}</strong></td>
                            <td>{l.subjectName}</td>
                            {user.role === 'ADMIN' && <td>{l.teacherName}</td>}
                            <td style={{ maxWidth: 220 }}>{l.topic}</td>
                            <td><Badge status={l.status} /></td>
                            <td>
                              <button className="btn outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => openLesson(l.id)}>
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= PAGE: NEW REPORT (TEACHER) ================= */}
          {page === 'new' && user.role === 'TEACHER' && (
            <div className="panel form-panel">
              <div className="list-toolbar">
                <div>
                  <div className="eyebrow">DAILY LESSON CAPTURE</div>
                  <h2>{lessonId ? 'Edit Lesson Report' : 'Record Daily Lesson'}</h2>
                  <p>
                    Policy window: {ref?.minDate} to {ref?.today} (
                    {dayLabel(ref?.windowDays ?? 14)} inclusive)
                  </p>
                </div>
                {lessonId && (
                  <button
                    className="btn outline"
                    onClick={() => {
                      setLessonId(null);
                      setTopic('');
                      setLessonValidationAttempted(false);
                    }}
                  >
                    Start New Report
                  </button>
                )}
              </div>

              {/* Top Selector Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                <label>
                  Class
                  <select
                    value={selectedClass}
                    onChange={(e) => {
                      setSelectedClass(e.target.value);
                      setSelectedSubject('');
                      setLessonValidationAttempted(false);
                    }}
                  >
                    <option value="">Select Class</option>
                    {[...new Set(overview?.assignments.map((a) => a.classId))].map((cid) => {
                      const a = overview?.assignments.find((x) => x.classId === cid);
                      return <option key={cid} value={cid}>{a?.className}</option>;
                    })}
                  </select>
                </label>
                <label>
                  Subject
                  <select
                    value={selectedSubject}
                    disabled={!selectedClass}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                  >
                    <option value="">Select Subject</option>
                    {overview?.assignments
                      .filter((a) => a.classId === selectedClass)
                      .map((a) => (
                        <option key={a.subjectId} value={a.subjectId}>{a.subjectName}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Lesson Date
                  <input
                    type="date"
                    min={ref?.minDate}
                    max={ref?.today}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <small style={{ color: '#748792', fontSize: 11, fontWeight: 600 }}>
                    Allowed range: {ref?.minDate || '—'} to {ref?.today || '—'} · You can record
                    lessons from the last {dayLabel(ref?.windowDays ?? 14)} up to today.
                  </small>
                </label>
              </div>

              <label style={{ marginBottom: 16 }}>
                Lesson Topic / Content Covered <span style={{ color: '#c0392b' }}>*</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Chapter 4: Linear equations and problem solving..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  style={
                    lessonValidationAttempted && !topic.trim()
                      ? { borderColor: '#c67a53', background: '#fffaf6' }
                      : undefined
                  }
                />
                {lessonValidationAttempted && !topic.trim() && (
                  <small style={{ color: '#c67a53', fontWeight: 600 }}>
                    Required — enter the lesson topic before saving or submitting.
                  </small>
                )}
              </label>

              {/* Student Observations Table */}
              {selectedClass && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3>Student Observations ({students.filter((s) => s.classId === selectedClass).length} Students)</h3>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn outline"
                        style={{ fontSize: 12 }}
                        onClick={() => {
                          setRecords((prev) => {
                            const next = { ...prev };
                            students.filter((s) => s.classId === selectedClass).forEach((s) => {
                              next[s.id] = { ...buildNormalRecordDefaults(), comment: '' };
                            });
                            return next;
                          });
                        }}
                      >
                        SET ALL NORMAL
                      </button>
                    </div>
                  </div>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Attendance</th>
                          <th>Academic Performance</th>
                          <th>Class Conduct</th>
                          <th>Punctuality</th>
                          <th>Homework & Assignments</th>
                          <th>Participation in Class</th>
                          <th>Teacher Comments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students
                          .filter((s) => s.classId === selectedClass)
                          .map((s) => {
                            const r = records[s.id] || {
                              attendance: 'PRESENT',
                              performance: 'GOOD',
                              conduct: 'GOOD',
                              punctuality: 'ALWAYS_ON_TIME',
                              homework: 'ALWAYS_COMPLETED',
                              participation: 'ACTIVE',
                              comment: '',
                            };
                            const isAbsent = r.attendance === 'ABSENT';
                            return (
                              <tr key={s.id} style={{ background: isAbsent ? '#fef2f2' : undefined }}>
                                <td>
                                  <strong>{s.fullName}</strong>
                                  <div style={{ fontSize: 11, color: '#748792' }}>{s.studentId}</div>
                                </td>
                                <td>
                                  <select
                                    value={r.attendance}
                                    onChange={(e) =>
                                      setRecords({
                                        ...records,
                                        [s.id]: { ...r, attendance: e.target.value },
                                      })
                                    }
                                  >
                                    <option value="PRESENT">Present</option>
                                    <option value="LATE">Late coming</option>
                                    <option value="ABSENT">Absent</option>
                                  </select>
                                </td>
                                <td>
                                  {naCell(
                                    isAbsent,
                                    <select
                                      value={r.performance}
                                      onChange={(e) =>
                                        setRecords({
                                          ...records,
                                          [s.id]: { ...r, performance: e.target.value },
                                        })
                                      }
                                    >
                                      <option value="EXCELLENT">Excellent</option>
                                      <option value="GOOD">Good</option>
                                      <option value="NEEDS_IMPROVEMENT">Needs Improvement</option>
                                    </select>
                                  )}
                                </td>
                                <td>
                                  {naCell(
                                    isAbsent,
                                    <select
                                      value={r.conduct}
                                      onChange={(e) =>
                                        setRecords({
                                          ...records,
                                          [s.id]: { ...r, conduct: e.target.value },
                                        })
                                      }
                                    >
                                      <option value="EXCELLENT">Excellent</option>
                                      <option value="GOOD">Good</option>
                                      <option value="NEEDS_IMPROVEMENT">Needs Improvement</option>
                                    </select>
                                  )}
                                </td>
                                <td>
                                  {naCell(
                                    isAbsent,
                                    <select
                                      value={r.punctuality}
                                      onChange={(e) =>
                                        setRecords({
                                          ...records,
                                          [s.id]: { ...r, punctuality: e.target.value },
                                        })
                                      }
                                    >
                                      <option value="ALWAYS_ON_TIME">Always On Time</option>
                                      <option value="OCCASIONALLY_LATE">Occasionally Late</option>
                                      <option value="FREQUENTLY_LATE">Frequently Late</option>
                                    </select>
                                  )}
                                </td>
                                <td>
                                  {naCell(
                                    isAbsent,
                                    <select
                                      value={r.homework}
                                      onChange={(e) =>
                                        setRecords({
                                          ...records,
                                          [s.id]: { ...r, homework: e.target.value },
                                        })
                                      }
                                    >
                                      <option value="ALWAYS_COMPLETED">Always Completed</option>
                                      <option value="USUALLY_COMPLETED">Usually Completed</option>
                                      <option value="RARELY_COMPLETED">Rarely Completed</option>
                                    </select>
                                  )}
                                </td>
                                <td>
                                  {naCell(
                                    isAbsent,
                                    <select
                                      value={r.participation}
                                      onChange={(e) =>
                                        setRecords({
                                          ...records,
                                          [s.id]: { ...r, participation: e.target.value },
                                        })
                                      }
                                    >
                                      <option value="ACTIVE">Active</option>
                                      <option value="MODERATE">Moderate</option>
                                      <option value="PASSIVE">Passive</option>
                                    </select>
                                  )}
                                </td>
                                <td>
                                  {naCell(
                                    isAbsent,
                                    <input
                                      type="text"
                                      placeholder={
                                        r.performance === 'NEEDS_IMPROVEMENT' || r.conduct === 'NEEDS_IMPROVEMENT'
                                          ? 'Mandatory comment for needs improvement...'
                                          : 'Optional note...'
                                      }
                                      value={r.comment}
                                      onChange={(e) =>
                                        setRecords({
                                          ...records,
                                          [s.id]: { ...r, comment: e.target.value },
                                        })
                                      }
                                      style={{
                                        borderColor:
                                          (r.performance === 'NEEDS_IMPROVEMENT' || r.conduct === 'NEEDS_IMPROVEMENT') && !r.comment.trim()
                                            ? '#c67a53'
                                            : undefined,
                                      }}
                                    />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
                    <button
                      className="btn outline"
                      onClick={() => initiateSubmitLesson(false)}
                      disabled={busy}
                    >
                      Save Draft
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => initiateSubmitLesson(true)}
                      disabled={busy}
                    >
                      Submit for Administrative Review <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= PAGE: REPORTS (HISTORY & APPROVALS) ================= */}
          {page === 'reports' && user.role !== 'SUPER_ADMIN' && (
            <div>
              {/* Review Drawer / Modal for Admin */}
              {user.role === 'ADMIN' && reviewDetail && (
                <div className="panel review-panel" style={{ marginBottom: 24, border: '2px solid #0f766e' }}>
                  <div className="list-toolbar">
                    <div>
                      <div className="eyebrow">ADMINISTRATIVE REVIEW QUEUE</div>
                      <h2>
                        Review Report: Class {reviewDetail.lesson.classNameSnapshot} · {reviewDetail.lesson.subjectNameSnapshot}
                      </h2>
                      <p>
                        Lesson Date: {reviewDetail.lesson.lessonDate} · Teacher: {reviewDetail.lesson.teacherNameSnapshot} · Current Status: <Badge status={reviewDetail.lesson.status} />
                      </p>
                      {reviewDetail.lesson.reviewComment && (
                        <div style={{ marginTop: 8, padding: 8, background: '#fef2f2', color: '#991b1b', borderRadius: 4 }}>
                          <strong>Previous Review Note:</strong> {reviewDetail.lesson.reviewComment}
                        </div>
                      )}
                    </div>
                    <button className="icon-link" onClick={() => setReviewDetail(null)}>
                      <X size={20} />
                    </button>
                  </div>

                  <div className="table-scroll" style={{ maxHeight: 350, margin: '16px 0' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Attendance</th>
                          <th>Performance</th>
                          <th>Conduct</th>
                          <th>Punctuality</th>
                          <th>Participation</th>
                          <th>Homework</th>
                          <th>Teacher Comments</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reviewDetail.records.map((r: any) => {
                          const absent = r.attendanceStatus === 'ABSENT';
                          const cell = (v: string | null | undefined) =>
                            absent ? NOT_APPLICABLE : v ? pretty(v) : '—';
                          return (
                          <tr key={r.id} style={absent ? { background: '#fef2f2' } : undefined}>
                            <td>
                              <strong>{r.studentNameSnapshot}</strong>
                              <div style={{ fontSize: 11, color: '#748792' }}>{r.studentCodeSnapshot}</div>
                            </td>
                            <td><Badge status={r.attendanceStatus} /></td>
                            <td>{cell(r.performance)}</td>
                            <td>{cell(r.conduct)}</td>
                            <td>{cell(r.punctuality)}</td>
                            <td>{cell(r.participation)}</td>
                            <td>{cell(r.homework)}</td>
                            <td style={{ fontSize: 12 }}>{absent ? NOT_APPLICABLE : r.comment || '—'}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button
                      className="btn outline"
                      onClick={() => initiateDateCorrection(reviewDetail.lesson.id, reviewDetail.lesson.lessonDate)}
                    >
                      <Clock3 size={14} /> Correct Date
                    </button>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {reviewDetail.lesson.status === 'SUBMITTED' && (
                        <button
                          className="btn outline"
                          onClick={() => transitionReview(reviewDetail.lesson.id, 'UNDER_REVIEW')}
                        >
                          Mark Under Review
                        </button>
                      )}
                      {['SUBMITTED', 'UNDER_REVIEW'].includes(reviewDetail.lesson.status) && (
                        <>
                          <button
                            className="btn outline"
                            style={{ color: '#c67a53', borderColor: '#c67a53' }}
                            onClick={() => transitionReview(reviewDetail.lesson.id, 'RETURNED')}
                          >
                            Return for Revision
                          </button>
                          <button
                            className="btn primary"
                            onClick={() => transitionReview(reviewDetail.lesson.id, 'APPROVED')}
                          >
                            <CheckCircle2 size={16} /> Approve Report
                          </button>
                        </>
                      )}
                      {reviewDetail.lesson.status === 'APPROVED' && (
                        <button
                          className="btn outline"
                          onClick={() => transitionReview(reviewDetail.lesson.id, 'SUBMITTED')}
                        >
                          Reopen Approved Report
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* REPORT HISTORY & FILTER CONTROLS (§72) */}
              <div className="panel">
                <div className="list-toolbar">
                  <div>
                    <h2>{user.role === 'ADMIN' ? 'All Daily Lesson Reports' : 'My Lesson Reports History'}</h2>
                    <p>Filter by cohort, subject area, approval status, and any date range</p>
                  </div>
                  <button className="btn outline" onClick={() => refresh()}>
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>

                {/* FILTERS (§72) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <label>
                    Class
                    <select value={reportFilterClass} onChange={(e) => setReportFilterClass(e.target.value)}>
                      <option value="">All Classes</option>
                      {ref?.classes.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Subject
                    <select value={reportFilterSubject} onChange={(e) => setReportFilterSubject(e.target.value)}>
                      <option value="">All Subjects</option>
                      {ref?.subjects.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Status
                    <select value={reportFilterStatus} onChange={(e) => setReportFilterStatus(e.target.value)}>
                      <option value="">All Statuses</option>
                      <option value="DRAFT">Draft</option>
                      <option value="SUBMITTED">Submitted</option>
                      <option value="UNDER_REVIEW">Under Review</option>
                      <option value="APPROVED">Approved</option>
                      <option value="RETURNED">Returned</option>
                    </select>
                  </label>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <PeriodPicker
                      from={reportFilterPeriod.from}
                      to={reportFilterPeriod.to}
                      today={ref?.today || overview?.today || ''}
                      onChange={setReportFilterPeriod}
                      label="Lesson date range"
                    />
                  </div>
                </div>

                {reports.length === 0 ? (
                  <Empty title="No reports found" detail="No daily reports match the current filter criteria." />
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Class</th>
                          <th>Subject</th>
                          {user.role === 'ADMIN' && <th>Teacher</th>}
                          <th>Topic</th>
                          <th>Completion %</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((r) => (
                          <tr key={r.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{r.lessonDate}</td>
                            <td><strong>{r.className}</strong></td>
                            <td>{r.subjectName}</td>
                            {user.role === 'ADMIN' && <td>{r.teacherName}</td>}
                            <td style={{ maxWidth: 220 }}>{r.topic}</td>
                            <td>
                              {/* Completion % for Drafts (§37) */}
                              {r.status === 'DRAFT' && r.completionRate !== undefined ? (
                                <span style={{ fontSize: 12, fontWeight: 600, color: r.completionRate === 100 ? '#22a57d' : '#d79c41' }}>
                                  {r.completionRate}%
                                </span>
                              ) : (
                                <span style={{ color: '#22a57d', fontSize: 12 }}>100%</span>
                              )}
                            </td>
                            <td><Badge status={r.status} /></td>
                            <td>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  className="btn outline"
                                  style={{ padding: '4px 8px', fontSize: 12 }}
                                  onClick={() => openLesson(r.id)}
                                >
                                  {user.role === 'ADMIN' ? 'Review' : 'Open'}
                                </button>
                                {r.status === 'DRAFT' && user.role === 'TEACHER' && (
                                  <button
                                    className="btn outline"
                                    style={{ padding: '4px 8px', fontSize: 12, color: '#c67a53' }}
                                    onClick={() => initiateDeleteDraft(r.id)}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= PAGE: STUDENTS & PROFILES ================= */}
          {page === 'students' && user.role !== 'SUPER_ADMIN' && (
            <div className="panel">
              <div className="list-toolbar">
                <div>
                  <h2>Student Enrollment & Rosters</h2>
                  <p>View student records, record pastoral observations, and view longitudinal student profiles.</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                    <Search size={16} />
                    <input
                      type="text"
                      placeholder="Search student or ID..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: 180 }}
                    />
                  </label>
                  <select
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                    style={{ width: 150 }}
                  >
                    <option value="">All Cohorts</option>
                    {ref?.classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {students.length === 0 ? (
                <Empty title="No students found" detail="No active students found in this roster." />
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Student Name</th>
                        <th>Student ID</th>
                        <th>Class Cohort</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id}>
                          <td><strong>{s.fullName}</strong></td>
                          <td>{s.studentId}</td>
                          <td>Class {s.className}</td>
                          <td>
                            <span className={`badge ${s.status === 'ACTIVE' ? 'badge-approved' : 'badge-returned'}`}>
                              {s.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {user.role === 'ADMIN' && (
                                <button
                                  className="btn outline"
                                  style={{ padding: '4px 8px', fontSize: 12 }}
                                  onClick={() => openStudentProfile(s.id)}
                                >
                                  Profile
                                </button>
                              )}
                              <button
                                className="btn outline"
                                style={{ padding: '4px 8px', fontSize: 12 }}
                                onClick={() => openBehaviourModal(s)}
                              >
                                Log Observation
                              </button>
                              {user.role === 'ADMIN' && (
                                <button
                                  className="btn outline"
                                  style={{ padding: '4px 8px', fontSize: 12 }}
                                  onClick={() => initiateEditEntity('student', s)}
                                >
                                  <Edit3 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <span style={{ fontSize: 13, color: '#748792' }}>Page {studentPage + 1}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn outline"
                    disabled={studentPage === 0}
                    onClick={() => setStudentPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="btn outline"
                    disabled={!studentsHasMore}
                    onClick={() => setStudentPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= PAGE: MONTHLY FOLLOW-UP ================= */}
          {page === 'monthly' && user.role !== 'SUPER_ADMIN' && (
            <div>
              <div className="panel form-panel" style={{ marginBottom: 20 }}>
                <div className="list-toolbar">
                  <div>
                    <div className="eyebrow">DETERMINISTIC PERIOD ENGINE</div>
                    <h2>Academic &amp; Behavioural Reports</h2>
                    <p>Aggregate evaluations across all approved lessons within any date range, then compare two or more months side by side.</p>
                  </div>
                  <button
                    className="btn primary"
                    onClick={getMonthly}
                    disabled={busy || !resolve(monthlyPeriod) || (user.role === 'TEACHER' && (!monthlyClass || !monthlySubject))}
                  >
                    Generate Report <ChevronRight size={16} />
                  </button>
                </div>

                {/* Filter Controls */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <PeriodPicker
                      from={monthlyPeriod.from}
                      to={monthlyPeriod.to}
                      today={ref?.today || overview?.today || ''}
                      onChange={setMonthlyPeriod}
                      months={monthly?.period.months}
                      closedMonths={monthly?.closedMonths}
                    />
                  </div>
                  <label>
                    Class
                    <select
                      value={monthlyClass}
                      onChange={(e) => {
                        setMonthlyClass(e.target.value);
                        setMonthlySubject('');
                        setMonthlyStudent('');
                      }}
                    >
                      <option value="">{user.role === 'TEACHER' ? 'Choose class' : 'All classes'}</option>
                      {user.role === 'TEACHER'
                        ? [...new Set(overview?.assignments.map((a) => a.classId))].map((cid) => {
                            const a = overview?.assignments.find((x) => x.classId === cid);
                            return <option key={cid} value={cid}>{a?.className}</option>;
                          })
                        : ref?.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Subject
                    <select
                      value={monthlySubject}
                      onChange={(e) => setMonthlySubject(e.target.value)}
                    >
                      <option value="">All subjects</option>
                      {user.role === 'TEACHER'
                        ? overview?.assignments.filter((a) => a.classId === monthlyClass).map((a) => (
                            <option key={a.subjectId} value={a.subjectId}>{a.subjectName}</option>
                          ))
                        : ref?.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  {user.role === 'ADMIN' && (
                    <>
                      <label>
                        Academic Year
                        <select value={monthlyYear} onChange={(e) => setMonthlyYear(e.target.value)}>
                          <option value="">All years</option>
                          {ref?.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                        </select>
                      </label>
                      <label>
                        Teacher
                        <select value={monthlyTeacher} onChange={(e) => setMonthlyTeacher(e.target.value)}>
                          <option value="">All faculty</option>
                          {ref?.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Monthly Results Table with Complete Columns (§54) */}
              {monthly && (
                <div className="panel">
                  <div className="list-toolbar">
                    <div>
                      <div className="eyebrow">{monthly.organization.toUpperCase()} · {periodText(monthly.period)}</div>
                      <h2>Class Follow-Up Summary</h2>
                      <p>
                        {monthly.summaries.length} student-subject summaries over {monthly.period.months.length} month{monthly.period.months.length === 1 ? '' : 's'}, calculated strictly from recorded lessons
                        {monthly.closedMonths.length > 0 && ` · ${monthly.closedMonths.length} closed month${monthly.closedMonths.length === 1 ? '' : 's'} included at current rule version`}
                      </p>
                    </div>
                    {/* EXPORT BUTTONS (§57, §105) */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
              className="btn outline"
              onClick={() =>
                run(async () => {
                  await downloadClassSummaryPdf({
                    school: monthly.organization, period: monthly.period, closedMonths: monthly.closedMonths,
                    summaries: monthly.summaries, comparison: monthly.comparison, rules: monthly.rules,
                    logoUrl: ref?.organization?.logoUrl || '/icons/school_logo.png',
                  });
                  setNotice('Class summary PDF downloaded.');
                })
              }
            >
                        <Printer size={15} /> Print / PDF
                      </button>
                      <button className="btn outline" onClick={exportMonthlyCsv}>
                        <Download size={15} /> Export CSV
                      </button>
                      <button className="btn primary" onClick={() => exportClassMonthlyExcel(true)}>
                        <Download size={15} /> Class Monthly Excel
                      </button>
                    </div>
                  </div>

                  {/* SORTABLE TABLE WITH PARTICIPATION AND CONDUCT (§54) */}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th style={{ cursor: 'pointer' }} onClick={() => toggleMonthlySort('studentName')}>
                            Student <ArrowUpDown size={12} />
                          </th>
                          <th style={{ cursor: 'pointer' }} onClick={() => toggleMonthlySort('className')}>
                            Class <ArrowUpDown size={12} />
                          </th>
                          <th style={{ cursor: 'pointer' }} onClick={() => toggleMonthlySort('subjectName')}>
                            Subject <ArrowUpDown size={12} />
                          </th>
                          <th>Lessons</th>
                          <th>P / L / A</th>
                          <th style={{ cursor: 'pointer' }} onClick={() => toggleMonthlySort('attendanceRate')}>
                            Att. % <ArrowUpDown size={12} />
                          </th>
                          <th style={{ cursor: 'pointer' }} onClick={() => toggleMonthlySort('performanceResult')}>
                            Performance <ArrowUpDown size={12} />
                          </th>
                          <th>Participation</th>
                          <th>Homework</th>
                          <th>Conduct</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSummaries.map((s) => (
                          <tr key={`${s.studentId}-${s.subjectName}`}>
                            <td>
                              <strong>{s.studentName}</strong>
                              <div style={{ fontSize: 11, color: '#748792' }}>{s.studentCode}</div>
                            </td>
                            <td>{s.className}</td>
                            <td>{s.subjectName}</td>
                            <td>{s.lessons}</td>
                            <td>
                              <span style={{ color: '#22a57d', fontWeight: 600 }}>{s.attendance.PRESENT || 0}</span> /{' '}
                              <span style={{ color: '#d79c41', fontWeight: 600 }}>{s.attendance.LATE || 0}</span> /{' '}
                              <span style={{ color: '#c67a53', fontWeight: 600 }}>{s.attendance.ABSENT || 0}</span>
                            </td>
                            <td>
                              <span style={{ fontWeight: 600, color: (s.attendanceRate ?? 0) >= 80 ? '#22a57d' : '#c67a53' }}>
                                {s.attendanceRate !== null ? `${s.attendanceRate}%` : '—'}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`badge ${
                                  s.performanceResult === 'EXCELLENT'
                                    ? 'badge-approved'
                                    : s.performanceResult === 'GOOD'
                                    ? 'badge-submitted'
                                    : 'badge-returned'
                                }`}
                              >
                                {pretty(s.performanceResult)}
                              </span>
                            </td>
                            <td>{s.participationResult}</td>
                            <td>{s.homeworkResult}</td>
                            <td>
                              <span
                                className={`badge ${
                                  s.conductResult === 'EXCELLENT'
                                    ? 'badge-approved'
                                    : s.conductResult === 'GOOD'
                                    ? 'badge-submitted'
                                    : 'badge-returned'
                                }`}
                              >
                                {pretty(s.conductResult)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Individual Student In-Depth Perspective Component */}
                  <div style={{ marginTop: 24 }}>
                    <MonthlyOverview
                      period={monthly.period}
                      closedMonths={monthly.closedMonths}
                      school={monthly.organization}
                      logoUrl={ref?.organization?.logoUrl || '/icons/school_logo.png'}
                      summaries={monthly.summaries}
                      comparison={monthly.comparison}
                      data={monthly.raw}
                      rules={monthly.rules}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= PAGE: STATISTICS & VISUAL CHARTS (§104, §146) ================= */}
          {page === 'statistics' && user.role !== 'SUPER_ADMIN' && monthly && (
            <StatisticsView
              school={monthly.organization}
              period={periodText(monthly.period)}
              fileTag={periodSlug(monthly.period)}
              summaries={monthly.summaries}
              rawObservations={monthly.raw}
            />
          )}

          {/* Fallback if user navigates to statistics without generating monthly first */}
          {page === 'statistics' && user.role !== 'SUPER_ADMIN' && !monthly && (
            <div className="panel">
              <Empty
                title="Generate monthly report first"
                detail="Please visit the Monthly Reports tab and click 'Generate Report' to load statistics."
              />
              <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setPage('monthly')}>
                Go to Monthly Reports
              </button>
            </div>
          )}

          {/* ================= PAGE: DATA QUALITY DASHBOARD (§69) ================= */}
          {page === 'quality' && user.role === 'ADMIN' && (
            <DataQualityView
              api={api}
              today={ref?.today || overview?.today || ''}
              onOpenReport={openLesson}
            />
          )}

          {/* ================= PAGE: BEHAVIOUR & PASTORAL LOG (§76) ================= */}
          {page === 'behaviour' && (
            <BehaviourView
              api={api}
              post={post}
              userRole={user.role}
              onOpenNewModal={() => {
                if (students[0]) openBehaviourModal(students[0]);
              }}
            />
          )}

          {/* ================= PAGE: ENTITY MANAGEMENT (ADMIN CRUD) ================= */}
          {page === 'manage' && user.role === 'ADMIN' && ref && (
            <div>
              <div className="management-tabs" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {['year', 'term', 'grade', 'class', 'subject', 'teacher', 'assignment'].map((t) => (
                  <button
                    key={t}
                    className={`btn ${entity === t ? 'primary' : 'outline'}`}
                    onClick={() => {
                      setEntity(t);
                      setForm({});
                    }}
                  >
                    {pretty(t)}s
                  </button>
                ))}
              </div>

              {/* Create Form */}
              <div className="panel form-panel" style={{ marginBottom: 20 }}>
                <h3>Add New {pretty(entity)}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
                  {fieldMap[entity]?.map((f) => (
                    <label key={f.key}>
                      {f.label}
                      {f.options ? (
                        <select
                          value={form[f.key] || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            const next: Record<string, string> = { ...form, [f.key]: value };
                            // Picking a class also selects the grade and academic year it belongs to.
                            if (f.key === 'classId' && value) {
                              const chosen = (ref as any)?.classes?.find((c: any) => c.id === value);
                              const fields = fieldMap[entity] || [];
                              if (chosen?.academicYearId && fields.some((x) => x.key === 'academicYearId')) next.academicYearId = chosen.academicYearId;
                              if (chosen?.gradeId && fields.some((x) => x.key === 'gradeId')) next.gradeId = chosen.gradeId;
                            }
                            setForm(next);
                          }}
                        >
                          <option value="">Select {f.label}</option>
                          {((ref as any)[f.options] || []).map((opt: any) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name || opt.email}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={f.type || 'text'}
                          placeholder={f.placeholder || ''}
                          value={form[f.key] || ''}
                          onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        />
                      )}
                    </label>
                  ))}
                </div>
                <button className="btn primary" style={{ marginTop: 16 }} onClick={createEntity} disabled={busy}>
                  <Plus size={16} /> Create {pretty(entity)}
                </button>
              </div>

              {/* Entity List with Edit, Deactivate & Reset Password Actions */}
              <div className="panel">
                <h3>Existing {pretty(entity)}s</h3>
                <div className="table-scroll" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Identifier / Name</th>
                        <th>Details</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((ref as any)[`${entity}s`] || []).map((item: any) => {
                        const a = entity === 'assignment' ? assignmentDisplay(item) : null;
                        return (
                        <tr key={item.id}>
                          <td>
                            <strong>{a ? a.teacher : item.name || item.fullName || item.email}</strong>
                            {a && <div style={{ fontSize: 11, color: '#748792' }}>{a.subject}</div>}
                            {!a && item.teacherId && <div style={{ fontSize: 11, color: '#748792' }}>ID: {item.teacherId}</div>}
                            {item.code && <div style={{ fontSize: 11, color: '#748792' }}>Code: {item.code}</div>}
                          </td>
                          <td>
                            {item.startDate && item.endDate && (
                              <span>{item.startDate} to {item.endDate}</span>
                            )}
                            {item.orderIndex !== undefined && <span>Order: {item.orderIndex}</span>}
                            {item.department && <span>Dept: {item.department}</span>}
                            {a && <span>Class: {a.cls} · Year: {a.year}</span>}
                            {!a && item.gradeId && (
                              <span>Grade: {ref?.grades?.find((g) => g.id === item.gradeId)?.name || '—'}</span>
                            )}
                            {!a && item.classId && (
                              <span>Class: {ref?.classes?.find((c) => c.id === item.classId)?.name || '—'} · Subject: {ref?.subjects?.find((s) => s.id === item.subjectId)?.name || '—'}</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${item.active !== false ? 'badge-approved' : 'badge-returned'}`}>
                              {item.active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="btn outline"
                                style={{ padding: '4px 8px', fontSize: 12 }}
                                onClick={() => initiateEditEntity(entity, item)}
                              >
                                <Edit3 size={13} /> Edit
                              </button>
                              {entity === 'teacher' && (
                                <button
                                  className="btn outline"
                                  style={{ padding: '4px 8px', fontSize: 12 }}
                                  onClick={() => initiateResetTeacherPassword(item)}
                                >
                                  <KeyRound size={13} /> Reset Pwd
                                </button>
                              )}
                              <button
                                className="btn outline"
                                style={{ padding: '4px 8px', fontSize: 12, color: '#c67a53' }}
                                onClick={() => initiateDeleteEntity(entity, item.id, a ? `${a.teacher} · ${a.subject} · ${a.cls}` : item.name || item.email || entity)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================= PAGE: SPREADSHEET IMPORT (ADMIN) ================= */}
          {page === 'import' && user.role === 'ADMIN' && (
            <div className="panel form-panel">
              <div className="list-toolbar">
                <div>
                  <div className="eyebrow">BULK DATA ONBOARDING</div>
                  <h2>Import School Data from Spreadsheet</h2>
                  <p>Batch import students and teacher accounts together with their teaching assignments from CSV or XLSX.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {(['students', 'teachers'] as const).map((k) => (
                  <button
                    key={k}
                    className={`btn ${importKind === k ? 'primary' : 'outline'}`}
                    onClick={() => {
                      setImportKind(k);
                      setImportRows([]);
                      setImportHeaders([]);
                      setImportNotes([]);
                      setImportResult(null);
                    }}
                  >
                    Import {pretty(k)}
                  </button>
                ))}
              </div>

              <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
                {importKind === 'students'
                  ? 'Students workbook: every sheet with a No / Name / Surname / Year header row is read (including sheets with two class tables side by side). Missing grades, classes and the academic year are created automatically.'
                  : 'Teacher workbook: title rows are skipped, teachers listed on several rows are merged, and SUBJECTS / CLASSES become teaching assignments. Missing subjects and classes are created automatically.'}
              </p>

              <label style={{ display: 'block', marginBottom: 16 }}>
                Choose File (.csv or .xlsx)
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    run(async () => {
                      const parsed = await readImportFile(file, importKind);
                      setImportHeaders(parsed.headers);
                      setImportNotes(parsed.notes);
                      setMapping(Object.fromEntries(importFields[importKind].map((k) => [k, parsed.headers.includes(k) ? k : ''])));
                      setImportRows(parsed.rows);
                      setImportResult(null);
                    });
                  }}
                />
              </label>

              {importNotes.length > 0 && (
                <ul style={{ margin: '0 0 16px', paddingLeft: 18, fontSize: 12, color: '#475569' }}>
                  {importNotes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}

              {importHeaders.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h4>Columns Detected ({importRows.length} Rows)</h4>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Columns are matched automatically to the import format below. Nothing to map by hand.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: '12px 0' }}>
                    {importFields[importKind].map((k) => (
                      <label key={k}>
                        {k}
                        <input
                          readOnly
                          value={mapping[k] || '—'}
                          style={{ background: '#f1f5f9', color: '#334155', cursor: 'default' }}
                        />
                      </label>
                    ))}
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <h5 style={{ marginBottom: 8 }}>Preview</h5>
                    <div className="table-scroll" style={{ maxHeight: 220 }}>
                      <table>
                        <thead>
                          <tr>{importFields[importKind].map((k) => <th key={k}>{k}</th>)}</tr>
                        </thead>
                        <tbody>
                          {importRows.slice(0, 5).map((row, index) => (
                            <tr key={index}>
                              {importFields[importKind].map((k) => <td key={k}>{row[mapping[k]] || '—'}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn primary"
                      onClick={() => {
                        const missing = requiredImportFields[importKind].filter((k) => !mapping[k]);
                        if (missing.length) {
                          setError(`Map the required column(s) first: ${missing.join(', ')}.`);
                          return;
                        }
                        setModalConfig({
                          type: 'confirm',
                          title: 'Confirm Bulk Import',
                          message: `Import ${importRows.length} ${importKind} rows? Existing records will be updated and validated against your school.`,
                          confirmLabel: 'Run Import',
                          onConfirm: () => {
                            run(async () => {
                              const rows = importRows.map((r) =>
                                Object.fromEntries(importFields[importKind].map((k) => [k, r[mapping[k]] || '']))
                              );
                              const res = await post('import', { kind: importKind, rows });
                              setImportResult(res);
                              const parts = [`${res.imported} imported`, `${res.updated} updated`, `${res.skipped} errors`];
                              if (res.credentials?.length) parts.push(`${res.credentials.length} passwords generated and downloaded as teacher-passwords CSV`);
                              setNotice(`Import finished: ${parts.join(', ')}.`);
                              if (res.credentials?.length) downloadCredentials(res.credentials);
                              await refresh();
                            });
                          },
                        });
                      }}
                    >
                      Execute Import
                    </button>
                    <button className="btn outline" onClick={() => setImportResult(null)}>
                      Clear Results
                    </button>
                  </div>
                </div>
              )}

              {importResult && (
                <div style={{ marginTop: 20, padding: 16, background: '#f8fafc', borderRadius: 8 }}>
                  <h4>Import Results</h4>
                  <p>
                    Imported: <strong>{importResult.imported}</strong> · Updated: <strong>{importResult.updated}</strong> · Errors: <strong>{importResult.skipped}</strong>
                    {importResult.assignments ? (
                      <>
                        {' '}· Assignments: <strong>{importResult.assignments.created}</strong> new, <strong>{importResult.assignments.updated}</strong> reactivated
                      </>
                    ) : null}
                  </p>
                  {importResult.created && (
                    <p style={{ fontSize: 13 }}>
                      Created automatically:{' '}
                      {[
                        importResult.created.years ? `${importResult.created.years} academic year(s)` : '',
                        importResult.created.grades ? `${importResult.created.grades} grade(s)` : '',
                        importResult.created.classes ? `${importResult.created.classes} class(es)` : '',
                        importResult.created.subjects ? `${importResult.created.subjects} subject(s)` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'nothing new, everything already existed.'}
                    </p>
                  )}
                  {importResult.credentials && importResult.credentials.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 13 }}>
                        <strong>{importResult.credentials.length}</strong> teacher account(s) created. The teacher passwords CSV was
                        downloaded automatically — distribute it securely and delete it afterwards.
                      </p>
                      {importResult.credentials.some((c) => !c.emailProvided) && (
                        <p style={{ fontSize: 13, color: '#c67a53' }}>
                          Pending emails (sign in with the username until the organization supplies a real address):{' '}
                          {importResult.credentials
                            .filter((c) => !c.emailProvided)
                            .map((c) => c.name)
                            .join(', ')}
                        </p>
                      )}
                      <button
                        className="btn outline"
                        style={{ marginBottom: 12 }}
                        onClick={() => downloadCredentials(importResult.credentials!)}
                      >
                        <Download size={15} /> Download Passwords CSV
                      </button>
                      <div className="table-scroll" style={{ maxHeight: 200 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Username</th>
                              <th>Email</th>
                              <th>Password</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importResult.credentials.map((c, i) => (
                              <tr key={i}>
                                <td>{c.name}</td>
                                <td>{c.username}</td>
                                <td>
                                  {c.email}
                                  {!c.emailProvided ? ' (pending)' : ''}
                                </td>
                                <td>{c.password}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {importResult.errors.length > 0 && (
                    <>
                      <button
                        className="btn outline"
                        style={{ marginBottom: 12 }}
                        onClick={() => {
                          const csv = ['Row,Reason', ...importResult.errors.map((e) => `${e.row},${safeCsvCell(e.reason)}`)].join('\r\n');
                          downloadTextFile('import-errors.csv', csv);
                          setNotice('Error CSV downloaded: import-errors.csv');
                        }}
                      >
                        <Download size={15} /> Download Error CSV
                      </button>
                      <div className="table-scroll" style={{ maxHeight: 200, marginTop: 8 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Row</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importResult.errors.map((e, i) => (
                              <tr key={i}>
                                <td>{e.row}</td>
                                <td style={{ color: '#c67a53' }}>{e.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ================= PAGE: ORGANIZATIONS (SUPER ADMIN) ================= */}
          {page === 'organizations' && user.role === 'SUPER_ADMIN' && (
            <div>
              <div className="panel form-panel" style={{ marginBottom: 20 }}>
                <div className="list-toolbar">
                  <div>
                    <div className="eyebrow">MULTI-TENANT PLATFORM GOVERNANCE</div>
                    <h2>{orgForm.name ? 'Edit organization' : 'Create organization'}</h2>
                    <p>Provision and configure school instances across all jurisdictions.</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <label>School Name<input value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} /></label>
                  <label>Code<input value={orgForm.code} onChange={(e) => setOrgForm({ ...orgForm, code: e.target.value })} /></label>
                  <label>Timezone<input value={orgForm.timezone} onChange={(e) => setOrgForm({ ...orgForm, timezone: e.target.value })} /></label>
                  <label>Domain<input value={orgForm.domain} onChange={(e) => setOrgForm({ ...orgForm, domain: e.target.value })} /></label>
                  <LogoField
                    value={orgForm.logoUrl}
                    onChange={(v) => setOrgForm({ ...orgForm, logoUrl: v })}
                    onNotice={setNotice}
                    onError={setError}
                  />
                  <label style={{ justifyContent: 'center' }}>
                    <span>Active</span>
                    <input type="checkbox" checked={orgForm.active} onChange={(e) => setOrgForm({ ...orgForm, active: e.target.checked })} style={{ width: 18, height: 18 }} />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button className="btn primary" onClick={() => run(async () => {
                    const payload = { ...orgForm, id: undefined as string | undefined };
                    await post('organization', payload);
                    setNotice('Organization saved successfully.');
                    setOrgForm({ name: '', code: '', timezone: 'Africa/Bujumbura', domain: '', logoUrl: '/icons/school_logo.png', active: true });
                    const res = await api('organizations');
                    setOrganizations(res.organizations);
                  })}>Create Organization</button>
                </div>
              </div>

              <div className="panel">
                <div className="list-toolbar">
                  <div>
                    <h2>Partner Schools & Organizations</h2>
                    <p>{organizations.length} organizations configured.</p>
                  </div>
                </div>

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>School Name</th>
                        <th>Students</th>
                        <th>Teachers</th>
                        <th>Classes</th>
                        <th>Code</th>
                        <th>Timezone</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {organizations.map((org) => (
                        <tr key={org.id}>
                          <td><strong>{org.name}</strong><div style={{ fontSize: 11, color: '#748792' }}>{org.domain || 'No domain'}</div></td>
                          <td>{org.studentCount ?? 0}</td>
                          <td>{org.teacherCount ?? 0}</td>
                          <td>{org.classCount ?? 0}</td>
                          <td><code>{org.code}</code></td>
                          <td>{org.timezone}</td>
                          <td>
                            <span className={`badge ${org.active ? 'badge-approved' : 'badge-returned'}`}>
                              {org.active ? 'Active' : 'Suspended'}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="btn outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => {
                                setOrgForm({
                                  name: org.name,
                                  code: org.code,
                                  timezone: org.timezone,
                                  domain: org.domain || '',
                                  logoUrl: org.logoUrl || '',
                                  active: org.active,
                                });
                              }}>
                                Edit
                              </button>
                              <button className="btn outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => run(async () => {
                                await post('organization', { ...org, name: org.name, code: org.code, timezone: org.timezone, domain: org.domain || '', logoUrl: org.logoUrl || '', active: !org.active, id: org.id });
                                setNotice(`${org.name} is now ${!org.active ? 'active' : 'suspended'}.`);
                                const res = await api('organizations');
                                setOrganizations(res.organizations);
                              })}>
                                {org.active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button className="btn outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => {
                                setNotice(`Organization context opened for ${org.name}.`);
                                setPage('overview');
                              }}>
                                Open Organization
                              </button>
                              <button className="btn outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => {
                                setModalConfig({
                                  type: 'reset_password',
                                  title: 'Reset School Admin Password',
                                  targetName: org.name,
                                  onConfirm: (password) => {
                                    run(async () => {
                                      await post('resetAdmin', { organizationId: org.id, password });
                                      setNotice(`Admin password for ${org.name} has been reset.`);
                                    });
                                  },
                                });
                              }}>
                                Reset Admin
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================= PAGE: SETTINGS (ADMIN) ================= */}
          {page === 'settings' && user.role === 'ADMIN' && config && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Organization & Threshold Settings */}
              <div className="panel form-panel">
                <h3>School Configuration & Thresholds</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                  <label>
                    School Name
                    <input
                      type="text"
                      value={config.organization.name || ''}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          organization: { ...config.organization, name: e.target.value },
                        })
                      }
                    />
                  </label>
                  <LogoField
                    value={config.organization.logoUrl || ''}
                    onChange={(v) =>
                      setConfig({
                        ...config,
                        organization: { ...config.organization, logoUrl: v },
                      })
                    }
                    onNotice={setNotice}
                    onError={setError}
                  />
                  <label>
                    School Timezone
                    <input
                      type="text"
                      list="timezone-options"
                      value={config.organization.timezone || ''}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          organization: { ...config.organization, timezone: e.target.value },
                        })
                      }
                    />
                    <datalist id="timezone-options">
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    {'Excellent Threshold (avg >=)'}
                    <input
                      type="number"
                      step="0.05"
                      value={config.settings.excellentThreshold}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          settings: { ...config.settings, excellentThreshold: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    {'Good Threshold (avg >=)'}
                    <input
                      type="number"
                      step="0.05"
                      value={config.settings.goodThreshold}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          settings: { ...config.settings, goodThreshold: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    {'Homework Usually Threshold (rate >=)'}
                    <input
                      type="number"
                      step="0.05"
                      value={config.settings.homeworkUsuallyThreshold}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          settings: { ...config.settings, homeworkUsuallyThreshold: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <label>
                    {'Punctuality Occasionally Max (late rate <=)'}
                    <input
                      type="number"
                      step="0.05"
                      value={config.settings.punctualityOccasionallyMax}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          settings: { ...config.settings, punctualityOccasionallyMax: Number(e.target.value) },
                        })
                      }
                    />
                  </label>
                  <button
                    className="btn primary"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      run(async () => {
                        await post('settings', {
                          name: config.organization.name,
                          logoUrl: config.organization.logoUrl,
                          timezone: config.organization.timezone,
                          excellentThreshold: config.settings.excellentThreshold,
                          goodThreshold: config.settings.goodThreshold,
                          homeworkUsuallyThreshold: config.settings.homeworkUsuallyThreshold,
                          punctualityOccasionallyMax: config.settings.punctualityOccasionallyMax,
                        });
                        setNotice('Settings and thresholds updated successfully.');
                        await refresh();
                      });
                    }}
                  >
                    Save School Settings
                  </button>
                </div>
              </div>

              {/* Month Closures Manager */}
              <div className="panel form-panel">
                <h3>Reporting Period Closures (§165)</h3>
                <p style={{ fontSize: 13, color: '#748792' }}>
                  Lock completed reporting periods to preserve rule versioning and freeze modifications.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input
                    type="month"
                    id="newClosureMonth"
                    defaultValue={overview?.today?.slice(0, 7) || '2026-09'}
                    style={{ width: 160 }}
                  />
                  <button
                    className="btn primary"
                    onClick={() => {
                      const input = document.getElementById('newClosureMonth') as HTMLInputElement;
                      if (!input?.value) return;
                      run(async () => {
                        await post('month', { month: input.value, closed: true });
                        setNotice(`Reporting month ${input.value} closed and locked.`);
                        const cfg = await api('settings');
                        setConfig(cfg);
                      });
                    }}
                  >
                    Lock Month
                  </button>
                </div>

                <div className="table-scroll" style={{ marginTop: 16 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {config.closures.map((c) => (
                        <tr key={c.month}>
                          <td><strong>{c.month}</strong></td>
                          <td>
                            <span className={`badge ${c.closed ? 'badge-returned' : 'badge-approved'}`}>
                              {c.closed ? 'Closed & Locked' : 'Open'}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn outline"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              onClick={() => {
                                run(async () => {
                                  await post('month', { month: c.month, closed: !c.closed });
                                  setNotice(`Month ${c.month} status updated.`);
                                  const cfg = await api('settings');
                                  setConfig(cfg);
                                });
                              }}
                            >
                              {c.closed ? 'Reopen Month' : 'Lock Month'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Report Date Policy */}
              <div className="panel form-panel">
                <h3>Report Date Policy (§39)</h3>
                <p style={{ fontSize: 13, color: '#748792' }}>
                  Set how many days back a report may be dated. Teachers can create new reports
                  within this window, and you can correct existing reports to any date inside it.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                  <label>
                    Report Date Window (days)
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={config.settings.adminDateOverrideDays ?? 14}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          settings: { ...config.settings, adminDateOverrideDays: Number(e.target.value) },
                        })
                      }
                    />
                    <small style={{ color: '#748792', fontSize: 11, fontWeight: 600 }}>
                      Reports are accepted from {ref?.minDate || '—'} to {ref?.today || '—'}. Default is 14 days.
                    </small>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={config.settings.adminCanOverrideFuture !== false}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          settings: { ...config.settings, adminCanOverrideFuture: e.target.checked },
                        })
                      }
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>Allow reports dated in the future</span>
                  </label>
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => {
                      run(async () => {
                        await post('adminSettings', {
                          adminDateOverrideDays: Number(config.settings.adminDateOverrideDays ?? 14),
                          adminCanOverrideFuture: config.settings.adminCanOverrideFuture !== false,
                        });
                        setNotice('Report date policy updated.');
                        setConfig(await api('settings'));
                        await refresh();
                      });
                    }}
                  >
                    Save Report Date Policy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= PAGE: AUDIT LOG ================= */}
          {page === 'audit' && ['ADMIN', 'SUPER_ADMIN'].includes(user.role) && (
            <div className="panel">
              <div className="list-toolbar">
                <div>
                  <div className="eyebrow">SECURITY & COMPLIANCE TRAIL</div>
                  <h2>Immutable Platform Audit Log</h2>
                  <p>Cryptographically sequenced, timestamped record of administrative and evaluation events.</p>
                </div>
              </div>

              {auditLogs.length === 0 ? (
                <Empty title="No audit events" detail="Audit trail is currently empty." />
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Action</th>
                        <th>Entity Type</th>
                        <th>User</th>
                        <th>Metadata Snapshot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td><code>{log.action}</code></td>
                          <td>{log.entityType}</td>
                          <td style={{ fontSize: 12 }}>{log.userId || 'System'}</td>
                          <td style={{ fontSize: 12, maxWidth: 300 }}>
                            {log.metadata ? JSON.stringify(log.metadata) : '—'}
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
      </main>

      {/* MODAL DIALOGS */}
      <Modal config={modalConfig} onClose={() => setModalConfig(null)} />

      {/* STUDENT LONGITUDINAL PROFILE MODAL */}
      {studentProfile && (
        <StudentProfileModal
          data={studentProfile}
          onClose={() => setStudentProfile(null)}
          api={api}
        />
      )}
    </div>
  );
}
