'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleAlert, Download, EyeOff, FileUp, KeyRound, LoaderCircle, MapPin, PauseCircle, Plus, RotateCcw, Save, Search, Undo2 } from 'lucide-react';
import { applyEdit, EMPTY_CORRECTIONS, kindOf, validateEdit, type CourseEdit, type CourseKind, type Corrections, type ReviewDecision } from '@/lib/corrections';
import { regionOf } from '@/lib/region';
import { REVIEW_LABELS, type ReviewData, type ReviewItem, type ReviewType } from '@/lib/review';
import type { GolfCourse } from '@/lib/types';
import { markerKind } from '../GolfCourseMarker';
import AdminLocationMap from './AdminLocationMap';
import { checkAccess, deployStatus, loadCorrections, saveCorrections, type GitHubConfig } from './github';
import { coursesCsv, downloadText, reviewCsv, today } from './files';

const TOKEN_KEY = 'plk-golfmap:admin-token';
const REPO_KEY = 'plk-golfmap:admin-repo';
const DRAFT_KEY = 'plk-golfmap:admin-draft';
const KINDS: CourseKind[] = ['제휴', '이용협약', '일반', '협의중'];
const storage = { get: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } }, set: (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* 저장소를 쓸 수 없음 */ } } };
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 원본과 같은 값은 지우고, 남는 수정이 없으면 항목 자체를 지운다.
function cleanEdit(original: GolfCourse, edit: CourseEdit): CourseEdit | null {
  const next: CourseEdit = { ...edit };
  if (next.lat === original.lat && next.lng === original.lng) { delete next.lat; delete next.lng; }
  for (const field of ['name', 'address', 'phone', 'homepage', 'holes'] as const) if (next[field] === original[field]) delete next[field];
  if (next.kind === kindOf(original)) delete next.kind;
  if (next.partnerNote === (original.partnerNote ?? '')) delete next.partnerNote;
  if (!next.memo) delete next.memo;
  if (!next.exclude) delete next.exclude;
  delete next.updatedAt;
  return Object.keys(next).length ? { ...next, updatedAt: new Date().toISOString() } : null;
}

interface Row { id: string; original: GolfCourse; course: GolfCourse; edit?: CourseEdit; added: boolean }

