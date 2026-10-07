import type { Metadata } from 'next';
import AdminApp from '@/components/admin/AdminApp';
import './admin.css';
// 운영팀 데이터 관리 화면. 검색엔진에는 노출하지 않는다. 저장은 GitHub 토큰이 있어야 가능하다.
export const metadata: Metadata = { title: '골프장 데이터 관리 | PLK Golf Map', robots: { index: false, follow: false } };
export default function AdminPage() { return <AdminApp/>; }
