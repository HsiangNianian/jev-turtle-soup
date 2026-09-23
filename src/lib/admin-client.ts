/**
 * 管理后台的取数层。全部走登录态（cookie），页面不需要任何 token。
 * 类型和后端 shared/admin.ts、shared/audit.ts、shared/telemetry.ts 一一对应。
 */
import type { ReportSnapshotRead } from '../../shared/report-snapshot'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`)
  return data as T
}

export interface AdminEntry {
  uid: string
  email: string
  displayName: string | null
  handle: string | null
  createdAt: number
}

export interface AdminReport extends ReportSnapshotRead {
  id: string
  puzzleId: string | null
  puzzleTitle: string | null
  kind: string | null
  playerKey: string | null
  locale: string | null
  note: string
  status: string
  createdAt: number
  targetType: string | null
  targetId: string | null
}

export interface AdminFlag {
  id: string
  turnLogId: string
  puzzleId: string
  question: string
  firstVerdict: string
  secondVerdict: string
  confidence: number
  reason: string
  createdAt: number
}

export interface AdminError {
  hash: string
  message: string
  stack: string
  path: string
  buildId: string
  locale: string
  source: string
  count: number
  firstAt: number
  lastAt: number
}

export function listAdminReports() {
  return request<{ items: AdminReport[] }>('/api/admin/reports?limit=200').then((d) => d.items)
}

export function setAdminReportStatus(id: string, status: string) {
  return request<{ ok: boolean }>(`/api/admin/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function deleteAdminReport(id: string) {
  return request<{ ok: boolean }>(`/api/admin/reports/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function listAdminFlags() {
  return request<{ items: AdminFlag[] }>('/api/admin/flags?limit=200').then((d) => d.items)
}

export function deleteAdminFlag(id: string) {
  return request<{ ok: boolean }>(`/api/admin/flags/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function listAdminErrors() {
  return request<{ items: AdminError[] }>('/api/admin/errors?limit=200').then((d) => d.items)
}

export function deleteAdminError(hash: string) {
  return request<{ ok: boolean }>(`/api/admin/errors/${encodeURIComponent(hash)}`, {
    method: 'DELETE',
  })
}

export function clearAdminErrors() {
  return request<{ ok: boolean }>('/api/admin/errors', { method: 'DELETE' })
}

export function listAdminAdmins() {
  return request<{ items: AdminEntry[] }>('/api/admin/admins').then((d) => d.items)
}

export function addAdmin(identifier: string) {
  const value = identifier.trim()
  const body = value.includes('@') ? { email: value } : { uid: value }
  return request<{ admin: AdminEntry }>('/api/admin/admins', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((d) => d.admin)
}

export interface AdminPuzzle {
  id: string
  title: string
  surface: string
  ownerName: string
  plays: number
  solves: number
  featured: boolean
  createdAt: number
}

export function listAdminPuzzles() {
  return request<{ items: AdminPuzzle[] }>('/api/admin/puzzles?limit=200').then((d) => d.items)
}

export function setAdminPuzzleFeatured(id: string, featured: boolean) {
  return request<{ ok: boolean }>(`/api/admin/puzzles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ featured }),
  })
}

export interface DigestCounts {
  plays: number
  solves: number
  likes: number
  comments: number
}

export interface DigestRecipient {
  uid: string
  email: string
  displayName: string
  locale: string
  total: number
  counts: DigestCounts
}

export interface AdminDigest {
  windowMs: number
  recipients: DigestRecipient[]
  preview: { subject: string; text: string; html: string } | null
}

export function getAdminDigest() {
  return request<AdminDigest>('/api/admin/digest')
}

export function sendAdminDigest() {
  return request<{ sent: number; failed: number; total: number }>('/api/admin/digest/send', {
    method: 'POST',
  })
}

export function removeAdmin(uid: string) {
  return request<{ ok: boolean }>(`/api/admin/admins/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
  })
}