export default function AdminApp() {
  const [data, setData] = useState<{ base: GolfCourse[]; review: ReviewData; deployed: Corrections } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [config, setConfig] = useState<GitHubConfig>({ repo: process.env.NEXT_PUBLIC_ADMIN_REPO || '', token: '', branch: 'main' });
  const [access, setAccess] = useState<{ fullName: string; canWrite: boolean } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [loaded, setLoaded] = useState<Corrections>(EMPTY_CORRECTIONS);
  const [sha, setSha] = useState<string | null>(null);
  const [draft, setDraft] = useState<Corrections>(EMPTY_CORRECTIONS);
  const [storedDraft, setStoredDraft] = useState<Corrections | null>(null);
  const [tab, setTab] = useState<'courses' | 'review'>('courses');
  const [search, setSearch] = useState('');
  const [listFilter, setListFilter] = useState<'all' | 'edited' | 'excluded' | 'added'>('all');
  const [reviewType, setReviewType] = useState<ReviewType | 'all'>('all');
  const [showDone, setShowDone] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingPoint, setPendingPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'info'; text: string; link?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deploy, setDeploy] = useState<{ commitSha: string; state: string; url: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 1) 배포된 원본·수정·검수 목록 불러오기, 저장된 토큰으로 자동 연결
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/admin-data.json`).then((response) => { if (!response.ok) throw new Error('관리 데이터를 불러오지 못했어요.'); return response.json(); })
      .then((json: { base: GolfCourse[]; corrections: Corrections; review: ReviewData }) => {
        const deployed = { ...EMPTY_CORRECTIONS, ...json.corrections };
        setData({ base: json.base, review: json.review, deployed });
        setLoaded(deployed); setDraft(deployed);
        const saved = storage.get(DRAFT_KEY);
        if (saved) { try { const parsed = JSON.parse(saved) as Corrections; if (!sameJson(parsed, deployed)) setStoredDraft(parsed); } catch { storage.set(DRAFT_KEY, null); } }
      }).catch((error: Error) => setLoadError(error.message));
    const token = storage.get(TOKEN_KEY);
    const repo = storage.get(REPO_KEY);
    if (token) setConfig((current) => ({ ...current, token, repo: repo || current.repo }));
    else setShowConnect(true);
  }, []);

  const connect = useCallback(async (next: GitHubConfig, quiet = false) => {
    if (!next.token || !next.repo) { setMessage({ tone: 'error', text: '저장소와 토큰을 입력해 주세요.' }); return; }
    setConnecting(true);
    try {
      const result = await checkAccess(next);
      setAccess(result);
      if (!result.canWrite) throw new Error('이 토큰에는 저장소 쓰기 권한이 없어요. Contents 읽기·쓰기 권한으로 다시 만들어 주세요.');
      const latest = await loadCorrections(next);
      setLoaded(latest.corrections); setSha(latest.sha);
      setDraft((current) => (sameJson(current, data?.deployed ?? EMPTY_CORRECTIONS) ? latest.corrections : current));
      storage.set(TOKEN_KEY, next.token); storage.set(REPO_KEY, next.repo);
      setShowConnect(false);
      if (!quiet) setMessage({ tone: 'ok', text: `${result.fullName}에 연결했어요. 저장소의 최신 수정 내용을 불러왔어요.` });
    } catch (error) {
      setAccess(null);
      setMessage({ tone: 'error', text: (error as Error).message });
      setShowConnect(true);
    } finally { setConnecting(false); }
  }, [data]);
  useEffect(() => { if (data && config.token && !access && !connecting && !showConnect) void connect(config, true); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 수정 중인 내용은 이 브라우저에 임시 저장(창을 닫아도 남음), 저장하지 않고 나가면 경고
  const dirty = !sameJson(draft, loaded);
  useEffect(() => { if (data) storage.set(DRAFT_KEY, dirty ? JSON.stringify(draft) : null); }, [draft, dirty, data]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);

  // 2) 화면에 보일 골프장: 원본 + 다시 넣은 골프장(제외한 곳 포함)에 수정 내용을 적용
  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const added = Object.values(draft.added).filter((course) => !data.base.some((item) => item.id === course.id));
    return [...data.base, ...added].map((original) => ({ id: original.id, original, course: applyEdit(original, draft.courses[original.id]), edit: draft.courses[original.id], added: !!draft.added[original.id] }));
  }, [data, draft]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const changeCount = useMemo(() => {
    const keys = (record: Record<string, unknown>) => Object.keys(record);
    const ids = new Set([...keys(draft.courses), ...keys(loaded.courses), ...keys(draft.added), ...keys(loaded.added), ...keys(draft.reviews), ...keys(loaded.reviews)]);
    let count = 0;
    for (const id of ids) if (!sameJson(draft.courses[id], loaded.courses[id]) || !sameJson(draft.added[id], loaded.added[id]) || !sameJson(draft.reviews[id], loaded.reviews[id])) count += 1;
    return count;
  }, [draft, loaded]);

  const visibleRows = useMemo(() => {
    const keyword = search.trim().toLowerCase().replace(/\s+/g, '');
    return rows.filter((row) => {
      if (listFilter === 'edited' && !row.edit) return false;
      if (listFilter === 'excluded' && !row.edit?.exclude) return false;
      if (listFilter === 'added' && !row.added) return false;
      return !keyword || `${row.course.name}${row.course.address}${row.id}`.toLowerCase().replace(/\s+/g, '').includes(keyword);
    });
  }, [rows, search, listFilter]);
  const reviewItems = useMemo(() => {
    if (!data) return [];
    return data.review.items.filter((item) => (reviewType === 'all' || item.type === reviewType) && (showDone || (!draft.reviews[item.key] && !(item.candidate && draft.added[item.candidate.id]))));
  }, [data, reviewType, showDone, draft]);
  const reviewOpen = useMemo(() => data ? data.review.items.filter((item) => !draft.reviews[item.key] && !(item.candidate && draft.added[item.candidate.id])).length : 0, [data, draft]);

  // 3) 수정 동작
  const updateEdit = (id: string, patch: Partial<CourseEdit>) => setDraft((current) => {
    const row = rowById.get(id);
    if (!row) return current;
    const next = cleanEdit(row.original, { ...current.courses[id], ...patch });
    const courses = { ...current.courses };
    if (next) courses[id] = next; else delete courses[id];
    return { ...current, courses };
  });
  const resetCourse = (id: string) => setDraft((current) => { const courses = { ...current.courses }; if (loaded.courses[id]) courses[id] = loaded.courses[id]; else delete courses[id]; return { ...current, courses }; });
  const setReview = (key: string, decision: ReviewDecision | null) => setDraft((current) => { const reviews = { ...current.reviews }; if (decision) reviews[key] = { decision, at: new Date().toISOString() }; else delete reviews[key]; return { ...current, reviews }; });
  const addCandidate = (item: ReviewItem) => {
    if (!item.candidate) return;
    const point = pendingPoint ?? (item.candidate.lat ? { lat: item.candidate.lat, lng: item.candidate.lng } : null);
    if (!point) { setMessage({ tone: 'error', text: '위치를 먼저 지정해 주세요. 오른쪽 지도를 눌러 골프장 위치에 핀을 놓으면 돼요.' }); return; }
    const course = { ...item.candidate, ...point };
    setDraft((current) => ({ ...current, added: { ...current.added, [course.id]: course } }));
    setPendingPoint(null);
    setMessage({ tone: 'ok', text: `${course.name}을(를) 지도에 다시 넣었어요. 저장하면 반영돼요.` });
  };
  const removeAdded = (id: string) => setDraft((current) => { const added = { ...current.added }; delete added[id]; const courses = { ...current.courses }; delete courses[id]; return { ...current, added, courses }; });

  // 4) 저장(GitHub 커밋) → 배포 상태 확인
  const save = async () => {
    if (!access) { setShowConnect(true); setMessage({ tone: 'info', text: 'GitHub에 연결하면 바로 저장할 수 있어요. 연결 없이 쓰려면 "파일 받기"로 수정 파일을 내려받아 전달해 주세요.' }); return; }
    const errors = Object.entries(draft.courses).flatMap(([id, edit]) => validateEdit(edit).map((error) => `${rowById.get(id)?.course.name ?? id}: ${error}`));
    if (errors.length) { setMessage({ tone: 'error', text: errors.slice(0, 3).join(' / ') }); return; }
    setSaving(true);
    try {
      const next = { ...draft, updatedAt: new Date().toISOString() };
      const result = await saveCorrections(config, next, sha, `운영팀 수정 ${changeCount}건 (관리 화면)`);
      setLoaded(next); setDraft(next); setSha(result.sha);
      storage.set(DRAFT_KEY, null);
      setDeploy({ commitSha: result.commitSha, state: '배포 준비 중', url: result.commitUrl });
      setMessage({ tone: 'ok', text: `저장했어요(${changeCount}건). 사이트 반영까지 2~3분 걸려요.`, link: result.commitUrl });
    } catch (error) {
      setMessage({ tone: 'error', text: (error as Error).message });
    } finally { setSaving(false); }
  };
  useEffect(() => {
    if (!deploy || deploy.state === '배포 완료' || deploy.state === '배포 실패') return;
    const timer = setInterval(async () => {
      const status = await deployStatus(config, deploy.commitSha);
      if (!status) { setDeploy((current) => current && { ...current, state: '배포 진행 중(상태 확인 권한 없음)' }); clearInterval(timer); return; }
      const state = status.status === 'completed' ? (status.conclusion === 'success' ? '배포 완료' : '배포 실패') : status.status === 'in_progress' ? '배포 중' : '배포 대기 중';
      setDeploy((current) => current && { ...current, state, url: status.url || current.url });
    }, 10000);
    return () => clearInterval(timer);
  }, [deploy, config]);

  // 5) 파일 받기 · 불러오기
  const downloadCorrections = () => downloadText(`corrections_${today()}.json`, JSON.stringify(draft, null, 2) + '\n', 'application/json');
  const downloadCourses = () => downloadText(`골프장목록_${today()}.csv`, coursesCsv(rows.map((row) => row.course), draft), 'text/csv;charset=utf-8');
  const downloadReview = () => data && downloadText(`검수목록_${today()}.csv`, reviewCsv(data.review.items, draft), 'text/csv;charset=utf-8');
  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Corrections>;
      if (typeof parsed !== 'object' || !parsed || !('courses' in parsed)) throw new Error('수정 파일 형식이 아니에요.');
      setDraft({ ...EMPTY_CORRECTIONS, ...parsed } as Corrections);
      setMessage({ tone: 'ok', text: `${file.name}을(를) 불러왔어요. 확인 후 저장해 주세요.` });
    } catch (error) { setMessage({ tone: 'error', text: `파일을 읽지 못했어요: ${(error as Error).message}` }); }
  };

  if (loadError) return <main className="admin-shell"><p className="admin-message error"><CircleAlert size={16}/>{loadError}</p></main>;
  if (!data) return <main className="admin-shell"><p className="admin-loading"><LoaderCircle className="spin" size={20}/>관리 데이터를 불러오는 중…</p></main>;

  const selectedRow = selectedId ? rowById.get(selectedId) : undefined;
  const selectedItem = selectedKey ? data.review.items.find((item) => item.key === selectedKey) : undefined;
  const itemRow = selectedItem?.courseId ? rowById.get(selectedItem.courseId) : undefined;
  const openCourse = (id: string) => { setTab('courses'); setSelectedId(id); setSelectedKey(null); };

  return <main className="admin-shell">
    {/* 상단: 저장 상태 · 파일 · 저장 */}
    <header className="admin-header">
      <div className="admin-title"><span className="logo-mark" aria-hidden="true">P</span><div><h1>골프장 데이터 관리</h1><p>{access ? `${access.fullName} 연결됨` : 'GitHub 미연결 · 파일로 받아 전달 가능'}{deploy && <> · <a href={deploy.url} target="_blank" rel="noopener noreferrer">{deploy.state}</a></>}</p></div></div>
      <div className="admin-actions">
        <span className={`change-count${changeCount ? ' on' : ''}`}>{changeCount ? `저장 안 한 변경 ${changeCount}건` : '변경 없음'}</span>
        <details className="admin-menu"><summary><Download size={15}/>파일 받기</summary><div>
          <button onClick={downloadCorrections}>수정 파일 (corrections.json)</button>
          <button onClick={downloadCourses}>전체 골프장 목록 (CSV)</button>
          <button onClick={downloadReview}>검수 목록 (CSV)</button>
        </div></details>
        <button className="ghost" onClick={() => fileInput.current?.click()}><FileUp size={15}/>불러오기</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }}/>
        <button className="ghost" onClick={() => setShowConnect((value) => !value)}><KeyRound size={15}/>GitHub</button>
        <button className="primary" disabled={!changeCount || saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>}저장</button>
      </div>
    </header>
    {message && <p className={`admin-message ${message.tone}`} role="status">{message.tone === 'error' ? <CircleAlert size={16}/> : <Check size={16}/>}<span>{message.text}{message.link && <> <a href={message.link} target="_blank" rel="noopener noreferrer">커밋 보기</a></>}</span><button onClick={() => setMessage(null)} aria-label="닫기">×</button></p>}
    {storedDraft && <p className="admin-message info"><Undo2 size={16}/><span>이 브라우저에 저장하지 않은 수정 내용이 남아 있어요.</span><button className="link" onClick={() => { setDraft(storedDraft); setStoredDraft(null); }}>불러오기</button><button className="link" onClick={() => { storage.set(DRAFT_KEY, null); setStoredDraft(null); }}>버리기</button></p>}

    {/* GitHub 연결 */}
    {showConnect && <section className="admin-connect">
      <h2>GitHub 연결</h2>
      <p>저장하면 저장소의 <code>data/corrections.json</code>이 바뀌고 사이트가 자동으로 다시 배포돼요. 토큰은 이 브라우저에만 저장돼요.</p>
      <ol><li>github.com → Settings → Developer settings → <b>Fine-grained tokens</b> → Generate new token</li><li>Repository access: <b>Only select repositories</b> → 이 저장소 선택</li><li>Permissions: <b>Contents: Read and write</b>, <b>Actions: Read-only</b> → 생성 후 토큰 복사</li></ol>
      <form onSubmit={(event) => { event.preventDefault(); void connect(config); }}>
        <label>저장소<input value={config.repo} onChange={(event) => setConfig({ ...config, repo: event.target.value.trim() })} placeholder="계정/저장소 (예: yckim747/plk-golfmap)"/></label>
        <label>토큰<input type="password" value={config.token} onChange={(event) => setConfig({ ...config, token: event.target.value.trim() })} placeholder="github_pat_…" autoComplete="off"/></label>
        <div className="row"><button className="primary" type="submit" disabled={connecting}>{connecting ? <LoaderCircle className="spin" size={15}/> : <KeyRound size={15}/>}연결</button>{access && <button type="button" className="ghost" onClick={() => { storage.set(TOKEN_KEY, null); setAccess(null); setConfig({ ...config, token: '' }); setMessage({ tone: 'info', text: '연결을 해제하고 토큰을 지웠어요.' }); }}>연결 해제</button>}</div>
      </form>
    </section>}

    <div className="admin-body">
      {/* 왼쪽: 골프장 / 검수 목록 */}
      <aside className="admin-list">
        <div className="admin-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'courses'} className={tab === 'courses' ? 'active' : ''} onClick={() => setTab('courses')}>골프장 <span>{rows.length}</span></button>
          <button role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>검수 <span>{reviewOpen}</span></button>
        </div>
        {tab === 'courses' ? <>
          <div className="admin-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름·주소·ID 검색"/></div>
          <div className="admin-filters">{([['all', '전체'], ['edited', '수정됨'], ['excluded', '제외됨'], ['added', '다시 넣음']] as const).map(([value, label]) => <button key={value} className={listFilter === value ? 'active' : ''} onClick={() => setListFilter(value)}>{label}</button>)}</div>
          <ul className="admin-items">{visibleRows.slice(0, 300).map((row) => <li key={row.id}><button className={`${selectedId === row.id ? 'selected' : ''}${row.edit?.exclude ? ' excluded' : ''}`} onClick={() => { setSelectedId(row.id); setSelectedKey(null); }}>
            <i className={`dot ${markerKind(row.course)}`}/><span><strong>{row.course.name}</strong><small>{row.id} · {regionOf(row.course.address)}</small></span>
            {row.edit?.exclude ? <em className="badge badge-gray">제외</em> : row.added ? <em className="badge badge-blue">다시 넣음</em> : row.edit ? <em className="badge badge-green">수정</em> : null}
          </button></li>)}{visibleRows.length > 300 && <li className="more">검색어로 좁혀 주세요 (총 {visibleRows.length}곳)</li>}</ul>
        </> : <>
          <select className="admin-select" value={reviewType} onChange={(event) => setReviewType(event.target.value as ReviewType | 'all')}><option value="all">모든 검수 항목</option>{(Object.keys(REVIEW_LABELS) as ReviewType[]).map((type) => <option key={type} value={type}>{REVIEW_LABELS[type]} ({data.review.items.filter((item) => item.type === type).length})</option>)}</select>
          <label className="admin-check"><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)}/>처리한 항목도 보기</label>
          <ul className="admin-items">{reviewItems.slice(0, 300).map((item) => { const decision = draft.reviews[item.key]?.decision; const added = item.candidate && draft.added[item.candidate.id]; return <li key={item.key}><button className={selectedKey === item.key ? 'selected' : ''} onClick={() => { setSelectedKey(item.key); setSelectedId(null); setPendingPoint(null); }}>
            <span><strong>{item.title}</strong><small>{REVIEW_LABELS[item.type]}</small></span>
            {added ? <em className="badge badge-blue">넣음</em> : decision === '확인' ? <em className="badge badge-green">확인</em> : decision === '보류' ? <em className="badge badge-gray">보류</em> : null}
          </button></li>; })}{!reviewItems.length && <li className="more">처리할 항목이 없어요.</li>}</ul>
          {reviewType !== 'all' && reviewItems.length > 0 && <button className="ghost block" onClick={() => setDraft((current) => { const reviews = { ...current.reviews }; for (const item of reviewItems) reviews[item.key] = reviews[item.key] ?? { decision: '확인', at: new Date().toISOString() }; return { ...current, reviews }; })}><Check size={14}/>보이는 {reviewItems.length}건 모두 확인</button>}
        </>}
      </aside>

      {/* 오른쪽: 편집 */}
      <section className="admin-editor">
        {selectedRow ? <CourseEditor key={selectedRow.id} row={selectedRow} loadedEdit={loaded.courses[selectedRow.id]} onChange={(patch) => updateEdit(selectedRow.id, patch)} onReset={() => resetCourse(selectedRow.id)} onRemoveAdded={() => removeAdded(selectedRow.id)}/>
          : selectedItem ? <div className="review-panel">
            <span className="eyebrow">{REVIEW_LABELS[selectedItem.type]}</span>
            <h2>{selectedItem.title}</h2>
            <p className="review-detail">{selectedItem.detail}</p>
            {selectedItem.candidate && <p className="review-detail">{selectedItem.candidate.address} · {selectedItem.candidate.id}</p>}
            <div className="review-actions">
              <button className={draft.reviews[selectedItem.key]?.decision === '확인' ? 'primary' : 'ghost'} onClick={() => setReview(selectedItem.key, draft.reviews[selectedItem.key]?.decision === '확인' ? null : '확인')}><Check size={15}/>확인(문제 없음)</button>
              <button className={draft.reviews[selectedItem.key]?.decision === '보류' ? 'primary' : 'ghost'} onClick={() => setReview(selectedItem.key, draft.reviews[selectedItem.key]?.decision === '보류' ? null : '보류')}><PauseCircle size={15}/>보류</button>
              {itemRow && <button className="ghost" onClick={() => openCourse(itemRow.id)}><MapPin size={15}/>{itemRow.course.name} 수정하기</button>}
              {selectedItem.candidate && (draft.added[selectedItem.candidate.id]
                ? <button className="ghost" onClick={() => removeAdded(selectedItem.candidate!.id)}><RotateCcw size={15}/>다시 넣기 취소</button>
                : <button className="primary" onClick={() => addCandidate(selectedItem)}><Plus size={15}/>지도에 다시 넣기</button>)}
            </div>
            {selectedItem.candidate && !draft.added[selectedItem.candidate.id] && <>
              <p className="hint">{selectedItem.candidate.lat ? '핀 위치가 맞는지 확인하고, 다르면 지도를 눌러 옮긴 뒤 "지도에 다시 넣기"를 누르세요.' : '위치 정보가 없어요. 지도를 눌러 골프장 위치에 핀을 놓은 뒤 "지도에 다시 넣기"를 누르세요.'}</p>
              <AdminLocationMap courseId={selectedItem.key} lat={pendingPoint?.lat ?? selectedItem.candidate.lat} lng={pendingPoint?.lng ?? selectedItem.candidate.lng} kind="pending" onChange={(lat, lng) => setPendingPoint({ lat, lng })}/>
            </>}
          </div>
          : <div className="admin-empty"><MapPin size={28}/><p>왼쪽에서 골프장이나 검수 항목을 고르세요.</p><small>수정한 내용은 "저장"을 눌러야 사이트에 반영돼요. 저장 전까지는 이 브라우저에 임시로 보관돼요.</small></div>}
      </section>
    </div>
  </main>;
}

// 골프장 편집 폼: 원본과 다른 값만 수정 내용으로 남는다.
function CourseEditor({ row, loadedEdit, onChange, onReset, onRemoveAdded }: { row: Row; loadedEdit?: CourseEdit; onChange: (patch: Partial<CourseEdit>) => void; onReset: () => void; onRemoveAdded: () => void }) {
  const { course, original, edit } = row;
  const kind = kindOf(course);
  const errors = edit ? validateEdit(edit) : [];
  const field = (label: string, key: 'name' | 'address' | 'phone' | 'homepage', placeholder = '') => <label className={edit?.[key] !== undefined ? 'changed' : ''}>{label}<input value={course[key] ?? ''} placeholder={placeholder} onChange={(event) => onChange({ [key]: event.target.value })}/>{edit?.[key] !== undefined && <small>원래: {original[key] || '(없음)'}</small>}</label>;
  return <div className="course-editor">
    <div className="editor-head">
      <div><span className="eyebrow">{row.id}{row.added ? ' · 다시 넣은 골프장' : ''}</span><h2>{course.name}</h2></div>
      <div className="editor-tools">
        {course.kakaoPlaceUrl && <a className="ghost" href={course.kakaoPlaceUrl} target="_blank" rel="noopener noreferrer">카카오맵 <ArrowUpRight size={13}/></a>}
        {(edit || loadedEdit) && <button className="ghost" onClick={onReset}><Undo2 size={14}/>되돌리기</button>}
        {row.added ? <button className="danger" onClick={onRemoveAdded}><EyeOff size={14}/>다시 넣기 취소</button>
          : <button className={edit?.exclude ? 'primary' : 'danger'} onClick={() => onChange({ exclude: !edit?.exclude })}>{edit?.exclude ? <><RotateCcw size={14}/>지도에 복구</> : <><EyeOff size={14}/>지도에서 제외</>}</button>}
      </div>
    </div>
    {edit?.exclude && <p className="admin-message info"><EyeOff size={16}/><span>저장하면 이 골프장은 지도에서 빠져요.</span></p>}
    {errors.length > 0 && <p className="admin-message error"><CircleAlert size={16}/><span>{errors.join(' / ')}</span></p>}
    <div className="editor-grid">
      <div className="editor-form">
        {field('골프장 이름', 'name')}
        {field('주소', 'address')}
        <div className="two">
          {field('전화', 'phone', '031-000-0000')}
          <label className={edit?.holes !== undefined ? 'changed' : ''}>홀 수<input inputMode="numeric" value={course.holes ?? ''} placeholder="예) 18" onChange={(event) => { const value = event.target.value.replace(/\D/g, ''); onChange({ holes: value ? Number(value) : null }); }}/></label>
        </div>
        {field('홈페이지', 'homepage', 'https://')}
        <label className={edit?.kind ? 'changed' : ''}>구분<div className="kind-select">{KINDS.map((value) => <button key={value} type="button" className={kind === value ? 'active' : ''} onClick={() => onChange({ kind: value })}>{value}</button>)}</div>{edit?.kind && <small>원래: {kindOf(original)}</small>}</label>
        <label className={edit?.partnerNote !== undefined ? 'changed' : ''}>혜택 문구 (상세 화면에 표시)<textarea rows={3} value={course.partnerNote ?? ''} placeholder="예) PLK 회원 그린피 10% 할인 (주중)" onChange={(event) => onChange({ partnerNote: event.target.value })}/></label>
        <label>운영 메모 (지도에는 안 보임)<textarea rows={2} value={edit?.memo ?? ''} placeholder="확인 내용, 담당자 등" onChange={(event) => onChange({ memo: event.target.value })}/></label>
      </div>
      <div className="editor-location">
        <div className={`location-head${edit?.lat !== undefined ? ' changed' : ''}`}><b>위치</b><span>{course.lat.toFixed(6)}, {course.lng.toFixed(6)}</span>{edit?.lat !== undefined && <button className="link" onClick={() => onChange({ lat: original.lat, lng: original.lng })}>원래 위치로</button>}</div>
        <p className="hint">핀을 끌거나 지도를 눌러 위치를 옮기세요. 오른쪽 위에서 스카이뷰로 바꾸면 코스가 보여요.</p>
        <AdminLocationMap courseId={row.id} lat={course.lat} lng={course.lng} kind={markerKind(course)} onChange={(lat, lng) => onChange({ lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 })}/>
      </div>
    </div>
  </div>;
}
