import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, Eye, EyeOff, ImagePlus, LayoutGrid, LoaderCircle, LogOut, Pencil, Plus, Save, Search, Settings2, ShieldCheck, Trash2, Truck, X } from 'lucide-react'
import type { Vehicle, Settings as SiteSettings } from './types'
import './admin.css'

type AuthState = { setupRequired: boolean; authenticated: boolean; csrfToken?: string }
type MediaCleanup = { deleted: string[]; pending: string[] }
type DiscardResult = { discarded: string[]; pending: string[] }
class ApiError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}
const mayHaveCommitted = (error: unknown) => !(error instanceof ApiError) || error.status === undefined || error.status === 408 || error.status >= 500
const bodyTypes = ['面包', '平板', '厢货', '高栏'] as const
const passwordMeetsRules = (value: string) => [...value].length >= 12 && [...value].length <= 128 && /\p{L}/u.test(value) && /\p{N}/u.test(value)
const emptySettings: SiteSettings = { siteName: '', logoUrl: '', tagline: '', phone: '', wechat: '', address: '' }
const blankVehicle = (): Vehicle => ({ id: '', name: '', brand: '', temperature: '常温', bodyType: '面包', bodyTypes: ['面包'], published: false, availability: '待确认', description: '', highlights: [], specs: [], images: [], sourceFiles: [], battery: '', range: '', cargoVolume: '', payload: '', dimensions: '' })

function useUnsavedChanges(active: boolean) {
  const allowNavigation = useRef(false)
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => { if (!allowNavigation.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
  return () => { allowNavigation.current = true }
}

function readSettings(value: unknown): SiteSettings {
  if (!value || typeof value !== 'object' || !Object.keys(emptySettings).every(key => typeof (value as Record<string, unknown>)[key] === 'string')) throw new Error('网站设置数据不完整，请重新加载后再编辑。')
  return { ...emptySettings, ...value as SiteSettings }
}

const settingsMatch = (left: SiteSettings, right: SiteSettings) => (Object.keys(emptySettings) as (keyof SiteSettings)[]).every(key => left[key].trim() === right[key].trim())
function vehicleMatches(left: Vehicle, right: Vehicle) {
  const comparable = (value: Vehicle) => ({
    id: value.id, name: value.name.trim(), brand: value.brand.trim(), temperature: value.temperature,
    bodyType: value.bodyType, bodyTypes: [...new Set([value.bodyType, ...(value.bodyTypes || [])])],
    published: value.published, availability: value.availability, description: (value.description || '').trim(),
    highlights: (value.highlights || []).map(v => v.trim()), specs: (value.specs || []).map(v => ({ label: v.label.trim(), value: v.value.trim() })),
    images: (value.images || []).map(v => v.trim()), sourceFiles: (value.sourceFiles || []).map(v => v.trim()),
    battery: (value.battery || '').trim(), range: (value.range || '').trim(), cargoVolume: (value.cargoVolume || '').trim(),
    payload: (value.payload || '').trim(), dimensions: (value.dimensions || '').trim(),
  })
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}

async function request<T>(path: string, options: RequestInit = {}, csrfToken = ''): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (csrfToken) headers.set('x-csrf-token', csrfToken)
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' })
  let data
  try { data = await response.json() } catch { if (response.ok) throw new ApiError('服务器响应未能完整读取，请重新连接核实。'); data = {} }
  if (!response.ok) throw new ApiError(data.error || `请求失败（${response.status}），请稍后重试。`, response.status)
  return data as T
}

async function discardUploads(urls: string[], token: string): Promise<DiscardResult> {
  if (!urls.length) return { discarded: [], pending: [] }
  const discard = () => request<DiscardResult>('/api/admin/uploads/discard', { method: 'POST', body: JSON.stringify({ urls }) }, token)
  try { return await discard() }
  catch (error) {
    if (!mayHaveCommitted(error)) throw error
    try { return await discard() }
    catch { throw new Error('重试后仍无法核实图片清理结果，请重新连接后再次执行此操作。') }
  }
}

function ErrorMessage({ message }: { message: string }) {
  return message ? <div className="admin-error" role="alert"><CircleHelp size={17} /><span>{message}</span></div> : null
}

function CleanupNotice({ urls, onDismiss, destination }: { urls: string[]; onDismiss?: () => void; destination?: string }) {
  if (!urls.length) return null
  return <div className="admin-cleanup-notice" role="status"><CircleHelp size={18} /><div><strong>图片文件清理待重试</strong><p>上次操作有 {urls.length} 张图片未完成文件清理。服务器已保留清理任务，会自动重试；无需再次删除或上传。</p>{destination && <a href={destination}>继续返回前台 <ChevronRight size={14} /></a>}</div>{onDismiss && <button type="button" aria-label="关闭文件清理提醒" onClick={onDismiss}><X size={16} /></button>}</div>
}

function AuthScreen({ setup, message, onAuthenticated }: { setup: boolean; message: string; onAuthenticated: () => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (setup && !passwordMeetsRules(password)) { setError('密码需为 12–128 个字符，并至少包含一个字母和一个数字。'); return }
    setBusy(true)
    try {
      await request(`/api/auth/${setup ? 'setup' : 'login'}`, { method: 'POST', body: JSON.stringify({ username: username.trim(), password }) })
      await onAuthenticated()
    } catch (err) { setError((err as Error).message); setPassword('') } finally { setBusy(false) }
  }
  return <div className="admin-auth-page">
    <a className="admin-auth-back" href="/"><ArrowLeft size={17} /> 返回车型展厅</a>
    <section className="admin-auth-card">
      <div className="admin-auth-symbol admin-letter-mark" aria-hidden="true">好</div>
      <h1>{setup ? '创建管理员账号' : '管理员登录'}</h1>
      <p>{setup ? '首次使用请创建账号，用于维护车型和公司信息。' : '请输入账号和密码。'}</p>
      {message && <div className="admin-auth-message" role="status"><ShieldCheck size={18} /><span>{message}</span></div>}
      <form onSubmit={submit} className="admin-auth-form">
        <label>管理员账号<input name="username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required autoFocus minLength={3} maxLength={64} pattern="[A-Za-z0-9_@.\-]{3,64}" title="3–64 位字母、数字或 _ @ . -" placeholder="输入管理员账号" /></label>
        <label>登录密码<input name="password" value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : undefined} maxLength={setup ? 256 : undefined} required placeholder={setup ? '请设置至少 12 位密码' : '输入登录密码'} /></label>
        {setup && <div className="admin-field-hint">12–128 个字符，至少包含一个字母和一个数字；支持长口令和空格。</div>}
        <ErrorMessage message={error} />
        <button className="admin-button admin-primary admin-auth-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="admin-spin" size={18} /> : <ShieldCheck size={18} />}{busy ? '正在验证…' : setup ? '创建账号并进入后台' : '登录管理后台'}{!busy && <ChevronRight size={17} />}</button>
      </form>
      <div className="admin-auth-foot"><ShieldCheck size={15} /> 管理操作仅对已登录管理员开放</div>
    </section>
  </div>
}

