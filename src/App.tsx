import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Copy, MapPin, Menu, MessageCircle, Phone, Search, Truck, X } from 'lucide-react';
import type { Settings, Vehicle } from './types';

const Admin = lazy(() => import('./Admin'));
const staticPreview = import.meta.env.VITE_STATIC_PREVIEW === 'true';
const homeUrl = staticPreview ? import.meta.env.BASE_URL : '/';
const catalogUrl = staticPreview ? `${homeUrl}catalog.json` : '/api/catalog';
const defaultSettings: Settings = { siteName: '浙江好滴哥物流科技有限公司', tagline: '商用车租售，一站选好车', phone: '', wechat: '', address: '', logoUrl: '' };
const types = ['面包', '平板', '厢货', '高栏'];
type PageSection = 'catalog' | 'service' | 'contact';
function publicAssetUrl(url: string) {
  if (!staticPreview || !url.startsWith('/') || url.startsWith('//') || url.startsWith(homeUrl)) return url;
  return `${homeUrl}${url.slice(1)}`;
}
function vehicleIdFromPath(pathname: string) {
  if (!pathname.startsWith('/vehicles/')) return '';
  try {
    const id = decodeURIComponent(pathname.slice('/vehicles/'.length));
    return /^[a-z0-9][a-z0-9-]{0,99}$/.test(id) ? id : '!invalid-vehicle-url';
  } catch { return '!invalid-vehicle-url'; }
}
function vehicleIdFromUrl() {
  if (!staticPreview) return vehicleIdFromPath(location.pathname);
  const id = new URLSearchParams(location.search).get('vehicle');
  return id === null ? '' : /^[a-z0-9][a-z0-9-]{0,99}$/.test(id) ? id : '!invalid-vehicle-url';
}
const availabilityText = (value: string) => value === '待确认' ? '现车待确认' : value;
const batteryNumber = (value = '') => {
  const matches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*(?:度|kWh)/gi)].map(m => m[1]);
  return matches.length ? `${[...new Set(matches)].join(' / ')} kWh` : value;
};

function CompanyLogo({ settings }: { settings: Settings }) {
  return <span className={`company-logo ${settings.logoUrl ? 'has-image' : ''}`}>{settings.logoUrl ? <img src={settings.logoUrl} alt={`${settings.siteName}标志`} /> : <span aria-hidden="true">好</span>}</span>;
}

function Modal({ children, onClose, className = '', title }: { children: React.ReactNode; onClose: () => void; className?: string; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-inner"><button className="icon-button close-modal" aria-label="关闭" onClick={onClose}><X size={21} /></button>{children}</div></dialog>;
}

function Contact({ settings, vehicle, onClose }: { settings: Settings; vehicle?: Vehicle; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState(false);
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); setCopyError(false); }
    catch { setCopyError(true); }
  }
  const request = `您好，我想咨询${vehicle ? `「${vehicle.name}」` : '新能源商用车'}的租售方案，请帮我确认现车、具体配置和报价。`;
  return <Modal title="咨询租售方案" className="contact-modal" onClose={onClose}><div className="contact-symbol"><MessageCircle /></div><h2>租售咨询</h2><p className="muted">{vehicle ? `${vehicle.name} · ${vehicle.temperature} · ${vehicle.bodyType}` : '租车、购车、车型配置，我们为您提供选车参考。'}</p><div className="contact-options">{settings.phone && <a href={`tel:${settings.phone.replace(/[^+\d-]/g, '')}`}><Phone size={20} /><span><small>电话咨询</small><strong>{settings.phone}</strong></span><ArrowUpRight size={20} /></a>}{settings.wechat && <button onClick={() => copy(settings.wechat)}><MessageCircle size={20} /><span><small>微信咨询</small><strong>{settings.wechat}</strong></span>{copied === settings.wechat ? <Check size={19} /> : <Copy size={19} />}</button>}{settings.address && <div><MapPin size={20} /><span><small>联系地址</small><strong>{settings.address}</strong></span></div>}</div>{!settings.phone && !settings.wechat && <div className="contact-empty"><CircleHelp size={20} /><p>联系方式暂未公布。您可以先复制咨询内容，通过已有渠道联系业务人员。</p></div>}<div className="inquiry-text">{request}</div><button className="button primary full" onClick={() => copy(request)}>{copied === request ? <Check size={17} /> : <Copy size={17} />}{copied === request ? '已复制咨询内容' : '复制咨询内容'}</button><p className="micro" role="status">{copyError ? '未能自动复制，请选中上方文字手动复制。' : '具体配置、价格及现车情况以业务人员确认为准。'}</p></Modal>;
}

