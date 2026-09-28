import { AppError } from './security';

export type ReportStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'RETURNED';
export type ReviewAction = 'UNDER_REVIEW' | 'APPROVED' | 'RETURNED' | 'SUBMITTED';

/** A SUBMITTED action on an approved report means reopen it for teacher correction. */
export function reviewTransition(previous: string, action: ReviewAction, reason?: string) {
  if (previous === 'APPROVED' && action === 'SUBMITTED') {
    if (!reason?.trim()) throw new AppError('A reason is required to reopen an approved report.');
    return { status: 'RETURNED' as ReportStatus, auditAction: 'REPORT_REOPENED' };
  }
  if (action === 'UNDER_REVIEW' && previous === 'SUBMITTED')
    return { status: 'UNDER_REVIEW' as ReportStatus, auditAction: 'REPORT_UNDER_REVIEW' };
  if (action === 'APPROVED' && previous === 'UNDER_REVIEW')
    return { status: 'APPROVED' as ReportStatus, auditAction: 'REPORT_APPROVED' };
  if (action === 'RETURNED' && (previous === 'SUBMITTED' || previous === 'UNDER_REVIEW')) {
    if (!reason?.trim()) throw new AppError('A reason is required to return a report.');
    return { status: 'RETURNED' as ReportStatus, auditAction: 'REPORT_RETURNED' };
  }
  throw new AppError('This report status change is not allowed.', 409);
}
