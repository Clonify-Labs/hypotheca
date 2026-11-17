import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  Database,
  FileText,
  FolderOpen,
  Lock,
  LogOut,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserPlus,
  Users,
} from 'lucide-react';
import { Dataset, Lang } from '../../types/interfaces';
import { runDescriptives } from '../../engine/classical/basics';
import { SpecTable } from '../../components/SpecTable';

export interface McpDashboardPageProps {
  dataset: Dataset | null;
  datasets: Dataset[];
  lang: Lang;
  onEnterWorkbench: () => void;
}

interface AuthSessionUser {
  username: string;
  name: string;
  role: string;
  bapProject: string;
}

type OsTab = 'macos' | 'windows' | 'linux';

const CLAUDE_CONFIG_SNIPPET = `{
  "mcpServers": {
    "hypotheca-bap": {
      "command": "node",
      "args": ["<PROJE_DIZINI>/mcp-server/dist/index.js"],
      "env": {
        "HYPOTHECA_DATA_DIR": "<PROJE_DIZINI>/arastirma-verilerim",
        "HYPOTHECA_PROJECT_NAME": "BAP-2026-01"
      }
    }
  }
}`;

export const McpDashboardPage: React.FC<McpDashboardPageProps> = ({
  dataset,
  datasets,
  lang,
  onEnterWorkbench,
}) => {
  const tr = lang === 'tr';
  const [selectedId, setSelectedId] = useState<string>(
    () => dataset?.id ?? datasets[0]?.id ?? '',
  );
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [sessionState, setSessionState] = useState<'loading' | 'worker' | 'local'>('loading');
  const [teamEnabled, setTeamEnabled] = useState(false);
  const [teamMembers, setTeamMembers] = useState<AuthSessionUser[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'co_researcher' | 'research_assistant'>('co_researcher');
  const [teamMessage, setTeamMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [addingMember, setAddingMember] = useState(false);

  const [osTab, setOsTab] = useState<OsTab>(() => {
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('win')) return 'windows';
      if (ua.includes('mac')) return 'macos';
    }
    return 'linux';
  });

  const [loggingOut, setLoggingOut] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showDescriptives, setShowDescriptives] = useState(true);

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === selectedId) ?? dataset ?? datasets[0] ?? null,
    [datasets, selectedId, dataset],
  );

  const loadTeamMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/team', { credentials: 'same-origin' });
      if (!res.ok) return;
      const json = (await res.json()) as { members?: AuthSessionUser[] };
      if (Array.isArray(json.members)) {
        setTeamMembers(json.members);
      }
    } catch {
      /* ekip listesi alınamazsa sessizce geç */
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { credentials: 'same-origin', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          setSessionState('local');
          return;
        }
        const json = (await res.json()) as {
          authenticated?: boolean;
          capabilities?: { teamManagementEnabled?: boolean };
          user?: AuthSessionUser;
        };
        if (json.authenticated && json.user) {
          setUser(json.user);
          setSessionState('worker');
          const canManageTeam =
            Boolean(json.capabilities?.teamManagementEnabled) &&
            json.user.role === 'principal_investigator';
          setTeamEnabled(canManageTeam);
          if (canManageTeam) {
            void loadTeamMembers();
          }
        } else {
          setSessionState('local');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSessionState('local');
        }
      });
    return () => controller.abort();
  }, [loadTeamMembers]);

  const schemaPreview = useMemo(() => {
    if (!activeDataset) return null;
    return {
      resourceUri: 'bap://project/schema',
      bapProject: user?.bapProject ?? 'BAP-2026-ZEYNEP-01',
      privacyPolicy: 'no-raw-pii-egress',
      dataset: activeDataset.name,
      observations: activeDataset.rows.length,
      variables: activeDataset.columns.map((col) => ({
        name: col.name,
        valueType: col.valueType,
        measurementScale: col.scale,
        missingCount: col.missingCount,
        uniqueCount: col.uniqueCount,
      })),
    };
  }, [activeDataset, user?.bapProject]);

  const descriptivePreview = useMemo(() => {
    if (!activeDataset || !showDescriptives) return null;
    const numericCols = activeDataset.columns
      .filter((c) => c.valueType === 'numeric')
      .slice(0, 6)
      .map((c) => c.name);
    if (!numericCols.length) return null;
    try {
      return runDescriptives(activeDataset, numericCols);
    } catch {
      return null;
    }
  }, [activeDataset, showDescriptives]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      setCopiedKey(null);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      window.location.assign('/login');
    }
  };

  const handleAddTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeamMessage(null);
    setAddingMember(true);
    try {
      const res = await fetch('/api/auth/team', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: newMemberName,
          username: newMemberUsername,
          password: newMemberPassword,
          role: newMemberRole,
          bapProject: user?.bapProject,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        message?: string;
        member?: AuthSessionUser;
      };
      if (!res.ok) {
        setTeamMessage({ kind: 'err', text: json.message ?? (tr ? 'Üye eklenemedi.' : 'Could not add member.') });
        return;
      }
      setNewMemberName('');
      setNewMemberUsername('');
      setNewMemberPassword('');
      setTeamMessage({
        kind: 'ok',
        text: tr
          ? `${json.member?.name ?? 'Araştırmacı'} ekibe eklendi; giriş bilgileriyle oturum açabilir.`
          : `${json.member?.name ?? 'Researcher'} added to the team.`,
      });
      await loadTeamMembers();
    } catch {
      setTeamMessage({ kind: 'err', text: tr ? 'Bağlantı hatası oluştu.' : 'Network error.' });
    } finally {
      setAddingMember(false);
    }
  };

  const promptTemplates = tr
    ? [
        {
          id: 'prompt-stats',
          title: '1. Anket Verisi İstatistiksel Özet & Grup Karşılaştırması',
          prompt:
            'Önce `bap://project/schema` kaynağını oku ve KVKK hassas sütunlarını doğrula. Ardından `analyze_bap_data` aracını `bap_ogrenci_anket_2026.csv` üzerinde `groupBy: "Grup"` parametresiyle çalıştır; öz-yeterlik, tükenmişlik ve akademik başarı puanları için APA 7 uyumlu bulgu özeti üret.',
        },
        {
          id: 'prompt-lit',
          title: '2. Literatür PDF Sentezi & BAP Tartışma Taslağı',
          prompt:
            '`read_literature_pdf` aracını `literatur/bap_dijital_tukenmislik_2026.pdf` dosyasında `["öz-yeterlik", "tükenmişlik", "regresyon"]` anahtar kelimeleriyle çağır. Sayfa numaralı alıntılarla literatürü sentezle ve anket bulgularımızla karşılaştır.',
        },
      ]
    : [
        {
          id: 'prompt-stats',
          title: '1. Survey Descriptive Summary & Group Comparison',
          prompt:
            'Read `bap://project/schema` first to verify PII-protected columns. Then run `analyze_bap_data` on `bap_ogrenci_anket_2026.csv` with `groupBy: "Grup"` and synthesize APA 7 findings.',
        },
        {
          id: 'prompt-lit',
          title: '2. Literature PDF Synthesis & Discussion Draft',
          prompt:
            'Call `read_literature_pdf` on `literatur/bap_dijital_tukenmislik_2026.pdf` with keywords `["öz-yeterlik", "tükenmişlik", "regresyon"]`, cite page numbers, and compare against our empirical summary.',
        },
      ];

  const launcherFile = osTab === 'windows' ? 'Kurulum_Windows.bat' : 'Kurulum_Mac_Linux.command';

  return (
    <div className="hp-home" style={{ maxWidth: '1120px' }}>
      <section className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-md)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="hp-badge hp-badge-ok">
                <ShieldCheck size={13} />
                {sessionState === 'worker'
                  ? tr
                    ? 'Cloudflare HttpOnly JWT Aktif'
                    : 'Cloudflare HttpOnly JWT Active'
                  : tr
                    ? 'Yerel Gizlilik Modu'
                    : 'Local Privacy Mode'}
              </span>
              <span className="hp-badge hp-badge-info">
                {user?.bapProject ?? 'BAP-2026-ZEYNEP-01'}
              </span>
            </div>
            <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 'var(--space-2xs)' }}>
              {tr ? 'MCP Destekli BAP Analiz Dashboard' : 'MCP-Powered BAP Research Dashboard'}
            </h1>
            <p style={{ color: 'var(--color-muted)', margin: 0, maxWidth: '72ch' }}>
              {user
                ? tr
                  ? `Hoş geldiniz, ${user.name} (${user.username}). Araştırma verileriniz buluta yüklenmeden yerel MCP araçları ve tarayıcı içi istatistik motoruyla analiz edilir.`
                  : `Welcome, ${user.name} (${user.username}). Your research data remains local via MCP tools and the in-browser engine.`
                : tr
                  ? 'Zeynep Hoca ve BAP araştırma ekibi için %100 veri mahremiyetli, model bağımsız Model Context Protocol (MCP) kontrol merkezi.'
                  : 'Model-agnostic, 100% privacy-preserving Model Context Protocol (MCP) command center for academic research.'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
            <button type="button" className="hp-btn hp-btn-primary" onClick={onEnterWorkbench}>
              <span>{tr ? '7 Adımlı Analiz Çalışma Alanına Geç' : 'Open 7-Step Statistical Workbench'}</span>
              <ArrowRight size={15} />
            </button>
            {sessionState === 'worker' && (
              <button
                type="button"
                className="hp-btn"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                <LogOut size={14} />
                <span>{loggingOut ? (tr ? 'Çıkılıyor...' : 'Signing out...') : tr ? 'Oturumu Kapat' : 'Sign out'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="hp-grid-4">
          <div className="hp-plate" style={{ background: 'var(--color-paper)', boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
              <Lock size={14} />
              <span>{tr ? 'Veri Sızıntısı' : 'Cloud Data Egress'}</span>
            </div>
            <div className="hp-kpi-val" style={{ marginTop: 'var(--space-2xs)' }}>%0</div>
            <div className="hp-hint">{tr ? 'Ham satırlar yerel sandbox dışına çıkmaz' : 'Raw rows stay in local sandbox'}</div>
          </div>

          <div className="hp-plate" style={{ background: 'var(--color-paper)', boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
              <Bot size={14} />
              <span>{tr ? 'Model Bağımsızlığı' : 'Model Agnostic'}</span>
            </div>
            <div className="hp-kpi-val" style={{ marginTop: 'var(--space-2xs)', fontSize: 'var(--text-xl)' }}>MCP Stdio</div>
            <div className="hp-hint">{tr ? 'Claude Desktop, Ollama veya LM Studio' : 'Claude Desktop, Ollama or LM Studio'}</div>
          </div>

          <div className="hp-plate" style={{ background: 'var(--color-paper)', boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
              <Database size={14} />
              <span>{tr ? 'Araç 1 · Veri Motoru' : 'Tool 1 · Data Engine'}</span>
            </div>
            <div className="hp-kpi-val hp-mono" style={{ marginTop: 'var(--space-2xs)', fontSize: 'var(--text-md)' }}>analyze_bap_data</div>
            <div className="hp-hint">{tr ? 'CSV / Excel / Read-Only SQLite özeti' : 'CSV / Excel / Read-Only SQLite stats'}</div>
          </div>

          <div className="hp-plate" style={{ background: 'var(--color-paper)', boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>
              <FileText size={14} />
              <span>{tr ? 'Araç 2 · Literatür' : 'Tool 2 · Literature'}</span>
            </div>
            <div className="hp-kpi-val hp-mono" style={{ marginTop: 'var(--space-2xs)', fontSize: 'var(--text-md)' }}>read_literature_pdf</div>
            <div className="hp-hint">{tr ? 'Sayfa atıflı yerel PDF sentezi' : 'Page-cited local PDF synthesis'}</div>
          </div>
        </div>
      </section>

      <div className="hp-grid-2">
        <section className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>
                {tr ? 'Dinamik MCP Kaynağı: bap_project_schema' : 'Dynamic MCP Resource: bap_project_schema'}
              </h2>
              <p className="hp-hint" style={{ margin: 0 }}>
                <span className="hp-mono">bap://project/schema</span> · {tr ? 'LLM’e yalnızca değişken sözlüğü ve istatistiksel sınırlar verilir.' : 'Exposes variable metadata without raw participant rows.'}
              </p>
            </div>
            {datasets.length > 0 && (
              <select
                className="hp-select"
                style={{ width: 'auto', minWidth: '210px' }}
                aria-label={tr ? 'Önizlenecek veri seti' : 'Dataset to preview'}
                value={activeDataset?.id ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name} (N={ds.rows.length})
                  </option>
                ))}
              </select>
            )}
          </div>

          {schemaPreview && (
            <pre className="hp-code-block" style={{ maxHeight: '340px' }}>
              {JSON.stringify(schemaPreview, null, 2)}
            </pre>
          )}
        </section>

        <section className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>
                {tr ? 'Akademisyenler İçin Otomatik Kurulum (3 Adım)' : 'Zero-Config Setup for Researchers (3 Steps)'}
              </h2>
              <p className="hp-hint" style={{ margin: 0 }}>
                {tr
                  ? 'JSON düzenlemeden tek tıkla Claude Desktop bağlantısı ve veri klasörü kurun.'
                  : 'Connect Claude Desktop and your local research folder automatically without editing JSON.'}
              </p>
            </div>
            <div className="hp-tabs" role="tablist">
              {(['macos', 'windows', 'linux'] as OsTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={osTab === tab}
                  className={osTab === tab ? 'hp-tab is-active' : 'hp-tab'}
                  onClick={() => setOsTab(tab)}
                >
                  {tab === 'macos' ? 'macOS' : tab === 'windows' ? 'Windows' : 'Linux'}
                </button>
              ))}
            </div>
          </div>

          <ol
            style={{
              margin: 0,
              paddingLeft: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-xs)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-ink-2)',
            }}
          >
            <li>
              <strong>{tr ? 'Otomatik Kurulumu Çalıştırın:' : 'Run Automatic Setup:'}</strong>{' '}
              {tr ? 'Proje klasöründeki ' : 'Double-click '}
              <code className="hp-mono">{launcherFile}</code>
              {tr ? ' dosyasına çift tıklayın (veya terminalde ' : ' (or run '}
              <code className="hp-mono">npm run kurulum</code>
              {tr ? ' yazın).' : ').'}
            </li>
            <li>
              <strong>{tr ? 'Dosyalarınızı Sürükleyip Bırakın:' : 'Drop Your Research Files:'}</strong>{' '}
              {tr ? 'Oluşturulan ' : 'Place CSV/Excel/SQLite datasets inside '}
              <code className="hp-mono">arastirma-verilerim/</code>
              {tr ? ' klasörüne anketlerinizi, ' : ' and literature PDFs inside '}
              <code className="hp-mono">arastirma-verilerim/literatur/</code>
              {tr ? ' klasörüne makale PDF’lerini bırakın.' : '.'}
            </li>
            <li>
              <strong>{tr ? 'Claude Desktop’ı Yeniden Başlatın:' : 'Restart Claude Desktop:'}</strong>{' '}
              {tr
                ? 'Sihirbaz Claude Desktop ayarlarını kendisi yazar; uygulamayı kapatıp açtığınızda Hypotheca araçları hazır olur.'
                : 'The wizard writes your Claude Desktop configuration automatically; restart Claude Desktop and start analyzing.'}
            </li>
          </ol>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-xs)',
              padding: 'var(--space-xs) var(--space-sm)',
              borderRadius: 'var(--radius-control)',
              background: 'var(--color-paper)',
              border: 'var(--rule-hair) solid var(--color-rule)',
              fontSize: 'var(--text-xs)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <FolderOpen size={14} />
              <code className="hp-mono">npm run kurulum</code>
            </span>
            <button
              type="button"
              className="hp-btn hp-btn-sm"
              onClick={() => handleCopy('kurulum-cmd', 'npm run kurulum')}
            >
              {copiedKey === 'kurulum-cmd' ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedKey === 'kurulum-cmd' ? (tr ? 'Kopyalandı' : 'Copied') : tr ? 'Komutu Kopyala' : 'Copy Command'}</span>
            </button>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--color-muted)', fontWeight: 600 }}>
              {tr ? 'Gelişmiş: Manuel claude_desktop_config.json Yapılandırması' : 'Advanced: Manual claude_desktop_config.json'}
            </summary>
            <div style={{ marginTop: 'var(--space-xs)', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="hp-btn hp-btn-sm"
                  onClick={() => handleCopy('claude-cfg', CLAUDE_CONFIG_SNIPPET)}
                >
                  {copiedKey === 'claude-cfg' ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedKey === 'claude-cfg' ? (tr ? 'Kopyalandı' : 'Copied') : tr ? 'JSON Kopyala' : 'Copy JSON'}</span>
                </button>
              </div>
              <pre className="hp-code-block">{CLAUDE_CONFIG_SNIPPET}</pre>
            </div>
          </details>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', marginTop: 'var(--space-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              <Sparkles size={15} />
              <span>{tr ? 'Agentic (Otonom) İş Akışı İstem Şablonları' : 'Agentic Workflow Prompt Templates'}</span>
            </div>
            {promptTemplates.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: 'var(--space-sm)',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--color-paper)',
                  border: 'var(--rule-hair) solid var(--color-rule)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2xs)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-xs)' }}>
                  <strong style={{ fontSize: 'var(--text-xs)' }}>{item.title}</strong>
                  <button
                    type="button"
                    className="hp-btn hp-btn-sm hp-btn-ghost"
                    onClick={() => handleCopy(item.id, item.prompt)}
                  >
                    {copiedKey === item.id ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedKey === item.id ? (tr ? 'Kopyalandı' : 'Copied') : tr ? 'Kopyala' : 'Copy'}</span>
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>{item.prompt}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {sessionState === 'worker' && teamEnabled && user?.role === 'principal_investigator' && (
        <section className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
            <Users size={16} />
            <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>
              {tr ? 'Araştırma Ekibi Yönetimi (Tek Tıkla Üye Ekle)' : 'Research Team Management'}
            </h2>
          </div>
          <p className="hp-hint" style={{ margin: 0 }}>
            {tr
              ? 'Komut satırı gerekmeden BAP projenize ortak araştırmacı veya araştırma görevlisi hesabı ekleyin.'
              : 'Add co-researchers or assistants to your BAP project directly from the browser.'}
          </p>

          {teamMessage && (
            <div className={teamMessage.kind === 'ok' ? 'hp-alert hp-alert-info' : 'hp-alert'} role="status">
              {teamMessage.text}
            </div>
          )}

          <form onSubmit={handleAddTeamMember} className="hp-grid-4" style={{ alignItems: 'end' }}>
            <div className="hp-field">
              <label className="hp-label" htmlFor="team-name">{tr ? 'Ad Soyad' : 'Full name'}</label>
              <input
                id="team-name"
                className="hp-input"
                type="text"
                placeholder="Arş. Gör. Eren Demir"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                required
              />
            </div>
            <div className="hp-field">
              <label className="hp-label" htmlFor="team-user">{tr ? 'Kullanıcı Adı' : 'Username'}</label>
              <input
                id="team-user"
                className="hp-input"
                type="text"
                placeholder="eren.arastirmaci"
                value={newMemberUsername}
                onChange={(e) => setNewMemberUsername(e.target.value)}
                required
              />
            </div>
            <div className="hp-field">
              <label className="hp-label" htmlFor="team-pass">{tr ? 'Geçici Parola (en az 8 kr.)' : 'Password (min 8 chars)'}</label>
              <input
                id="team-pass"
                className="hp-input"
                type="password"
                placeholder="••••••••"
                value={newMemberPassword}
                onChange={(e) => setNewMemberPassword(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
              <select
                className="hp-select"
                aria-label={tr ? 'Araştırmacı rolü' : 'Researcher role'}
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value as 'co_researcher' | 'research_assistant')}
              >
                <option value="co_researcher">{tr ? 'Ortak Araştırmacı' : 'Co-Researcher'}</option>
                <option value="research_assistant">{tr ? 'Araştırma Görevlisi' : 'Research Assistant'}</option>
              </select>
              <button type="submit" className="hp-btn hp-btn-primary" disabled={addingMember} style={{ flexShrink: 0 }}>
                <UserPlus size={14} />
                <span>{addingMember ? (tr ? 'Ekleniyor...' : 'Adding...') : tr ? 'Ekle' : 'Add'}</span>
              </button>
            </div>
          </form>

          {teamMembers.length > 0 && (
            <div className="hp-table-wrap">
              <table className="hp-table">
                <thead>
                  <tr>
                    <th>{tr ? 'Ad Soyad' : 'Name'}</th>
                    <th>{tr ? 'Kullanıcı Adı' : 'Username'}</th>
                    <th>{tr ? 'Rol' : 'Role'}</th>
                    <th>{tr ? 'Proje Kodu' : 'Project'}</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((m) => (
                    <tr key={m.username}>
                      <td>{m.name}</td>
                      <td className="hp-mono">{m.username}</td>
                      <td>{m.role}</td>
                      <td>{m.bapProject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {descriptivePreview && descriptivePreview.tables[0] && (
        <section className="hp-plate" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <Terminal size={16} />
              <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>
                {tr
                  ? `Canlı Ön İzleme · analyze_bap_data (${activeDataset?.name})`
                  : `Live Preview · analyze_bap_data (${activeDataset?.name})`}
              </h2>
            </div>
            <button
              type="button"
              className="hp-btn hp-btn-sm"
              onClick={() => setShowDescriptives((v) => !v)}
            >
              {showDescriptives ? (tr ? 'Gizle' : 'Hide') : tr ? 'Göster' : 'Show'}
            </button>
          </div>
          <SpecTable table={descriptivePreview.tables[0]} lang={lang} />
        </section>
      )}
    </div>
  );
};