function Detail({ vehicle, onClose, onContact }: { vehicle: Vehicle; onClose: () => void; onContact: (v: Vehicle) => void }) {
  const [photo, setPhoto] = useState(0);
  useEffect(() => setPhoto(current => Math.min(current, Math.max(0, vehicle.images.length - 1))), [vehicle.images.length]);
  const summaries = [
    { label: '货厢容积', value: vehicle.cargoVolume, replaces: /^(货厢容积|货箱容积|容积)$/ },
    { label: '电池容量', value: vehicle.battery, replaces: /^(动力电池|电池容量|电池)$/ },
    { label: '续航里程', value: vehicle.range, replaces: /^(续航|续航里程)$/ },
    { label: '载重信息', value: vehicle.payload, replaces: /^(载重|载重信息|额定载重|额定载质量)$/ },
    { label: '尺寸信息', value: vehicle.dimensions, replaces: /^(货厢尺寸|货箱尺寸|尺寸信息)/ }
  ].filter(item => item.value);
  const displaySpecs = [...summaries.map(s => ({ label: s.label, value: s.value! })), ...(vehicle.specs || []).filter(spec => !summaries.some(s => s.replaces.test(spec.label) || s.value === spec.value))];
  return <Modal title={vehicle.name} className="detail-modal" onClose={onClose}><div className="detail-layout"><div className="detail-gallery"><div className="detail-image">{vehicle.images[photo] ? <img src={vehicle.images[photo]} alt={`${vehicle.name} 图片 ${photo + 1}`} /> : <Truck size={80} />}{vehicle.images.length > 1 && <><button className="gallery-arrow prev" aria-label="上一张图片" onClick={() => setPhoto((photo - 1 + vehicle.images.length) % vehicle.images.length)}><ChevronLeft /></button><button className="gallery-arrow next" aria-label="下一张图片" onClick={() => setPhoto((photo + 1) % vehicle.images.length)}><ChevronRight /></button></>}<span className="image-counter">{vehicle.images.length ? photo + 1 : 0} / {vehicle.images.length}</span></div><div className="thumbnails">{vehicle.images.map((src, i) => <button key={src} className={photo === i ? 'active' : ''} onClick={() => setPhoto(i)} aria-label={`查看图片 ${i + 1}`} aria-pressed={photo === i}><img src={src} alt="" loading="lazy" /></button>)}</div><p className="image-note">车型图片仅供参考，具体外观及配置以实际车辆为准。</p></div><div className="detail-heading"><span className="eyebrow">{vehicle.brand} · 新能源商用车</span><h2>{vehicle.name}</h2><div className="tags"><span>{vehicle.temperature}</span><span>{(vehicle.bodyTypes?.length ? vehicle.bodyTypes : [vehicle.bodyType]).join(' / ')}</span><span className={`stock ${vehicle.availability === '有现车' ? 'in-stock' : ''}`}><i />{availabilityText(vehicle.availability)}</span></div><p className="detail-description">{vehicle.description}</p>{!!vehicle.highlights?.length && <ul className="highlights">{vehicle.highlights.map((t, i) => <li key={i}><Check size={16} />{t}</li>)}</ul>}<div className="detail-consult"><span>租售方案<strong>按需求咨询报价</strong></span><button className="button primary" onClick={() => onContact(vehicle)}>咨询这款车<ArrowUpRight size={17} /></button></div><div className="stock-explainer"><CircleHelp size={16} /><span>本车型可咨询租售，不代表当前有现车。请联系业务人员确认交付时间。</span></div></div></div><div className="spec-section"><div className="section-title"><h3>车型参数</h3><span>不同版本配置可能存在差异</span></div><dl className="spec-table">{displaySpecs.length ? displaySpecs.map((s, i) => <div key={i}><dt>{s.label}</dt><dd>{s.value}</dd></div>) : <div><dt>详细配置</dt><dd>请咨询业务人员确认</dd></div>}</dl></div></Modal>;
}