function PasswordForm({ disabled, busy, blockedMessage, error, verificationRequired, onSubmit, onVerify, onSettings }: { disabled: boolean; busy: boolean; blockedMessage: string; error: string; verificationRequired: boolean; onSubmit: (currentPassword: string, newPassword: string) => Promise<void>; onVerify: () => Promise<void>; onSettings: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [visible, setVisible] = useState(false)
  const [validationError, setValidationError] = useState('')
  const submittingRef = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled || busy || verificationRequired || submittingRef.current) return
    setValidationError('')
    if (!passwordMeetsRules(newPassword)) { setValidationError('新密码需为 12–128 个字符，并至少包含一个字母和一个数字。'); return }
    if (newPassword === currentPassword) { setValidationError('新密码不能与当前密码相同。'); return }
    if (newPassword !== confirmation) { setValidationError('两次输入的新密码不一致，请重新确认。'); return }
    submittingRef.current = true
    try { await onSubmit(currentPassword, newPassword) }
    finally { setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setVisible(false); submittingRef.current = false }
  }
  return <form className="admin-settings-panel admin-security-panel" onSubmit={submit}>
    <div className="admin-settings-head"><div className="admin-settings-symbol"><ShieldCheck size={22} /></div><div><h2>修改管理员密码</h2><p>修改后，所有设备上的登录都会失效，需要使用新密码重新登录。</p></div></div>
    <div className="admin-settings-fields">
      {blockedMessage && <div className="admin-security-blocked" role="status"><CircleHelp size={18} /><div><p>{blockedMessage}</p><button type="button" className="admin-text-button" onClick={onSettings} disabled={busy || verificationRequired}>前往网站设置 <ChevronRight size={15} /></button></div></div>}
      <ErrorMessage message={validationError || error} />
      {verificationRequired ? <div className="admin-security-verification"><p>上次改密结果尚未确认。请先恢复连接，再退出旧会话并重新登录核实。</p><button type="button" className="admin-button admin-primary" onClick={() => void onVerify()} disabled={busy}>{busy && <LoaderCircle size={17} className="admin-spin" />}重新连接并登录核实</button></div> : <>
        <label>当前密码<input name="currentPassword" type={visible ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} disabled={disabled || busy} required spellCheck={false} autoCapitalize="none" placeholder="输入当前登录密码" /></label>
        <label>新密码<input name="newPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} disabled={disabled || busy} required minLength={12} maxLength={256} spellCheck={false} autoCapitalize="none" aria-describedby="admin-password-rules" placeholder="至少 12 个字符，包含字母和数字" /></label>
        <p id="admin-password-rules" className="admin-field-hint admin-password-rules">12–128 个字符，至少包含一个字母和一个数字；可使用中文、空格和符号。请勿与当前密码相同。</p>
        <label>确认新密码<input name="confirmPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={disabled || busy} required minLength={12} maxLength={256} spellCheck={false} autoCapitalize="none" placeholder="再次输入新密码" /></label>
        <button type="button" className="admin-text-button admin-password-visibility" aria-pressed={visible} onClick={() => setVisible(v => !v)} disabled={disabled || busy}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}{visible ? '隐藏密码' : '显示密码'}</button>
      </>}
    </div>
    {!verificationRequired && <div className="admin-settings-footer"><span className="admin-settings-draft-status">改密后需重新登录</span><button type="submit" className="admin-button admin-primary" disabled={disabled || busy}>{busy ? <LoaderCircle className="admin-spin" size={17} /> : <ShieldCheck size={17} />}{busy ? '正在处理…' : '修改密码并重新登录'}</button></div>}
  </form>
}

