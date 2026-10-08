'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, BarChart3, TrendingUp, Users, CheckCircle } from 'lucide-react';
import { buildReportActivitySeries, type Observation, type Rules } from '@/lib/reporting';
import { punctualityLabels } from '@/lib/monthly';

const punctualityLabel = (key: string) => punctualityLabels[key as keyof typeof punctualityLabels] ?? key.replaceAll('_', ' ');

interface Summary {
  studentId: string;
  studentName: string;
  studentCode: string;
  className: string;
  subjectName: string;
  teacherName?: string;
  lessons: number;
  performance: Record<string, number>;
  participation: Record<string, number>;
  homework: Record<string, number>;
  conduct: Record<string, number>;
  punctuality: Record<string, number>;
  performanceResult: string;
  participationResult: string;
  homeworkResult: string;
  conductResult: string;
  punctualityResult: string;
}

export default function StatisticsView({
  school,
  period,
  fileTag,
  summaries,
  rawObservations,
}: {
  school: string;
  period: string;
  fileTag: string;
  summaries: Summary[];
  rawObservations: Observation[];
}) {
  const [filters, setFilters] = useState({ classId: '', subject: '', teacher: '' })
const [msg, setMsg] = useState<string | null>(null);
useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 7000); return () => clearTimeout(t); }, [msg]);;

  const filteredObservations = useMemo(() => {
    return rawObservations.filter((row) => {
      const matchesClass = !filters.classId || row.className === filters.classId;
      const matchesSubject = !filters.subject || row.subjectName === filters.subject;
      const matchesTeacher = !filters.teacher || (row.teacherName || '') === filters.teacher;
      return matchesClass && matchesSubject && matchesTeacher;
    });
  }, [filters, rawObservations]);

  const filteredSummaries = useMemo(() => {
    return summaries.filter((row) => {
      const matchesClass = !filters.classId || row.className === filters.classId;
      const matchesSubject = !filters.subject || row.subjectName === filters.subject;
      const matchesTeacher = !filters.teacher || (row.teacherName || '') === filters.teacher;
      return matchesClass && matchesSubject && matchesTeacher;
    });
  }, [filters, summaries]);

    // Aggregate all raw observations across the school for this reporting period
  const stats = useMemo(() => {
    const totalObs = filteredObservations.length;
    const lessonsCount = new Set(filteredObservations.map((r) => r.lessonId)).size;
    const studentsCovered = new Set(filteredObservations.map((r) => r.studentId)).size;

    const tally = (key: keyof Observation) => {
      const counts: Record<string, number> = {};
      for (const r of filteredObservations) {
        const val = r[key];
        if (typeof val === 'string' && val) {
          counts[val] = (counts[val] || 0) + 1;
        }
      }
      return counts;
    };

    const performance = tally('performance');
    const participation = tally('participation');
    const homework = tally('homework');
    const conduct = tally('conduct');
    const punctuality = tally('punctuality');

    const punctualityTotal = Object.values(punctuality).reduce((a, b) => a + b, 0);
    const punctualityOnTime = (punctuality.ALWAYS_ON_TIME || 0) + (punctuality.USUALLY_ON_TIME || 0);

    return {
      totalObs,
      lessonsCount,
      studentsCovered,
      performance,
      participation,
      homework,
      conduct,
      punctuality,
      punctualityTotal,
      punctualityOnTime,
      reportActivity: buildReportActivitySeries(filteredObservations),
    };
  }, [filteredObservations]);

  // Export to Excel
  const exportStatisticsExcel = async () => {
    const Excel = (await import('exceljs')).default;
    const book = new Excel.Workbook();

    // Sheet 1: Aggregate Distributions
    const sheet1 = book.addWorksheet('School-wide Distributions');
    sheet1.addRow(['SCHOOL-WIDE ACADEMIC & BEHAVIOURAL STATISTICS']);
    sheet1.addRow([school, `Reporting Period: ${period}`]);
    sheet1.addRow(['Total Lessons', stats.lessonsCount, 'Total Observations', stats.totalObs, 'Students Covered', stats.studentsCovered]);
    sheet1.addRow([]);

    sheet1.addRow(['1. ACADEMIC PERFORMANCE DISTRIBUTION']);
    sheet1.addRow(['Level', 'Observation Count', 'Percentage']);
    const perfTotal = Object.values(stats.performance).reduce((a, b) => a + b, 0);
    Object.entries(stats.performance).forEach(([lvl, count]) => {
      sheet1.addRow([lvl.replace('_', ' '), count, perfTotal ? `${Math.round((count / perfTotal) * 100)}%` : '0%']);
    });
    sheet1.addRow([]);

    sheet1.addRow(['2. PUNCTUALITY DISTRIBUTION']);
    sheet1.addRow(['Category', 'Observation Count', 'Percentage']);
    const puncTotal = Object.values(stats.punctuality).reduce((a, b) => a + b, 0);
    Object.entries(stats.punctuality).forEach(([lvl, count]) => {
      sheet1.addRow([punctualityLabel(lvl), count, puncTotal ? `${Math.round((count / puncTotal) * 100)}%` : '0%']);
    });
    sheet1.addRow([]);

    sheet1.addRow(['3. CLASS PARTICIPATION DISTRIBUTION']);
    sheet1.addRow(['Level', 'Observation Count', 'Percentage']);
    const partTotal = Object.values(stats.participation).reduce((a, b) => a + b, 0);
    Object.entries(stats.participation).forEach(([lvl, count]) => {
      sheet1.addRow([lvl, count, partTotal ? `${Math.round((count / partTotal) * 100)}%` : '0%']);
    });
    sheet1.addRow([]);

    sheet1.addRow(['4. HOMEWORK DISTRIBUTION']);
    sheet1.addRow(['Status', 'Observation Count', 'Percentage']);
    const hwTotal = Object.values(stats.homework).reduce((a, b) => a + b, 0);
    Object.entries(stats.homework).forEach(([lvl, count]) => {
      sheet1.addRow([lvl.replace('_', ' '), count, hwTotal ? `${Math.round((count / hwTotal) * 100)}%` : '0%']);
    });
    sheet1.addRow([]);

    sheet1.addRow(['5. CONDUCT & DISCIPLINE DISTRIBUTION']);
    sheet1.addRow(['Rating', 'Observation Count', 'Percentage']);
    const condTotal = Object.values(stats.conduct).reduce((a, b) => a + b, 0);
    Object.entries(stats.conduct).forEach(([lvl, count]) => {
      sheet1.addRow([lvl.replace('_', ' '), count, condTotal ? `${Math.round((count / condTotal) * 100)}%` : '0%']);
    });

    sheet1.getColumn(1).width = 25;
    sheet1.getColumn(2).width = 20;
    sheet1.getColumn(3).width = 20;

    // Sheet 2: Student Summaries
    const sheet2 = book.addWorksheet('Student-Subject Summaries');
    sheet2.addRow(['Student ID', 'Student Name', 'Class', 'Subject', 'Teacher', 'Lessons', 'Punctuality', 'Performance Result', 'Participation Result', 'Homework Result', 'Conduct Result']);
    filteredSummaries.forEach((s) => {
      sheet2.addRow([
        s.studentCode,
        s.studentName,
        s.className,
        s.subjectName,
        s.teacherName || '—',
        s.lessons,
        s.punctualityResult,
        s.performanceResult.replace('_', ' '),
        s.participationResult,
        s.homeworkResult,
        s.conductResult.replace('_', ' '),
      ]);
    });
    sheet2.columns.forEach((col) => { col.width = 18; });

    const buffer = await book.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `${school.replace(/\s+/g, '_')}-${fileTag}-Statistics.xlsx`;
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg(`Analytics workbook downloaded: ${fileName}`);
  };

  const exportStatisticsCSV = () => {
    const lines = [
      'Category,Item,Observation Count,Percentage',
      ...formatCsvSection('Performance', stats.performance),
      ...formatCsvSection('Punctuality', stats.punctuality),
      ...formatCsvSection('Participation', stats.participation),
      ...formatCsvSection('Homework', stats.homework),
      ...formatCsvSection('Conduct', stats.conduct),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = `${school.replace(/\s+/g, '_')}-${fileTag}-Statistics.csv`;
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg(`Statistics CSV downloaded: ${fileName}`);
  };

  const formatCsvSection = (title: string, obj: Record<string, number>) => {
    const total = Object.values(obj).reduce((a, b) => a + b, 0);
    return Object.entries(obj).map(([key, count]) =>
      `"${title}","${key.replace('_', ' ')}",${count},"${total ? Math.round((count / total) * 100) : 0}%"`
    );
  };

  const uniqueClasses = Array.from(new Set(rawObservations.map((row) => row.className))).sort();
  const uniqueSubjects = Array.from(new Set(rawObservations.map((row) => row.subjectName))).sort();
  const uniqueTeachers = Array.from(new Set(rawObservations.map((row) => row.teacherName || '').filter(Boolean))).sort();

  return (
    <div className="panel statistics-panel">
      {msg && <div className="notice-banner" style={{ background: '#f0fdf4', color: '#166534', marginBottom: 16, borderColor: '#d3f2e0' }}>{msg}</div>}
      <div className="list-toolbar">
        <div>
          <div className="eyebrow">{school.toUpperCase()} · STATISTICAL INTELLIGENCE</div>
          <h2>Academic & Behavioural Distribution Analytics</h2>
          <p>
            {period} · {stats.lessonsCount} lessons recorded · {stats.studentsCovered} students evaluated · {stats.totalObs} total observations
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn outline" onClick={exportStatisticsCSV}>
            <Download size={15} /> Export CSV
          </button>
          <button className="btn primary" onClick={exportStatisticsExcel}>
            <Download size={15} /> Export Analytics Excel
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <label>Class<select value={filters.classId} onChange={(e) => setFilters({ ...filters, classId: e.target.value })}><option value="">All classes</option>{uniqueClasses.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Subject<select value={filters.subject} onChange={(e) => setFilters({ ...filters, subject: e.target.value })}><option value="">All subjects</option>{uniqueSubjects.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Teacher<select value={filters.teacher} onChange={(e) => setFilters({ ...filters, teacher: e.target.value })}><option value="">All teachers</option>{uniqueTeachers.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>

      {/* Top Highlights */}
      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">School-wide Punctuality</div>
          <div className="stat-value" style={{ color: stats.punctualityTotal && stats.punctualityOnTime / stats.punctualityTotal >= 0.85 ? '#22a57d' : '#c67a53' }}>
            {stats.punctualityTotal ? `${Math.round((stats.punctualityOnTime / stats.punctualityTotal) * 100)}%` : '—'}
          </div>
          <small style={{ color: '#748792' }}>{stats.punctualityOnTime} of {stats.punctualityTotal} evaluations on time</small>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Student Evaluations</div>
          <div className="stat-value">{stats.studentsCovered}</div>
          <small style={{ color: '#748792' }}>Across all reported classes</small>
        </div>
        <div className="stat-card">
          <div className="stat-label">Lessons Conducted</div>
          <div className="stat-value">{stats.lessonsCount}</div>
          <small style={{ color: '#748792' }}>Approved & submitted sessions</small>
        </div>
        <div className="stat-card">
          <div className="stat-label">Student Observations</div>
          <div className="stat-value">{stats.totalObs}</div>
          <small style={{ color: '#748792' }}>Detailed datapoints captured</small>
        </div>
      </div>

      {/* VISUAL DISTRIBUTION CHARTS (§146) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* CHART 1: Academic Performance */}
        <DistributionCard
          title="Academic Performance Distribution"
          data={[
            { label: 'Excellent', count: stats.performance.EXCELLENT || 0, color: '#22a57d' },
            { label: 'Good', count: stats.performance.GOOD || 0, color: '#3b82f6' },
            { label: 'Needs Improvement', count: stats.performance.NEEDS_IMPROVEMENT || 0, color: '#c67a53' },
          ]}
        />

        {/* CHART 2: Participation */}
        <DistributionCard
          title="Classroom Participation"
          data={[
            { label: 'Active', count: stats.participation.ACTIVE || 0, color: '#22a57d' },
            { label: 'Moderate', count: stats.participation.MODERATE || 0, color: '#3b82f6' },
            { label: 'Passive', count: stats.participation.PASSIVE || 0, color: '#c67a53' },
          ]}
        />

        {/* CHART 3: Homework Completion */}
        <DistributionCard
          title="Homework & Assignment Completion"
          data={[
            { label: 'Always Completed', count: stats.homework.ALWAYS_COMPLETED || 0, color: '#22a57d' },
            { label: 'Usually Completed', count: stats.homework.USUALLY_COMPLETED || 0, color: '#3b82f6' },
            { label: 'Rarely Completed', count: stats.homework.RARELY_COMPLETED || 0, color: '#c67a53' },
          ]}
        />

        {/* CHART 4: Discipline & Conduct */}
        <DistributionCard
          title="Discipline & School Conduct"
          data={[
            { label: 'Excellent', count: stats.conduct.EXCELLENT || 0, color: '#22a57d' },
            { label: 'Good', count: stats.conduct.GOOD || 0, color: '#3b82f6' },
            { label: 'Needs Improvement', count: stats.conduct.NEEDS_IMPROVEMENT || 0, color: '#c67a53' },
          ]}
        />

        {/* CHART 5: Punctuality */}
        <DistributionCard
          title="Punctuality"
          data={[
            { label: 'Always On Time', count: stats.punctuality.ALWAYS_ON_TIME || 0, color: '#22a57d' },
            { label: 'Usually On Time', count: stats.punctuality.USUALLY_ON_TIME || 0, color: '#3b82f6' },
            { label: 'Occasionally Late', count: stats.punctuality.OCCASIONALLY_LATE || 0, color: '#d79c41' },
            { label: 'Frequently Late', count: stats.punctuality.FREQUENTLY_LATE || 0, color: '#c67a53' },
            { label: 'Occasionally Absent', count: stats.punctuality.OCCASIONALLY_ABSENT || 0, color: '#b06a4e' },
            { label: 'Frequently Absent', count: stats.punctuality.FREQUENTLY_ABSENT || 0, color: '#8a4a32' },
            { label: 'Always Absent', count: stats.punctuality.ALWAYS_ABSENT || 0, color: '#5f3220' },
          ]}
        />

        <div className="panel sub-panel" style={{ padding: 18, gridColumn: '1 / -1' }}>
          <h3 style={{ fontSize: 15, marginBottom: 12, fontWeight: 600 }}>Report Activity</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {stats.reportActivity.map((entry) => (
              <div key={entry.date} style={{ background: '#f8fafb', border: '1px solid #e4edf1', borderRadius: 8, padding: '10px 12px', minWidth: 150 }}>
                <div style={{ fontSize: 11, color: '#718493', marginBottom: 4 }}>{entry.date}</div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{entry.total} records</div>
                <div style={{ fontSize: 11, color: '#5c6d7c' }}>Submitted: {entry.submitted} · Approved: {entry.approved} · Returned: {entry.returned}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DistributionCard({
  title,
  data,
}: {
  title: string;
  data: { label: string; count: number; color: string }[];
}) {
  const total = data.reduce((a, b) => a + b.count, 0);

  return (
    <div className="panel sub-panel" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 15, marginBottom: 14, fontWeight: 600 }}>{title}</h3>

      {/* Stacked bar visualization */}
      {total > 0 && (
        <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', marginBottom: 16, background: '#e2e8f0' }}>
          {data.map((item, i) => {
            const pct = Math.round((item.count / total) * 100);
            if (pct === 0) return null;
            return (
              <div
                key={i}
                title={`${item.label}: ${item.count} (${pct}%)`}
                style={{
                  width: `${pct}%`,
                  background: item.color,
                  transition: 'width 0.3s ease',
                }}
              />
            );
          })}
        </div>
      )}

      {/* Numerical breakdown rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((item, i) => {
          const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: item.color }} />
                <span>{item.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ minWidth: 35, textAlign: 'right' }}>{item.count}</strong>
                <span style={{ minWidth: 40, textAlign: 'right', color: '#748792' }}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