function VehicleCard({ vehicle, onSelect, onContact }: { vehicle: Vehicle; onSelect: () => void; onContact: () => void }) {
  const values = [{ label: '容积', value: vehicle.cargoVolume }, { label: '电池', value: batteryNumber(vehicle.battery) }, { label: '续航', value: vehicle.range }];
  return <article className="vehicle-card">
    <button className="card-photo" onClick={onSelect} aria-label={`查看${vehicle.name}详情`}>
      {vehicle.images[0] ? <img src={vehicle.images[0]} alt={vehicle.name} loading="lazy" /> : <Truck size={60} />}
      <span className={`temperature-tag ${vehicle.temperature === '冷藏' ? 'cold' : ''}`}>{vehicle.temperature}</span>
    </button>
    <div className="card-content">
      <h3><button onClick={onSelect}>{vehicle.name}</button></h3>
      <div className="card-meta"><span>{vehicle.brand} <i /> {(vehicle.bodyTypes?.length ? vehicle.bodyTypes : [vehicle.bodyType]).join(' / ')}</span><span className={`stock ${vehicle.availability === '有现车' ? 'in-stock' : ''}`}>{availabilityText(vehicle.availability)}</span></div>
      <dl className="card-specs">{values.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd title={value || '请咨询确认'}>{value || '待确认'}</dd></div>)}</dl>
      <div className="card-bottom"><span>租赁 / 购买</span><div><button className="card-detail" onClick={onSelect}>查看参数</button><button className="card-inquiry" onClick={onContact}>咨询报价</button></div></div>
    </div>
  </article>;
}