function VehicleEditor({ initial, token, onClose, onSaved, onCleanupPending }: { initial: Vehicle; token: string; onClose: () => void; onSaved: (vehicle: Vehicle) => void; onCleanupPending: (urls: string[]) => void }) {
  const [vehicle, setVehicle] = useState<Vehicle>(() => ({ ...initial, bodyTypes: initial.bodyTypes?.length ? [...initial.bodyTypes] : [initial.bodyType], images: [...initial.images], specs: initial.specs.map(s => ({ ...s })), highlights: [...initial.highlights] }))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState('')
  const [cleanupPending, setCleanupPending] = useState<string[]>([])
  const [verificationRequired, setVerificationRequired] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [highlightText, setHighlightText] = useState(initial.highlights.join('\n'))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const replacementFileRef = useRef<HTMLInputElement>(null)
  const replacementIndexRef = useRef<number | null>(null)
  const draftUploadsRef = useRef(new Set<string>())
  const createIdRef = useRef(`vehicle-${crypto.randomUUID()}`)
  const attemptedVehicleRef = useRef<Vehicle | null>(null)
  const operationRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(false)
  closeRef.current = () => { void closeEditor() }
  const busy = saving || uploading || cleaning || verificationRequired
  busyRef.current = busy
  const isNew = !initial.id
  const dirty = JSON.stringify(vehicle) !== JSON.stringify({ ...initial, bodyTypes: initial.bodyTypes?.length ? initial.bodyTypes : [initial.bodyType] }) || highlightText !== initial.highlights.join('\n')
  useUnsavedChanges(dirty || busy || draftUploadsRef.current.size > 0)
  function update<K extends keyof Vehicle>(key: K, value: Vehicle[K]) { setVehicle(v => ({ ...v, [key]: value })) }
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; titleRef.current?.focus()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) closeRef.current()
      if (e.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), a[href]')
      if (!focusable?.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handleKey); prior?.focus() }
  }, [])
  function reportCleanupPending(urls: string[]) {
    if (!urls.length) return
    setCleanupPending(previous => [...new Set([...previous, ...urls])]); onCleanupPending(urls)
  }
  async function discardDrafts(urls: string[]) {
    const drafts = urls.filter(url => draftUploadsRef.current.has(url))
    const result = await discardUploads(drafts, token)
    drafts.forEach(url => draftUploadsRef.current.delete(url))
    reportCleanupPending(result.pending)
  }
  async function closeEditor(discard = false) {
    if (operationRef.current || verificationRequired) return
    if (dirty && !discard) { setConfirmClose(true); return }
    setConfirmClose(false)
    operationRef.current = true; setCleaning(true); setError('')
    try { await discardDrafts([...draftUploadsRef.current]); onClose() }
    catch (err) { setError(`临时图片未能清理，编辑窗口已保留。请重试取消。${(err as Error).message}`) }
    finally { operationRef.current = false; setCleaning(false) }
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (operationRef.current || verificationRequired) return
    setError(''); setConfirmClose(false)
    if (!vehicle.bodyTypes?.length) { setError('请至少选择一种车身类型。'); return }
    if (vehicle.specs.some(s => !s.label.trim() || !s.value.trim())) { setError('请补全参数名称和参数值，或删除空白参数行。'); return }
    operationRef.current = true; setSaving(true)
    attemptedVehicleRef.current = null
    try {
      await discardDrafts([...draftUploadsRef.current].filter(url => !vehicle.images.includes(url)))
      const data: Vehicle = { ...vehicle, id: initial.id || createIdRef.current, name: vehicle.name.trim(), brand: vehicle.brand.trim(), bodyType: vehicle.bodyTypes[0] as Vehicle['bodyType'], highlights: highlightText.split('\n').map(s => s.trim()).filter(Boolean), specs: vehicle.specs.map(s => ({ label: s.label.trim(), value: s.value.trim() })) }
      attemptedVehicleRef.current = data
      const result = await request<{ vehicle: Vehicle; mediaCleanup?: MediaCleanup }>(isNew ? '/api/admin/vehicles' : `/api/admin/vehicles/${encodeURIComponent(initial.id)}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(data) }, token)
      draftUploadsRef.current.clear()
      if (result.mediaCleanup?.pending.length) reportCleanupPending(result.mediaCleanup.pending)
      onSaved(result.vehicle)
    } catch (err) {
      if (attemptedVehicleRef.current && (mayHaveCommitted(err) || (isNew && err instanceof ApiError && err.status === 409))) await verifyVehicleAttempt()
      else setError(`未能完成保存，当前编辑内容已保留。${(err as Error).message}`)
    } finally { operationRef.current = false; setSaving(false) }
  }
  async function verifyVehicleAttempt() {
    const attempt = attemptedVehicleRef.current
    if (!attempt) return
    try {
      const data = await request<{ vehicles: Vehicle[] }>('/api/admin/vehicles')
      const current = data.vehicles.find(v => v.id === attempt.id)
      setVerificationRequired(false)
      if (current && vehicleMatches(current, attempt)) { draftUploadsRef.current.clear(); onSaved(current) }
      else setError('已核实：服务器未保存本次修改。编辑内容已保留，可重试保存或取消。')
    } catch { setVerificationRequired(true); setError('连接中断，暂时无法核实车型是否已保存。请重新连接并核实结果；核实前暂停保存和清理图片。') }
  }
  async function retryVehicleVerification() {
    if (operationRef.current) return
    operationRef.current = true; setSaving(true)
    try { await verifyVehicleAttempt() } finally { operationRef.current = false; setSaving(false) }
  }
  async function upload(files: FileList | null, replaceIndex: number | null = null) {
    if (!files?.length || operationRef.current || verificationRequired) return
    if (replaceIndex === null && vehicle.images.length + files.length > 30) {
      setError(`每款车型最多保留 30 张图片，还可添加 ${Math.max(0, 30 - vehicle.images.length)} 张。`)
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    operationRef.current = true; setUploading(true); setError('')
    try {
      const selectedFiles = replaceIndex === null ? Array.from(files) : [files[0]]
      for (const [index, file] of selectedFiles.entries()) {
        setUploadProgress(`${index + 1} / ${selectedFiles.length}`)
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name} 格式不支持，请选择 JPG、PNG 或 WebP。`)
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8 MB，请压缩后上传。`)
        const form = new FormData(); form.append('file', file)
        const { url } = await request<{ url: string }>('/api/admin/uploads', { method: 'POST', body: form }, token)
        draftUploadsRef.current.add(url)
        if (replaceIndex === null) setVehicle(v => ({ ...v, images: [...v.images, url] }))
        else {
          const oldUrl = vehicle.images[replaceIndex]
          await discardDrafts(oldUrl ? [oldUrl] : [])
          setVehicle(v => ({ ...v, images: v.images.map((image, index) => index === replaceIndex ? url : image) }))
        }
      }
    } catch (err) { setError(`图片处理未完成，已保留当前编辑内容。请重试，或取消编辑以清理临时图片。${(err as Error).message}`) }
    finally { operationRef.current = false; setUploading(false); setUploadProgress(''); if (fileRef.current) fileRef.current.value = ''; if (replacementFileRef.current) replacementFileRef.current.value = ''; replacementIndexRef.current = null }
  }
  async function removeImage(index: number) {
    if (operationRef.current || verificationRequired) return
    const url = vehicle.images[index]
    if (!draftUploadsRef.current.has(url)) { update('images', vehicle.images.filter((_, i) => i !== index)); return }
    operationRef.current = true; setCleaning(true); setError('')
    try { await discardDrafts([url]); setVehicle(v => ({ ...v, images: v.images.filter((_, i) => i !== index) })) }
    catch (err) { setError(`临时图片未能删除，图片已保留。请重试。${(err as Error).message}`) }
    finally { operationRef.current = false; setCleaning(false) }
  }
  function replaceImage(index: number) {
    if (operationRef.current || verificationRequired) return
    replacementIndexRef.current = index; replacementFileRef.current?.click()
  }
  function moveImage(index: number, offset: number) {
    if (operationRef.current || verificationRequired) return
    const images = [...vehicle.images]; [images[index], images[index + offset]] = [images[index + offset], images[index]]; update('images', images)
  }
  return <div className="admin-modal-backdrop">
    <div className="admin-editor" role="dialog" aria-modal="true" aria-labelledby="admin-editor-title" ref={panelRef}>
      <div className="admin-editor-head"><h2 id="admin-editor-title" tabIndex={-1} ref={titleRef}>{isNew ? '新增车型' : '编辑车型'}</h2><button type="button" className="admin-icon-button" onClick={() => void closeEditor()} disabled={busy} aria-label="关闭车型编辑"><X size={21} /></button></div>
      {confirmClose && <div className="admin-discard-prompt" role="alert"><div><strong>还有未保存的修改</strong><p>继续编辑可保留内容；放弃修改会清理本次未保存的上传图片。</p></div><button type="button" className="admin-button admin-small" onClick={() => setConfirmClose(false)} autoFocus>继续编辑</button><button type="button" className="admin-button admin-small admin-danger-text" onClick={() => void closeEditor(true)}>放弃修改</button></div>}
      {error && <div className="admin-editor-alert"><ErrorMessage message={error} /></div>}
      {!!cleanupPending.length && <div className="admin-editor-alert"><CleanupNotice urls={cleanupPending} onDismiss={() => setCleanupPending([])} /></div>}
      <form id="admin-vehicle-form" onSubmit={save} className="admin-editor-body">
        <fieldset className="admin-edit-fields" disabled={saving || cleaning || verificationRequired}>
        <section className="admin-form-section"><h3><ClipboardList size={18} /> 基本信息</h3>
          <div className="admin-form-grid">
            <label className="admin-span-2">车型名称 <span>*</span><input value={vehicle.name} required maxLength={120} onChange={e => update('name', e.target.value)} placeholder="例如：吉利远程星享 V6E" /></label>
            <label>品牌 <span>*</span><input value={vehicle.brand} required maxLength={60} onChange={e => update('brand', e.target.value)} placeholder="例如：吉利远程" /></label>
            <label>温控类型<select value={vehicle.temperature} onChange={e => update('temperature', e.target.value as Vehicle['temperature'])}><option>常温</option><option>冷藏</option></select></label>
            <fieldset className="admin-span-2 admin-check-field"><legend>车身类型 <span>*</span></legend><div className="admin-check-options">{bodyTypes.map(type => <label key={type}><input type="checkbox" checked={vehicle.bodyTypes?.includes(type)} onChange={e => update('bodyTypes', e.target.checked ? [...(vehicle.bodyTypes || []), type] : vehicle.bodyTypes?.filter(t => t !== type))} />{type}</label>)}</div><div className="admin-field-hint">支持多选；前台筛选将匹配所选类型。</div></fieldset>
            <label className="admin-span-2">车型介绍<textarea value={vehicle.description} onChange={e => update('description', e.target.value)} rows={3} maxLength={4000} placeholder="介绍车型的用途和特点" /></label>
            <label className="admin-span-2">车型亮点<textarea value={highlightText} onChange={e => setHighlightText(e.target.value)} rows={3} placeholder={'每行填写一项亮点\n例如：适合城市配送'} /><span className="admin-field-hint">每行一项，前台车型详情中展示。</span></label>
          </div>
        </section>
        <section className="admin-form-section"><h3><Eye size={18} /> 展示与现车状态</h3>
          <div className="admin-publish-control"><div><strong>在前台展示此车型</strong><p>上架后可在车型展厅被搜索和筛选。</p></div><label className="admin-switch"><input type="checkbox" checked={vehicle.published} onChange={e => update('published', e.target.checked)} aria-label="在前台展示此车型" /><span /></label></div>
          <label>现车情况<select value={vehicle.availability} onChange={e => update('availability', e.target.value as Vehicle['availability'])}><option>待确认</option><option>有现车</option><option>需预订</option></select></label>
          <div className="admin-info-note"><CircleHelp size={16} /> 上架只表示公司提供该车型，不代表有现车。请按实际情况维护现车状态。</div>
        </section>
        <section className="admin-form-section"><h3><Truck size={18} /> 车辆参数</h3>
          <div className="admin-form-grid">
            <label>货厢容积<input value={vehicle.cargoVolume || ''} onChange={e => update('cargoVolume', e.target.value)} placeholder="例如：6 m³" /></label>
            <label>电池容量<input value={vehicle.battery || ''} onChange={e => update('battery', e.target.value)} placeholder="例如：41.86 kWh" /></label>
            <label>续航里程<input value={vehicle.range || ''} onChange={e => update('range', e.target.value)} placeholder="例如：260 km（注明工况）" /></label>
            <label>额定载重<input value={vehicle.payload || ''} onChange={e => update('payload', e.target.value)} placeholder="例如：1,200 kg" /></label>
            <label className="admin-span-2">车辆尺寸<input value={vehicle.dimensions || ''} onChange={e => update('dimensions', e.target.value)} placeholder="长 × 宽 × 高，注明单位" /></label>
          </div>
          <div className="admin-extra-specs"><div className="admin-section-caption">详细参数</div>{vehicle.specs.map((spec, i) => <div key={i} className="admin-spec-row"><input aria-label={`参数 ${i + 1} 名称`} value={spec.label} placeholder="参数名称" onChange={e => update('specs', vehicle.specs.map((s, j) => j === i ? { ...s, label: e.target.value } : s))} /><input aria-label={`参数 ${i + 1} 值`} value={spec.value} placeholder="参数值" onChange={e => update('specs', vehicle.specs.map((s, j) => j === i ? { ...s, value: e.target.value } : s))} /><button className="admin-icon-button admin-danger-text" type="button" aria-label={`删除参数 ${i + 1}`} onClick={() => update('specs', vehicle.specs.filter((_, j) => j !== i))}><Trash2 size={16} /></button></div>)}<button className="admin-button admin-soft admin-small" type="button" onClick={() => update('specs', [...vehicle.specs, { label: '', value: '' }])}><Plus size={15} /> 添加参数</button></div>
        </section>
        <section className="admin-form-section"><div className="admin-section-head"><h3><ImagePlus size={18} /> 车型图片</h3><span>{vehicle.images.length} 张</span></div><p className="admin-field-hint">第一张为封面。更换或移除已保存图片后，请保存车型；未被其他车型使用的旧图会进行永久清理。新上传且未保存的图片会在取消或移除时清理，暂时失败的文件由系统自动重试。</p>
          <div className="admin-image-list">{vehicle.images.map((url, i) => <div className="admin-image-item" key={`${url}-${i}`}><div className="admin-image-thumb"><img src={url} alt={`车型图片 ${i + 1}`} />{i === 0 && <span>封面</span>}</div><div className="admin-image-meta"><strong>图片 {String(i + 1).padStart(2, '0')}</strong><small>{url.split('/').pop()}</small></div><div className="admin-image-actions"><button type="button" className="admin-image-replace" onClick={() => replaceImage(i)} disabled={busy} aria-label={`更换图片 ${i + 1}`}><ImagePlus size={15} /> 更换</button><button type="button" className="admin-icon-button" disabled={busy || i === 0} onClick={() => moveImage(i, -1)} aria-label={`图片 ${i + 1} 上移`}><ArrowUp size={16} /></button><button type="button" className="admin-icon-button" disabled={busy || i === vehicle.images.length - 1} onClick={() => moveImage(i, 1)} aria-label={`图片 ${i + 1} 下移`}><ArrowDown size={16} /></button><button type="button" className="admin-icon-button admin-danger-text" disabled={busy} onClick={() => void removeImage(i)} aria-label={`移除图片 ${i + 1}`}><Trash2 size={16} /></button></div></div>)}</div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => void upload(e.target.files)} className="admin-file-input" tabIndex={-1} disabled={busy} aria-label="选择车型图片" />
          <input ref={replacementFileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => void upload(e.target.files, replacementIndexRef.current)} className="admin-file-input" tabIndex={-1} disabled={busy} aria-label="选择替换图片" />
          <button className="admin-upload-button" type="button" onClick={() => { if (!operationRef.current) fileRef.current?.click() }} disabled={busy || vehicle.images.length >= 30}>{uploading ? <LoaderCircle className="admin-spin" size={23} /> : <ImagePlus size={23} />}<strong aria-live="polite">{uploading ? `正在上传图片 ${uploadProgress}` : vehicle.images.length >= 30 ? '已达到 30 张图片上限' : '点击上传车型图片'}</strong><small>支持 JPG、PNG、WebP，单张不超过 8 MB，最多 30 张</small></button>
        </section>
        {vehicle.sourceFiles.length > 0 && <div className="admin-source-note"><strong>资料来源</strong><span>{vehicle.sourceFiles.join('、')}</span></div>}
        </fieldset>
      </form>
      <div className="admin-editor-footer"><span>{verificationRequired ? '请先核实保存结果' : cleaning ? '正在清理临时图片…' : vehicle.published ? '保存后将在前台展示' : '保存为下架状态'}</span><button type="button" className="admin-button" onClick={() => void closeEditor()} disabled={busy}>取消</button>{verificationRequired ? <button type="button" className="admin-button admin-primary" onClick={() => void retryVehicleVerification()} disabled={saving}>{saving && <LoaderCircle className="admin-spin" size={17} />}重新核实保存</button> : <button form="admin-vehicle-form" type="submit" className="admin-button admin-primary" disabled={busy}>{saving ? <LoaderCircle className="admin-spin" size={17} /> : <Save size={17} />}{saving ? '正在保存…' : '保存车型'}</button>}</div>
    </div>
  </div>
}

function DeleteVehicleDialog({ vehicle, token, onClose, onDeleted, onCleanupPending }: { vehicle: Vehicle; token: string; onClose: () => void; onDeleted: (id: string) => void; onCleanupPending: (urls: string[]) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pendingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const dialog = dialogRef.current!
    const previousOverflow = document.body.style.overflow
    dialog.showModal(); document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = previousOverflow }
  }, [])
  async function remove(event: FormEvent) {
    event.preventDefault()
    if (pendingRef.current) return
    pendingRef.current = true; setBusy(true); setError('')
    try {
      const result = await request<{ deleted: boolean; id: string; mediaCleanup: MediaCleanup }>(`/api/admin/vehicles/${encodeURIComponent(vehicle.id)}`, { method: 'DELETE' }, token)
      if (result.mediaCleanup?.pending.length) onCleanupPending(result.mediaCleanup.pending)
      onDeleted(vehicle.id)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) onDeleted(vehicle.id)
      else if (mayHaveCommitted(err)) {
        try {
          const data = await request<{ vehicles: Vehicle[] }>('/api/admin/vehicles')
          if (!data.vehicles.some(v => v.id === vehicle.id)) onDeleted(vehicle.id)
          else setError('已核实：车型仍存在，删除尚未完成，请重试。')
        } catch { setError('连接中断，暂时无法核实删除结果。请重新连接后重试；已删除的车型不会重复删除。') }
      } else setError(`未能完成删除，请重试。${(err as Error).message}`)
    }
    finally { pendingRef.current = false; setBusy(false) }
  }
  return <dialog ref={dialogRef} className="admin-delete-dialog" aria-labelledby="admin-delete-title" onCancel={e => { e.preventDefault(); if (!pendingRef.current) onClose() }} onClick={e => { if (e.target === e.currentTarget && !pendingRef.current) onClose() }}>
    <form onSubmit={remove} className="admin-delete-content">
      <div className="admin-delete-symbol"><Trash2 size={24} /></div>
      <h2 id="admin-delete-title">删除车型</h2>
      <p>确定删除 <strong>「{vehicle.name}」</strong> 吗？</p>
      <p>车型记录及没有被其他车型或公司图标使用的关联图片将永久删除，无法恢复。</p>
      <ErrorMessage message={error} />
      <div className="admin-delete-actions"><button type="button" className="admin-button" onClick={onClose} disabled={busy} autoFocus>取消</button><button type="submit" className="admin-button admin-delete-button" disabled={busy}>{busy ? <LoaderCircle className="admin-spin" size={16} /> : <Trash2 size={16} />}{busy ? '正在删除…' : '确认删除'}</button></div>
    </form>
  </dialog>
}

export default function Admin() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [authMessage, setAuthMessage] = useState('')
  const [initialError, setInitialError] = useState('')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [settings, setSettings] = useState<SiteSettings>(emptySettings)
  const [savedSettings, setSavedSettings] = useState<SiteSettings | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [vehicleLoadError, setVehicleLoadError] = useState('')
  const [tab, setTab] = useState<'vehicles' | 'settings' | 'security'>('vehicles')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingCleanupUrls, setPendingCleanupUrls] = useState<string[]>([])
  const [pendingNavigation, setPendingNavigation] = useState('')
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [deleting, setDeleting] = useState<Vehicle | null>(null)
  const [busyId, setBusyId] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaveUnverified, setSettingsSaveUnverified] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [cleaningLogo, setCleaningLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
  const [logoChanged, setLogoChanged] = useState(false)
  const logoFileRef = useRef<HTMLInputElement>(null)
  const logoDraftUploadsRef = useRef(new Set<string>())
  const settingsOperationRef = useRef(false)
  const attemptedSettingsRef = useRef<SiteSettings | null>(null)
  const loadingRef = useRef(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordVerificationRequired, setPasswordVerificationRequired] = useState(false)
  const token = auth?.csrfToken || ''
  const settingsDirty = savedSettings !== null && JSON.stringify(settings) !== JSON.stringify(savedSettings)
  const hasLogoDrafts = logoDraftUploadsRef.current.size > 0
  const securityLocked = changingPassword || passwordVerificationRequired
  const settingsDisabled = !settingsLoaded || loading || savingSettings || loggingOut || cleaningLogo || settingsSaveUnverified || securityLocked
  const logoDisabled = settingsDisabled || uploadingLogo
  const canReload = !loading && !savingSettings && !uploadingLogo && !cleaningLogo && !busyId && !editing && !deleting && !settingsDirty && !hasLogoDrafts && !loggingOut && !settingsSaveUnverified && !securityLocked
  const allowSavedNavigation = useUnsavedChanges(settingsDirty || hasLogoDrafts || savingSettings || uploadingLogo || settingsSaveUnverified || securityLocked)
  function reportCleanupPending(urls: string[]) {
    if (urls.length) setPendingCleanupUrls(previous => [...new Set([...previous, ...urls])])
  }
  function dismissCleanupNotice() { setPendingCleanupUrls([]); setPendingNavigation('') }
  async function refreshAuth() { setInitialError(''); try { const next = await request<AuthState>('/api/auth/status'); setAuth(next); if (next.authenticated) setAuthMessage('') } catch (err) { setInitialError((err as Error).message) } }
  useEffect(() => { void refreshAuth() }, [])
  async function loadContent() {
    if (loadingRef.current || settingsOperationRef.current || !canReload) return
    loadingRef.current = true
    setLoading(true); setError('')
    const results = await Promise.allSettled([
      request<{ vehicles: Vehicle[] }>('/api/admin/vehicles'),
      request<{ settings: SiteSettings }>('/api/admin/settings'),
    ])
    const [vehicleResult, settingsResult] = results
    if (vehicleResult.status === 'fulfilled') {
      setVehicles(vehicleResult.value.vehicles); setVehicleLoadError('')
    } else { setVehicleLoadError(`车型读取失败：${(vehicleResult.reason as Error).message}`) }
    if (settingsResult.status === 'fulfilled') {
      try {
        const next = readSettings(settingsResult.value.settings)
        setSettings(next); setSavedSettings(next); setSettingsLoaded(true); setSettingsError(''); setLogoChanged(false); setLogoError('')
      } catch (err) { setSettingsLoaded(false); setSettingsError((err as Error).message) }
    } else { setSettingsLoaded(false); setSettingsError(`网站设置读取失败：${(settingsResult.reason as Error).message}`) }
    loadingRef.current = false
    setLoading(false)
  }
  useEffect(() => { if (auth?.authenticated) void loadContent() }, [auth?.authenticated])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4500); return () => window.clearTimeout(timer) }, [notice])
  async function toggle(vehicle: Vehicle) {
    if (loadingRef.current || busyId || securityLocked) return
    setBusyId(vehicle.id); setError('')
    try { const data = await request<{ vehicle: Vehicle; mediaCleanup?: MediaCleanup }>(`/api/admin/vehicles/${encodeURIComponent(vehicle.id)}`, { method: 'PATCH', body: JSON.stringify({ published: !vehicle.published }) }, token); setVehicles(vs => vs.map(v => v.id === vehicle.id ? data.vehicle : v)); if (data.mediaCleanup?.pending.length) reportCleanupPending(data.mediaCleanup.pending); setNotice(`「${vehicle.name}」已${data.vehicle.published ? '上架' : '下架'}`) }
    catch (err) { setError((err as Error).message) } finally { setBusyId('') }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!settingsLoaded || !settingsDirty || settingsSaveUnverified || settingsOperationRef.current || loadingRef.current || loggingOut || securityLocked) return
    settingsOperationRef.current = true; setSavingSettings(true); setError('')
    attemptedSettingsRef.current = null
    try {
      await discardLogoDrafts([...logoDraftUploadsRef.current].filter(url => url !== settings.logoUrl))
      attemptedSettingsRef.current = { ...settings }
      const data = await request<{ settings: SiteSettings; mediaCleanup?: MediaCleanup }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }, token)
      const next = readSettings(data.settings)
      if (data.mediaCleanup?.pending.length) reportCleanupPending(data.mediaCleanup.pending)
      logoDraftUploadsRef.current.clear(); setSettings(next); setSavedSettings(next); setLogoChanged(false); setLogoError(''); setNotice('网站信息已保存。')
    } catch (err) {
      if (attemptedSettingsRef.current && mayHaveCommitted(err)) await verifySettingsAttempt()
      else setError(`未能完成保存，当前修改已保留。${(err as Error).message}`)
    }
    finally { settingsOperationRef.current = false; setSavingSettings(false) }
  }
  async function verifySettingsAttempt() {
    const attempt = attemptedSettingsRef.current
    if (!attempt) return
    try {
      const data = await request<{ settings: SiteSettings }>('/api/admin/settings')
      const current = readSettings(data.settings)
      setSavedSettings(current); setSettingsSaveUnverified(false)
      if (current.logoUrl) logoDraftUploadsRef.current.delete(current.logoUrl)
      if (settingsMatch(current, attempt)) {
        logoDraftUploadsRef.current.clear(); setSettings(current); setLogoChanged(false); setLogoError(''); setError(''); setNotice('已核实：网站信息已保存。')
      } else {
        setLogoChanged(settings.logoUrl !== current.logoUrl)
        setError('已核实：服务器未保存本次修改。当前修改已保留，撤销将恢复服务器最新设置。')
      }
    } catch { setSettingsSaveUnverified(true); setError('连接中断，暂时无法核实网站设置是否已保存。请重新连接并核实结果；核实前暂停修改、撤销和图片清理。') }
  }
  async function retrySettingsVerification() {
    if (settingsOperationRef.current) return
    settingsOperationRef.current = true; setSavingSettings(true)
    try { await verifySettingsAttempt() } finally { settingsOperationRef.current = false; setSavingSettings(false) }
  }
  async function discardLogoDrafts(urls: string[]) {
    const drafts = urls.filter(url => logoDraftUploadsRef.current.has(url))
    const result = await discardUploads(drafts, token)
    drafts.forEach(url => logoDraftUploadsRef.current.delete(url))
    reportCleanupPending(result.pending)
    return result.pending
  }
  async function discardSettings() {
    if (!savedSettings || settingsDisabled || settingsOperationRef.current || loadingRef.current) return
    settingsOperationRef.current = true; setCleaningLogo(true); setLogoError('')
    try { await discardLogoDrafts([...logoDraftUploadsRef.current]); setSettings({ ...savedSettings }); setLogoChanged(false); setError('') }
    catch (err) { setLogoError(`临时图片清理失败，修改内容已保留。请重试撤销。${(err as Error).message}`) }
    finally { settingsOperationRef.current = false; setCleaningLogo(false) }
  }
  function updateSetting<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    if (settingsDisabled || loadingRef.current) return
    setSettings(s => ({ ...s, [key]: value }))
  }
  async function removeLogo() {
    if (logoDisabled || settingsOperationRef.current || loadingRef.current) return
    settingsOperationRef.current = true; setCleaningLogo(true); setLogoError('')
    try { await discardLogoDrafts([settings.logoUrl]); setSettings(s => ({ ...s, logoUrl: '' })); setLogoChanged(true) }
    catch (err) { setLogoError(`临时图标清理失败，当前图标已保留。${(err as Error).message}`) }
    finally { settingsOperationRef.current = false; setCleaningLogo(false) }
  }
  async function uploadLogo(file: File | undefined) {
    if (!file || logoDisabled || settingsOperationRef.current || loadingRef.current) return
    setLogoError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setLogoError('请选择 JPG、PNG 或 WebP 格式的图片。')
      if (logoFileRef.current) logoFileRef.current.value = ''
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setLogoError('图片不能超过 8 MB，请压缩后重新上传。')
      if (logoFileRef.current) logoFileRef.current.value = ''
      return
    }
    settingsOperationRef.current = true; setUploadingLogo(true)
    try {
      const form = new FormData(); form.append('file', file)
      const { url } = await request<{ url: string }>('/api/admin/uploads', { method: 'POST', body: form }, token)
      logoDraftUploadsRef.current.add(url)
      await discardLogoDrafts(settings.logoUrl ? [settings.logoUrl] : [])
      setSettings(s => ({ ...s, logoUrl: url })); setLogoChanged(true)
    } catch (err) { setLogoError(`图标处理未完成，原有设置已保留。请重试或撤销修改。${(err as Error).message}`) }
    finally { settingsOperationRef.current = false; setUploadingLogo(false); if (logoFileRef.current) logoFileRef.current.value = '' }
  }
  function showLogin(message = '') {
    logoDraftUploadsRef.current.clear(); attemptedSettingsRef.current = null
    setVehicles([]); setEditing(null); setDeleting(null); setSettings(emptySettings); setSavedSettings(null)
    setSettingsLoaded(false); setSettingsError(''); setVehicleLoadError(''); setLogoChanged(false); setLogoError('')
    setSettingsSaveUnverified(false); setPasswordVerificationRequired(false); setPasswordError('')
    setQuery(''); setFilter('all'); setTab('vehicles'); setBusyId(''); setError(''); setNotice(''); setPendingNavigation('')
    setAuthMessage(message); setAuth({ setupRequired: false, authenticated: false })
  }
  async function resolvePasswordResult() {
    const message = '上次密码修改的结果未能确认。请先使用新密码登录；若不成功，再尝试原密码。'
    try {
      const current = await request<AuthState>('/api/auth/status')
      if (current.authenticated) await request('/api/auth/logout', { method: 'POST' }, current.csrfToken || token)
      showLogin(message)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) showLogin(message)
      else { setPasswordVerificationRequired(true); setPasswordError('连接中断，暂时无法确认改密结果或退出旧会话。请恢复连接后重新核实，不要重复提交密码修改。') }
    }
  }
  async function retryPasswordVerification() {
    if (settingsOperationRef.current) return
    settingsOperationRef.current = true; setChangingPassword(true)
    try { await resolvePasswordResult() }
    finally { settingsOperationRef.current = false; setChangingPassword(false) }
  }
  async function changePassword(currentPassword: string, newPassword: string) {
    if (settingsOperationRef.current || loadingRef.current || securityLocked || loggingOut || busyId || editing || deleting || settingsSaveUnverified) return
    if (settingsDirty) { setPasswordError('网站设置还有未保存的修改，请先保存或撤销后再修改密码。'); return }
    settingsOperationRef.current = true; setChangingPassword(true); setPasswordError('')
    let submitted = false
    try {
      await discardLogoDrafts([...logoDraftUploadsRef.current])
      submitted = true
      const result = await request<{ changed: boolean; requiresLogin: boolean }>('/api/admin/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }, token)
      if (!result.changed || !result.requiresLogin) throw new ApiError('服务器响应未能完整读取。')
      showLogin('密码已修改，所有设备上的登录均已失效。请使用新密码重新登录。')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) showLogin('登录状态已失效。若刚提交过密码修改，请先使用新密码登录；若不成功，再尝试原密码。')
      else if (submitted && mayHaveCommitted(err)) { setPasswordVerificationRequired(true); await resolvePasswordResult() }
      else if (!submitted) setPasswordError('未保存的临时图片尚未完成清理，本次未提交密码修改。请恢复连接后重试，或前往网站设置撤销修改。')
      else setPasswordError((err as Error).message)
    } finally { settingsOperationRef.current = false; setChangingPassword(false) }
  }
  async function logout() {
    if (loadingRef.current || settingsOperationRef.current || loggingOut || editing || deleting || settingsSaveUnverified || securityLocked) return
    if (settingsDirty) { setTab('settings'); setError('网站设置还有未保存的修改，请先保存或撤销，再退出登录。'); return }
    settingsOperationRef.current = true; setLoggingOut(true); setError('')
    try {
      await discardLogoDrafts([...logoDraftUploadsRef.current])
      if (savedSettings) { setSettings({ ...savedSettings }); setLogoChanged(false) }
      await request('/api/auth/logout', { method: 'POST' }, token)
      showLogin()
    } catch (err) { setError(`未能完成退出，当前页面已保留。${(err as Error).message}`) }
    finally { settingsOperationRef.current = false; setLoggingOut(false) }
  }
  async function leaveAdmin(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (securityLocked) { event.preventDefault(); setPasswordError('密码修改尚未完成核实，请先完成当前操作再返回前台。'); return }
    if (settingsSaveUnverified) { event.preventDefault(); setError('请先重新连接并核实上次保存结果，再返回前台。'); return }
    if (settingsDirty) { event.preventDefault(); setTab('settings'); setError('网站设置还有未保存的修改，请先保存或撤销，再返回前台。'); return }
    if (!settingsOperationRef.current && !logoDraftUploadsRef.current.size) return
    event.preventDefault()
    if (settingsOperationRef.current) { setError('图片或设置正在处理，请完成后再返回前台。'); return }
    const destination = event.currentTarget.href
    settingsOperationRef.current = true; setCleaningLogo(true); setError('')
    try {
      const pending = await discardLogoDrafts([...logoDraftUploadsRef.current])
      if (savedSettings) { setSettings({ ...savedSettings }); setLogoChanged(false) }
      if (pending.length) { setPendingNavigation(destination); return }
      allowSavedNavigation()
      location.assign(destination)
    } catch (err) { setError(`临时图片未能清理，当前页面已保留。请重试返回前台。${(err as Error).message}`) }
    finally { settingsOperationRef.current = false; setCleaningLogo(false) }
  }
  if (!auth) return <div className="admin-loading-page">{initialError ? <><ErrorMessage message={initialError} /><button className="admin-button" onClick={() => void refreshAuth()}>重新连接</button><a href="/">返回车型展厅</a></> : <><LoaderCircle className="admin-spin" size={28} /><p>正在加载管理后台…</p></>}</div>
  if (!auth.authenticated) return <>{!!pendingCleanupUrls.length && <div className="admin-auth-cleanup"><CleanupNotice urls={pendingCleanupUrls} onDismiss={dismissCleanupNotice} /></div>}<AuthScreen setup={auth.setupRequired} message={authMessage} onAuthenticated={refreshAuth} /></>
  const published = vehicles.filter(v => v.published).length
  const visible = vehicles.filter(v => (!query || `${v.name} ${v.brand}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && (filter === 'all' || (filter === 'published' ? v.published : !v.published)))
  const pageTitle = tab === 'vehicles' ? '车型管理' : tab === 'settings' ? '网站设置' : '账号安全'
  return <div className="admin-app">
    <aside className="admin-sidebar">
      <a className="admin-brand" href="/" onClick={e => void leaveAdmin(e)}><span className={`admin-brand-logo${settings.logoUrl ? ' admin-brand-logo-image' : ''}`}>{settings.logoUrl ? <img src={settings.logoUrl} alt="公司图标" /> : '好'}</span><div><strong>{settings.siteName || '车型展厅'}</strong><small>管理后台</small></div></a>
      <div className="admin-nav-label">工作空间</div>
      <nav aria-label="后台导航"><button className={tab === 'vehicles' ? 'admin-nav-item admin-active' : 'admin-nav-item'} disabled={securityLocked} onClick={() => { setTab('vehicles'); setError('') }}><LayoutGrid size={19} /> 车型管理 <span>{vehicles.length}</span></button><button className={tab === 'settings' ? 'admin-nav-item admin-active' : 'admin-nav-item'} disabled={securityLocked} onClick={() => { setTab('settings'); setError('') }}><Settings2 size={19} /> 网站设置</button><button className={tab === 'security' ? 'admin-nav-item admin-active' : 'admin-nav-item'} disabled={securityLocked} onClick={() => { setTab('security'); setError(''); setPasswordError('') }}><ShieldCheck size={19} /> 账号安全</button></nav>
      <div className="admin-sidebar-bottom"><a href="/" className="admin-nav-item" aria-label="返回前台展厅" onClick={e => void leaveAdmin(e)}><ArrowLeft size={18} /> 返回前台</a><button className="admin-nav-item" onClick={() => void logout()} disabled={loggingOut || loading || uploadingLogo || savingSettings || cleaningLogo || settingsSaveUnverified || securityLocked}>{loggingOut ? <LoaderCircle className="admin-spin" size={18} /> : <LogOut size={18} />} 退出登录</button><div className="admin-account"><span><ShieldCheck size={20} /></span><div><strong>管理员</strong><small>已安全登录</small></div><span className="admin-online-dot" /></div></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar"><div><span>管理后台</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div><a href="/" target="_blank" rel="noreferrer"><Eye size={16} /> 预览网站</a></header>
      <div className="admin-content">
        <div className="admin-page-heading"><div><h1>{pageTitle}</h1><p>{tab === 'vehicles' ? '新增、编辑和上下架车型，现车状态单独维护。' : tab === 'settings' ? '设置公司名称、图标和联系方式。' : '管理登录密码，保护车型和公司资料。'}</p></div>{tab === 'vehicles' && <button className="admin-button admin-primary" onClick={() => { if (!loadingRef.current && !securityLocked) setEditing(blankVehicle()) }} disabled={loading || securityLocked}><Plus size={18} /> 新增车型</button>}</div>
        <ErrorMessage message={error} />
        {settingsSaveUnverified && <div className="admin-verification-controls"><button className="admin-button admin-small" type="button" onClick={() => void retrySettingsVerification()} disabled={savingSettings}>{savingSettings && <LoaderCircle className="admin-spin" size={16} />}重新核实保存结果</button></div>}
        <ErrorMessage message={vehicleLoadError} />
        <ErrorMessage message={settingsError} />
        <CleanupNotice urls={pendingCleanupUrls} onDismiss={dismissCleanupNotice} destination={pendingNavigation || undefined} />
        {notice && <div className="admin-toast" role="status"><CheckCircle2 size={19} />{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={15} /></button></div>}
        {tab === 'vehicles' ? <>
          <div className="admin-stats"><div><span className="admin-stat-icon"><Truck size={22} /></span><div><p>全部车型</p><strong>{vehicles.length}<small>款</small></strong></div></div><div><span className="admin-stat-icon admin-stat-green"><Eye size={22} /></span><div><p>前台展示中</p><strong>{published}<small>款</small></strong></div></div><div><span className="admin-stat-icon admin-stat-amber"><EyeOff size={22} /></span><div><p>已下架</p><strong>{vehicles.length - published}<small>款</small></strong></div></div></div>
          <div className="admin-catalog-panel">
            <div className="admin-table-toolbar"><div className="admin-filter-tabs" role="group" aria-label="按上架状态筛选">{[['all', '全部车型'], ['published', '已上架'], ['unpublished', '已下架']].map(([value, label]) => <button key={value} className={filter === value ? 'admin-selected' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}</div><label className="admin-search"><Search size={17} /><input aria-label="搜索车型或品牌" placeholder="搜索车型或品牌…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={15} /></button>}</label></div>
            <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>车型信息</th><th>车型分类</th><th>现车情况</th><th>展示状态</th><th className="admin-table-actions-head">操作</th></tr></thead><tbody>{loading ? <tr><td colSpan={5}><div className="admin-table-empty"><LoaderCircle className="admin-spin" size={25} />正在加载车型…</div></td></tr> : visible.length === 0 ? <tr><td colSpan={5}><div className="admin-table-empty"><Search size={28} /><strong>{query || filter !== 'all' ? '没有找到符合条件的车型' : '开始添加您的第一款车型'}</strong><span>{query || filter !== 'all' ? '试试其他关键词，或切换展示状态。' : '点击右上角「新增车型」，完善资料后即可上架。'}</span></div></td></tr> : visible.map(vehicle => <tr key={vehicle.id}>
              <td><div className="admin-vehicle-cell"><div className="admin-vehicle-thumb">{vehicle.images[0] ? <img src={vehicle.images[0]} alt={vehicle.name} loading="lazy" /> : <Truck size={26} />}</div><div><strong>{vehicle.name}</strong><span>{vehicle.brand}</span></div></div></td>
              <td><div className="admin-category-cell"><span className={vehicle.temperature === '冷藏' ? 'admin-chip admin-chip-cold' : 'admin-chip'}>{vehicle.temperature}</span><span>{(vehicle.bodyTypes?.length ? vehicle.bodyTypes : [vehicle.bodyType]).join(' / ')}</span></div></td>
              <td><span className={`admin-availability ${vehicle.availability === '有现车' ? 'admin-stock' : ''}`}>{vehicle.availability}</span></td>
              <td><span className={vehicle.published ? 'admin-status admin-published' : 'admin-status'}><i />{vehicle.published ? '已上架' : '已下架'}</span></td>
              <td><div className="admin-row-actions"><button type="button" onClick={() => setEditing(vehicle)} className="admin-text-button" disabled={!!busyId}><Pencil size={15} /> 编辑</button><button type="button" onClick={() => void toggle(vehicle)} disabled={!!busyId} className={`admin-text-button ${vehicle.published ? 'admin-muted-action' : ''}`}>{busyId === vehicle.id ? <LoaderCircle className="admin-spin" size={15} /> : vehicle.published ? <EyeOff size={15} /> : <Eye size={15} />}{vehicle.published ? '下架' : '上架'}</button><button type="button" onClick={() => setDeleting(vehicle)} disabled={!!busyId} className="admin-text-button admin-delete-action" aria-label={`删除${vehicle.name}`}><Trash2 size={15} /> 删除</button></div></td>
            </tr>)}</tbody></table></div>
            <div className="admin-table-footer"><span>共 {visible.length} 款车型{query || filter !== 'all' ? ` · 全部 ${vehicles.length} 款` : ''}</span><span><CircleHelp size={14} /> 上架状态与现车情况分别管理</span></div>
          </div>
          <div className="admin-help-note"><ShieldCheck size={17} /><p>前台仅展示已上架车型。下架会隐藏车型，资料和图片仍保留，可随时重新上架。</p></div>
        </> : tab === 'security' ? <PasswordForm disabled={loading || savingSettings || uploadingLogo || cleaningLogo || loggingOut || !!busyId || !!editing || !!deleting || settingsDirty || settingsSaveUnverified} busy={changingPassword} blockedMessage={settingsSaveUnverified ? '网站设置的上次保存结果尚未确认，请先前往网站设置核实，再修改密码。' : settingsDirty ? '网站设置还有未保存的修改，请先保存或撤销，再修改密码。' : ''} error={passwordError} verificationRequired={passwordVerificationRequired} onSubmit={changePassword} onVerify={retryPasswordVerification} onSettings={() => { setTab('settings'); setError('') }} /> : <form onSubmit={saveSettings} className="admin-settings-panel">
          <div className="admin-settings-head"><div className="admin-settings-symbol"><Settings2 size={22} /></div><div><h2>公司与联系方式</h2><p>修改后请点击底部「保存网站设置」。</p></div></div>
          {!settingsLoaded && <div className="admin-settings-load-status" role="status">{loading ? '正在读取已保存的网站设置…' : '尚未成功读取网站设置，请重新加载数据后再编辑。'}</div>}
          <div className="admin-settings-fields">
            <section className="admin-logo-section" aria-labelledby="admin-logo-title">
              <h3 id="admin-logo-title">公司图标</h3>
              <div className="admin-logo-controls">
                <div className={`admin-logo-preview${settings.logoUrl ? '' : ' admin-logo-preview-empty'}`}>
                  {settings.logoUrl ? <img src={settings.logoUrl} alt="公司图标预览" /> : <span aria-label="默认公司图标">好</span>}
                </div>
                <div className="admin-logo-options">
                  <div className="admin-logo-buttons">
                    <button className="admin-button admin-small" type="button" onClick={() => { if (!logoDisabled && !loadingRef.current) logoFileRef.current?.click() }} disabled={logoDisabled}>{uploadingLogo ? <LoaderCircle className="admin-spin" size={16} /> : <ImagePlus size={16} />}{uploadingLogo ? '正在上传…' : settings.logoUrl ? '更换图标' : '上传图标'}</button>
                    {settings.logoUrl && <button className="admin-button admin-small" type="button" onClick={() => void removeLogo()} disabled={logoDisabled}><Trash2 size={15} /> 移除图标</button>}
                  </div>
                  <p>支持 PNG、JPG、WebP，最大 8 MB。建议使用透明背景的正方形图片。</p>
                  <p className="admin-logo-save-note" role="status">{cleaningLogo ? '正在清理未保存的临时图片…' : uploadingLogo ? '请等待上传完成后再保存。' : logoChanged ? '图标已修改，保存网站设置后生效。' : settings.logoUrl ? '图标已保存，将显示在网站页头和页脚。' : '未上传图标时，网站使用默认文字标识。'}</p>
                  <p>更换或移除已保存图标后，旧图在保存设置时清理；未保存的上传图会在再次更换、撤销或退出时清理。</p>
                </div>
              </div>
              <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void uploadLogo(e.target.files?.[0])} className="admin-file-input" tabIndex={-1} aria-label="选择公司图标" disabled={logoDisabled} />
              <ErrorMessage message={logoError} />
            </section>
            <label>网站名称 <span>*</span><input value={settings.siteName} required maxLength={60} disabled={settingsDisabled} onChange={e => updateSetting('siteName', e.target.value)} placeholder="填写公司或展厅名称" /></label>
            <label>网站简介<input value={settings.tagline} maxLength={120} disabled={settingsDisabled} onChange={e => updateSetting('tagline', e.target.value)} placeholder="填写租售服务简介" /></label>
            <div className="admin-form-grid"><label>联系电话<input type="tel" value={settings.phone} maxLength={40} disabled={settingsDisabled} onChange={e => updateSetting('phone', e.target.value)} placeholder="填写业务联系电话" /></label><label>微信号<input value={settings.wechat} maxLength={80} disabled={settingsDisabled} onChange={e => updateSetting('wechat', e.target.value)} placeholder="填写业务联系微信" /></label></div>
            <label>公司地址<input value={settings.address} maxLength={200} disabled={settingsDisabled} onChange={e => updateSetting('address', e.target.value)} placeholder="填写门店或公司地址" /></label>
            <div className="admin-info-note"><CircleHelp size={16} /> 未填写的联系方式不会在前台展示。</div>
          </div>
          <div className="admin-settings-footer"><span className="admin-settings-draft-status" role="status">{settingsSaveUnverified ? '请先核实保存结果' : settingsDirty ? '有未保存的修改' : hasLogoDrafts ? '有待清理的临时图片' : settingsLoaded ? '当前设置已保存' : '等待读取设置'}</span>{(settingsDirty || hasLogoDrafts) && <button className="admin-button" type="button" onClick={() => void discardSettings()} disabled={settingsDisabled || uploadingLogo}>撤销修改</button>}<button className="admin-button admin-primary" type="submit" disabled={settingsDisabled || uploadingLogo || !settingsDirty}>{savingSettings ? <LoaderCircle className="admin-spin" size={17} /> : <Check size={17} />}{savingSettings ? '正在保存…' : '保存网站设置'}</button></div>
        </form>}
        {(error || settingsError || vehicleLoadError) && <div className="admin-reload-controls"><button className="admin-button admin-small" onClick={() => void loadContent()} disabled={!canReload}>重新加载数据</button>{settingsDirty || hasLogoDrafts ? <span>网站设置有未保存内容，请先保存或撤销修改。</span> : !canReload && <span>请等待当前操作完成后再重新加载。</span>}</div>}
        <footer className="admin-page-footer">{settings.siteName || '车型管理'} · 管理后台</footer>
      </div>
    </main>
    {editing && <VehicleEditor initial={editing} token={token} onClose={() => setEditing(null)} onCleanupPending={reportCleanupPending} onSaved={vehicle => { setVehicles(vs => vs.some(v => v.id === vehicle.id) ? vs.map(v => v.id === vehicle.id ? vehicle : v) : [vehicle, ...vs]); setEditing(null); setNotice('车型资料已保存。') }} />}
    {deleting && <DeleteVehicleDialog vehicle={deleting} token={token} onClose={() => setDeleting(null)} onCleanupPending={reportCleanupPending} onDeleted={id => { setVehicles(vs => vs.filter(v => v.id !== id)); setDeleting(null); setNotice(`「${deleting.name}」车型记录已删除。`) }} />}
  </div>
}