function Catalog() {
  const params = new URLSearchParams(location.search);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [temperature, setTemperature] = useState(params.get('temperature') || '全部');
  const [body, setBody] = useState(params.get('body') || '全部');
  const [brand, setBrand] = useState(params.get('brand') || '全部品牌');
  const [search, setSearch] = useState(params.get('q') || '');
  const [sort, setSort] = useState('default');
  const [selectedId, setSelectedId] = useState(vehicleIdFromUrl);
  const [contact, setContact] = useState<{ vehicle?: Vehicle } | null>(null);
  const [menu, setMenu] = useState(false);
  const [visible, setVisible] = useState(12);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const resultSummary = useRef<HTMLSpanElement>(null);
  const [activeSection, setActiveSection] = useState<PageSection>(() => location.hash === '#service' ? 'service' : location.hash === '#contact' ? 'contact' : 'catalog');
  const navigationTarget = useRef<PageSection | null>(location.hash === '#service' ? 'service' : location.hash === '#contact' ? 'contact' : null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (navigationTarget.current || document.querySelector('dialog[open]')) return;
      const header = document.querySelector('.site-header')?.getBoundingClientRect();
      const service = document.getElementById('service')?.getBoundingClientRect();
      const footer = document.getElementById('contact')?.getBoundingClientRect();
      if (!service || !footer) return;
      const threshold = (header?.bottom ?? 94) + 24;
      const mobileBar = document.querySelector('.mobile-actions')?.getBoundingClientRect().height ?? 0;
      const viewportBottom = window.innerHeight - mobileBar;
      const atBottom = window.scrollY > 2 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      // A partly visible footer does not take the selection away from the service section.
      const section: PageSection = window.scrollY <= 2 ? 'catalog'
        : atBottom || footer.top <= threshold ? 'contact'
        : service.top <= threshold || service.bottom <= viewportBottom ? 'service' : 'catalog';
      setActiveSection(section);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resumeTracking = () => { navigationTarget.current = null; schedule(); };
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab'].includes(event.key)) resumeTracking();
    };
    const onHash = () => {
      const section = location.hash.slice(1);
      if (section === 'catalog' || section === 'service' || section === 'contact') {
        navigationTarget.current = section; setActiveSection(section);
      } else resumeTracking();
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('wheel', resumeTracking, { passive: true });
    window.addEventListener('touchstart', resumeTracking, { passive: true });
    window.addEventListener('pointerdown', resumeTracking, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', resumeTracking);
    window.addEventListener('hashchange', onHash);
    const observer = new ResizeObserver(schedule);
    if (document.querySelector('main')) observer.observe(document.querySelector('main')!);
    schedule();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('wheel', resumeTracking);
      window.removeEventListener('touchstart', resumeTracking);
      window.removeEventListener('pointerdown', resumeTracking);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', resumeTracking);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  function navigateTo(event: React.MouseEvent<HTMLAnchorElement>, section: PageSection, cold?: boolean) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (cold === true) { reset(); setTemperature('冷藏'); }
    else if (cold === false) setTemperature('全部');
    setMenu(false);
    navigationTarget.current = section;
    setActiveSection(section);
    history.pushState(null, '', `${location.pathname}${location.search}#${section}`);
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
  }
  const activeNav = contact ? 'contact' : activeSection === 'catalog' && temperature === '冷藏' ? 'cold' : activeSection;

  async function load() {
    try {
      const response = await fetch(catalogUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('车型暂时未能加载，请稍后重试。');
      const data: { vehicles: Vehicle[]; settings?: Partial<Settings> } = await response.json();
      const loadedSettings = { ...defaultSettings, ...data.settings };
      setVehicles(staticPreview ? data.vehicles.map(vehicle => ({ ...vehicle, images: vehicle.images.map(publicAssetUrl) })) : data.vehicles);
      setSettings({ ...loadedSettings, logoUrl: publicAssetUrl(loadedSettings.logoUrl) }); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '网络连接失败，请重试。'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const focus = () => load();
    const pop = () => {
      const query = new URLSearchParams(location.search);
      setSelectedId(vehicleIdFromUrl());
      setTemperature(query.get('temperature') || '全部');
      setBody(query.get('body') || '全部');
      setBrand(query.get('brand') || '全部品牌');
      setSearch(query.get('q') || '');
    };
    window.addEventListener('focus', focus); window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('focus', focus); window.removeEventListener('popstate', pop); };
  }, []);
  useEffect(() => { document.title = `${settings.siteName} · 车型库`; }, [settings.siteName]);
  useEffect(() => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) { icon.href = settings.logoUrl || publicAssetUrl('/favicon.svg'); icon.type = settings.logoUrl ? '' : 'image/svg+xml'; }
  }, [settings.logoUrl]);
  useEffect(() => {
    const q = new URLSearchParams(staticPreview ? location.search : '');
    if (temperature !== '全部') q.set('temperature', temperature); else q.delete('temperature');
    if (body !== '全部') q.set('body', body); else q.delete('body');
    if (brand !== '全部品牌') q.set('brand', brand); else q.delete('brand');
    if (search) q.set('q', search); else q.delete('q');
    history.replaceState(null, '', `${staticPreview ? homeUrl : location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
    setVisible(12);
  }, [temperature, body, brand, search]);
  const brands = useMemo(() => [...new Set(vehicles.map(v => v.brand))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [vehicles]);
  const filtered = useMemo(() => {
    const found = vehicles.filter(v => (temperature === '全部' || v.temperature === temperature) && (body === '全部' || (v.bodyTypes?.length ? v.bodyTypes : [v.bodyType]).includes(body)) && (brand === '全部品牌' || v.brand === brand) && (!search.trim() || `${v.name} ${v.brand} ${v.description}`.toLowerCase().includes(search.trim().toLowerCase())));
    if (sort === 'name') found.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (sort === 'stock') found.sort((a, b) => Number(b.availability === '有现车') - Number(a.availability === '有现车'));
    return found;
  }, [vehicles, temperature, body, brand, search, sort]);
  const selected = vehicles.find(v => v.id === selectedId);
  const hero = vehicles.find(v => v.id === 'vehicle-19') || vehicles.find(v => v.bodyType === '面包' && v.images.length) || vehicles[0];
  function reset() { setTemperature('全部'); setBody('全部'); setBrand('全部品牌'); setSearch(''); }
  function openDetail(v: Vehicle) {
    setSelectedId(v.id);
    if (staticPreview) {
      const query = new URLSearchParams(location.search);
      query.set('vehicle', v.id);
      history.pushState(null, '', `${homeUrl}?${query}`);
    } else history.pushState(null, '', `/vehicles/${encodeURIComponent(v.id)}${location.search}`);
  }
  function closeDetail() {
    setSelectedId('');
    if (staticPreview) {
      const query = new URLSearchParams(location.search);
      query.delete('vehicle');
      history.replaceState(null, '', `${homeUrl}${query.size ? `?${query}` : ''}#catalog`);
    } else history.replaceState(null, '', `/${location.search}#catalog`);
  }
  const hasFilters = temperature !== '全部' || body !== '全部' || brand !== '全部品牌' || !!search;
  const selectedFilters = [
    ...(temperature !== '全部' ? [{ key: 'temperature', label: `温控：${temperature}${['常温', '冷藏'].includes(temperature) ? '' : '（无效条件）'}`, clear: () => setTemperature('全部') }] : []),
    ...(body !== '全部' ? [{ key: 'body', label: `车身：${body}${types.includes(body) ? '' : '（无效条件）'}`, clear: () => setBody('全部') }] : []),
    ...(brand !== '全部品牌' ? [{ key: 'brand', label: `品牌：${brand}${!loading && !error && !brands.includes(brand) ? '（暂无此品牌）' : ''}`, clear: () => setBrand('全部品牌') }] : []),
    ...(search ? [{ key: 'search', label: `搜索：${search.trim() || '空白内容'}`, clear: () => setSearch('') }] : [])
  ];
  function clearFilter(event: React.MouseEvent<HTMLButtonElement>, clear: () => void) {
    clear();
    if (event.detail === 0) requestAnimationFrame(() => {
      const next = document.querySelector<HTMLButtonElement>('#selected-filters button');
      (next || resultSummary.current)?.focus({ preventScroll: true });
    });
  }

  return <>
    <div className="utility-bar"><div className="page-width"><span>浙江好滴哥 · 新能源商用车租售</span><span>{staticPreview ? '网站效果预览' : <>车型与现车情况请分别确认 <a href="/admin">网站管理</a></>}</span></div></div>
    <header className="site-header"><div className="header-inner page-width">
      <a className="brand" href={homeUrl} aria-label="返回首页"><CompanyLogo settings={settings} /><span>{settings.siteName}<small>车辆租赁 / 车辆销售</small></span></a>
      <nav className={menu ? 'open' : ''} aria-label="主导航">
        <a className={activeNav === 'catalog' ? 'nav-active' : ''} aria-current={activeNav === 'catalog' ? 'location' : undefined} href="#catalog" onClick={event => navigateTo(event, 'catalog', false)}>车型库</a>
        <a className={activeNav === 'cold' ? 'nav-active' : ''} aria-current={activeNav === 'cold' ? 'location' : undefined} href="#catalog" onClick={event => navigateTo(event, 'catalog', true)}>冷藏车型</a>
        <a className={activeNav === 'service' ? 'nav-active' : ''} aria-current={activeNav === 'service' ? 'location' : undefined} href="#service" onClick={event => navigateTo(event, 'service')}>租售说明</a>
        <button className={activeNav === 'contact' ? 'nav-active' : ''} aria-current={activeNav === 'contact' ? 'location' : undefined} onClick={() => { setContact({}); setMenu(false); }}>联系我们</button>
      </nav>
      <button className="button header-contact" onClick={() => setContact({})}><Phone size={17} />{settings.phone || '选车咨询'}</button>
      <button className="mobile-menu icon-button" aria-label="展开导航" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
    </div></header>
    <main>
      <section className="showroom-banner page-width">
        <div className="showroom-copy"><p className="banner-kicker">面包车 · 平板车 · 厢货车 · 高栏车</p><h1>新能源物流车<br />租赁 · 销售</h1><p className="banner-description">常温配送、冷链运输<br />按车型、空间和配置选择适合的车辆。</p><a className="button primary" href="#catalog">查看车型<ArrowRight size={18} /></a><p className="banner-stock-note">可租售车型展示，现车及报价请咨询。</p></div>
        <div className="showroom-photo">{hero?.images.length ? <img src={hero.images.find(image => hero.id === 'vehicle-19' && image.endsWith('/image2.webp')) || hero.images[0]} alt={`${hero.name}实拍`} fetchPriority="high" /> : <Truck size={90} />}<span className="showroom-caption">车型实拍{hero && <button onClick={() => openDetail(hero)}>{hero.name}<ChevronRight size={15} /></button>}</span></div>
      </section>

      <section className="catalog-section" id="catalog"><div className="page-width">
        <div className="catalog-heading"><div><h2>车型库</h2><span>可租 · 可售</span></div><p>{loading ? '正在加载车型…' : error ? '车型暂未加载' : `共 ${vehicles.length} 款车型`}</p></div>
        <div className="filter-toolbar"><span>按需求筛选</span><button aria-expanded={filtersExpanded} aria-controls="filter-body filter-brand" onClick={() => setFiltersExpanded(expanded => !expanded)}>{filtersExpanded ? '收起筛选' : '更多筛选'}<ChevronDown size={15} /></button></div>
        <div className={`filter-panel ${filtersExpanded ? 'mobile-expanded' : 'mobile-collapsed'}`}>
          <div className="filter-row"><span className="filter-label">温控类型</span><div className="filter-options" role="group" aria-label="温度类型">{['全部', '常温', '冷藏'].map(t => <button key={t} onClick={() => setTemperature(t)} className={temperature === t ? 'active' : ''} aria-pressed={temperature === t}>{t === '全部' ? '不限' : t}</button>)}</div><label className="search-box"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="输入车型名称或品牌" aria-label="搜索车型或品牌" />{search && <button aria-label="清空搜索" onClick={() => setSearch('')}><X size={15} /></button>}</label></div>
          <div className="filter-row" id="filter-body"><span className="filter-label">车身类型</span><div className="filter-options" role="group" aria-label="车身类型">{['全部', ...types].map(t => <button key={t} className={body === t ? 'active' : ''} onClick={() => setBody(t)} aria-pressed={body === t}>{t === '全部' ? '不限' : t}</button>)}</div></div>
          <div className="filter-row brand-filter-row" id="filter-brand"><span className="filter-label">车辆品牌</span><label className="select-wrap"><span className="sr-only">品牌筛选</span><select value={brand} onChange={e => setBrand(e.target.value)}><option>全部品牌</option>{brand !== '全部品牌' && !brands.includes(brand) && <option value={brand}>{brand}（暂无此品牌）</option>}{brands.map(b => <option key={b}>{b}</option>)}</select><ChevronDown size={14} /></label><span className="inventory-note">上架车型不等于现车库存</span></div>
        </div>
        {hasFilters && <div className="selected-filters" id="selected-filters" aria-label="已选筛选条件"><span>已选条件</span>{selectedFilters.map(filter => <button className="filter-chip" key={filter.key} title={filter.label} aria-label={`移除${filter.label}`} onClick={event => clearFilter(event, filter.clear)}><span>{filter.label}</span><X size={13} /></button>)}<button className="reset-button" onClick={event => clearFilter(event, reset)}>清空全部</button></div>}
        <div className="result-bar"><span ref={resultSummary} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{loading ? '正在加载车型…' : error ? '车型暂未加载，请重试' : <>符合条件的车型 <strong>{filtered.length}</strong> 款<span className="result-shown">已显示 {Math.min(visible, filtered.length)} 款</span></>}</span><label className="sort-label">排序<select value={sort} onChange={e => setSort(e.target.value)} aria-label="车型排序"><option value="default">默认顺序</option><option value="name">车型名称</option><option value="stock">有现车优先</option></select><ChevronDown size={13} /></label></div>
        {loading ? <div className="vehicle-grid">{[0, 1, 2, 3, 4, 5].map(i => <div className="skeleton-card" key={i}><div /><span /><span /></div>)}</div> : error ? <div className="empty-state" role="alert"><CircleHelp size={36} /><h3>暂时无法加载车型</h3><p>{error}</p><button className="button primary" onClick={() => { setLoading(true); load(); }}>重新加载</button></div> : filtered.length === 0 ? <div className="empty-state"><Search size={36} /><h3>暂无符合条件的车型</h3><p>可以调整筛选条件，或咨询业务人员。</p><div><button className="button secondary" onClick={reset}>清除筛选</button><button className="button primary" onClick={() => setContact({})}>咨询车型</button></div></div> : <>
          <div className="vehicle-grid">{filtered.slice(0, visible).map(v => <VehicleCard key={v.id} vehicle={v} onSelect={() => openDetail(v)} onContact={() => setContact({ vehicle: v })} />)}</div>
          <div className="load-more">{visible < filtered.length ? <button className="button secondary" onClick={() => setVisible(v => v + 12)}>加载更多车型<span>剩余 {filtered.length - visible} 款</span><ArrowDown size={16} /></button> : <p>全部 {filtered.length} 款车型已显示</p>}</div>
        </>}
      </div></section>

      <section className="service-section page-width" id="service"><h2>租售说明</h2><div className="service-columns">
        <div><h3>车辆租赁</h3><p>请告知运输货物、每日里程和计划租期。租金、押金、保险及维保责任，由业务人员按车型说明。</p></div>
        <div><h3>车辆购买</h3><p>选定车型后，请核对电池版本、车身尺寸及上装配置。具体车况、报价和交付安排，以双方确认为准。</p></div>
        <div><h3>现车确认</h3><p>网站展示公司可租售的车型，并非全部都有现车。到店看车或安排用车前，请先确认库存和交车时间。</p></div>
      </div></section>
    </main>

    <footer className="site-footer" id="contact"><div className="page-width footer-top">
      <div><a className="brand footer-brand" href={homeUrl}><CompanyLogo settings={settings} /><span>{settings.siteName}<small>新能源商用车租赁与销售</small></span></a><p className="footer-description">面包车、平板车、厢货车、高栏车及冷藏车型。</p></div>
      <div className="footer-contact"><h3>联系咨询</h3>{settings.phone && <a href={`tel:${settings.phone.replace(/[^+\d-]/g, '')}`}><Phone size={16} />{settings.phone}</a>}{settings.wechat && <p>微信：{settings.wechat}</p>}{settings.address && <p><MapPin size={16} />{settings.address}</p>}{!settings.phone && !settings.wechat && <button onClick={() => setContact({})}>咨询车辆租售<ArrowRight size={15} /></button>}</div>
    </div><div className="page-width footer-bottom"><span>© {new Date().getFullYear()} {settings.siteName}</span><span>图片与参数仅供选车参考，以实际车辆配置为准。</span>{!staticPreview && <a href="/admin">管理后台</a>}</div></footer>
    <div className="mobile-actions"><a href="#catalog" onClick={event => { setFiltersExpanded(true); navigateTo(event, 'catalog'); }}>筛选车型</a><button onClick={() => setContact({})}><Phone size={16} />租售咨询</button></div>

    {selected && <Detail key={selected.id} vehicle={selected} onClose={closeDetail} onContact={v => { closeDetail(); setContact({ vehicle: v }); }} />}
    {selectedId && !selected && !loading && !error && <Modal title="车型暂不可用" onClose={closeDetail} className="contact-modal"><div className="empty-state"><Truck size={40} /><h2>这款车型暂未上架</h2><p>您可以返回车型库，查看其他可租售车型。</p><button className="button primary" onClick={closeDetail}>返回车型库</button></div></Modal>}
    {contact && <Contact settings={settings} vehicle={contact.vehicle} onClose={() => setContact(null)} />}
  </>;
}

export default function App() {
  return !staticPreview && location.pathname.startsWith('/admin') ? <Suspense fallback={<div className="app-loading">正在加载管理后台…</div>}><Admin /></Suspense> : <Catalog />;
}
