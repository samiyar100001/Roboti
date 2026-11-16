import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Users,
  ShieldAlert,
  KeyRound,
  Sliders,
  Terminal,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Play,
  RotateCcw,
} from 'lucide-react';

type TabId =
  | 'overview'
  | 'users'
  | 'requests'
  | 'wizard'
  | 'config'
  | 'simulator';

type AccountLane = 'REAL' | 'TEST';

interface MtProtoAccountState {
  accountId: AccountLane;
  apiId: number | null;
  hasApiHash: boolean;
  phoneMasked: string | null;
  hasEncryptedSession: boolean;
  connectionStatus: string;
  authStatus: string;
  supportModeLocked: boolean;
  destQuotaRemaining: number | null;
  destExpiryDays: number | null;
  floodWaitUntil: number | null;
  lastConnectedAt: number | null;
  updatedAt: number;
}

interface TelemetrySnapshot {
  timestamp: number;
  sqliteWalMode: string;
  queue: {
    realLaneWaiting: number;
    testLaneWaiting: number;
    realWorkerBusy: boolean;
    testWorkerBusy: boolean;
    queuePaused: boolean;
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyP99Ms: number;
  };
  accounts: Record<AccountLane, MtProtoAccountState>;
  system: {
    rssMb: number;
    heapUsedMb: number;
    uptimeSeconds: number;
  };
  inventoryStats: {
    validatorsCount: number;
    dataSourcesCount: number;
    subSectionsCount: number;
    canonicalFieldsCount: number;
  };
  recentAlerts: Array<{ id: string; text: string; createdAt: number }>;
}

const EXAMPLE_1_PAYLOAD = `✅ نتایج برای 09123456789:
در حال ارسال نتایج (2 رکورد)...
بخش 1:
📂 دیتابیس بانک ملت
👤 نام: علی
👤 نامخانوادگی: محمدی
👪 نام پدر: حسن
🆔 کد ملی: 0012345678
📱 شماره موبایل: 09123456789
💳 شماره کارت: 6104337803287067
🏦 شماره حساب: 1234567890
───────────────────────────
📂 دیتابیس فروشندگان ترب
👤 اطلاعات کاربر:
👤 نام کامل: علی محمدی
📞 تلفن ثابت: 02188776655
🌍 استان: تهران
🏙 شهر: تهران
📮 کدپستی: 1415563111
📅 تاریخ عضویت در ترب: 1401/05/12
🔸 فیلد ۹: تایید شده`;

const SECTION_3_SUPPORT_PAYLOAD = `✅ حالت پشتیبانی فعال شد / از این لحظه هر پیامی ارسال کنی برای ادمین میره. / برای خروج: /exit /cancel`;

const SECTION_4_QUOTA_PAYLOAD = `⚠️ تعداد جستجوهای شما به پایان رسیده است!
پکیج جدید تهیه کنید تا جستجوی بیشتری داشته باشید.`;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState<boolean>(false);

  // Tab 2: Users & Financial Ledger state
  const [userSearch, setUserSearch] = useState('');
  const [usersList, setUsersList] = useState<Array<Record<string, unknown>>>([]);
  const [txList, setTxList] = useState<Array<Record<string, unknown>>>([]);
  const [subTargetUserId, setSubTargetUserId] = useState('3088415');
  const [subCreditsToAdd, setSubCreditsToAdd] = useState('50');
  const [subReason, setSubReason] = useState('Activated 50-credit package (Trial zeroed atomically)');
  const [userActionNotice, setUserActionNotice] = useState<string | null>(null);

  // Tab 3: Requests & Quarantine state
  const [requestsList, setRequestsList] = useState<Array<Record<string, unknown>>>([]);
  const [quarantineList, setQuarantineList] = useState<Array<Record<string, unknown>>>([]);
  const [laneFilter, setLaneFilter] = useState<'ALL' | 'REAL' | 'TEST'>('ALL');

  // Tab 4: Secrets Checklist & Session Wizard
  const [secretsList, setSecretsList] = useState<Array<Record<string, unknown>>>([]);
  const [wizardLane, setWizardLane] = useState<AccountLane>('REAL');
  const [wizardApiId, setWizardApiId] = useState('28491024');
  const [wizardApiHash, setWizardApiHash] = useState('a1b2c3d4e5f60718293a4b5c6d7e8f90');
  const [wizardPhone, setWizardPhone] = useState('+989123456789');
  const [wizardOtp, setWizardOtp] = useState('54921');
  const [wizard2Fa, setWizard2Fa] = useState('');
  const [wizardNotice, setWizardNotice] = useState<string | null>(null);

  // Tab 5: Configuration Studio
  const [activeConfig, setActiveConfig] = useState<Record<string, unknown> | null>(null);
  const [configHistory, setConfigHistory] = useState<Array<Record<string, unknown>>>([]);
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [cfgReason, setCfgReason] = useState('Adjusted timeout & validation policy via Config Studio');
  const [cfgNotice, setCfgNotice] = useState<string | null>(null);

  // Tab 6: Operational Simulator
  const [simCategory, setSimCategory] = useState<string>('PHONE');
  const [simInput, setSimInput] = useState<string>('۰۹۱۲۳۴۵۶۷۸۹');
  const [simValidationResult, setSimValidationResult] = useState<Record<string, unknown> | null>(null);
  const [simLane, setSimLane] = useState<AccountLane>('REAL');
  const [simBehavior, setSimBehavior] = useState<
    'BEHAVIOR_A_DELETE_AND_SEND' | 'BEHAVIOR_B_IN_PLACE_EDIT'
  >('BEHAVIOR_B_IN_PLACE_EDIT');
  const [simPayloadText, setSimPayloadText] = useState<string>(EXAMPLE_1_PAYLOAD);
  const [simPipelineResult, setSimPipelineResult] = useState<Record<string, unknown> | null>(null);

  const safeFetchJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T | null> => {
      try {
        const res = await fetch(url, init);
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          return null;
        }
        const text = await res.text();
        if (!text.trim()) {
          return null;
        }
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
    []
  );

  const fetchTelemetry = useCallback(async () => {
    const data = await safeFetchJson<TelemetrySnapshot>('/api/telemetry');
    if (data) {
      setTelemetry(data);
    }
  }, [safeFetchJson]);

  const fetchUsers = useCallback(
    async (query?: string) => {
      const url = query ? `/api/users?q=${encodeURIComponent(query)}` : '/api/users';
      const data = await safeFetchJson<{
        users: Array<Record<string, unknown>>;
        transactions: Array<Record<string, unknown>>;
      }>(url);
      if (data) {
        setUsersList(Array.isArray(data.users) ? data.users : []);
        setTxList(Array.isArray(data.transactions) ? data.transactions : []);
      }
    },
    [safeFetchJson]
  );

  const fetchRequestsAndQuarantine = useCallback(
    async (lane: 'ALL' | 'REAL' | 'TEST') => {
      const url = lane === 'ALL' ? '/api/requests' : `/api/requests?lane=${lane}`;
      const data = await safeFetchJson<{
        requests: Array<Record<string, unknown>>;
        quarantined: Array<Record<string, unknown>>;
      }>(url);
      if (data) {
        setRequestsList(Array.isArray(data.requests) ? data.requests : []);
        setQuarantineList(Array.isArray(data.quarantined) ? data.quarantined : []);
      }
    },
    [safeFetchJson]
  );

  const fetchSecretsChecklist = useCallback(async () => {
    const data = await safeFetchJson<{
      checklist?: { items?: Array<Record<string, unknown>> };
    }>('/api/secrets-checklist');
    if (data?.checklist?.items) {
      setSecretsList(data.checklist.items);
    }
  }, [safeFetchJson]);

  const fetchConfigStudio = useCallback(async () => {
    const data = await safeFetchJson<{
      activeConfig: Record<string, unknown>;
      history: Array<Record<string, unknown>>;
      auditLogs: Array<Record<string, unknown>>;
    }>('/api/config');
    if (data) {
      setActiveConfig(data.activeConfig ?? null);
      setConfigHistory(Array.isArray(data.history) ? data.history : []);
      setAuditLogs(Array.isArray(data.auditLogs) ? data.auditLogs : []);
    }
  }, [safeFetchJson]);

  useEffect(() => {
    void fetchTelemetry();
    void fetchUsers();
    void fetchRequestsAndQuarantine('ALL');
    void fetchSecretsChecklist();
    void fetchConfigStudio();

    let ev: EventSource | null = null;
    try {
      ev = new EventSource('/api/telemetry/stream');
      ev.onopen = () => setSseConnected(true);
      ev.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data) as TelemetrySnapshot;
          setTelemetry(parsed);
          setSseConnected(true);
        } catch {
          // ignore parse error
        }
      };
      ev.onerror = () => setSseConnected(false);
    } catch {
      setSseConnected(false);
    }
    return () => {
      ev?.close();
    };
  }, [
    fetchTelemetry,
    fetchUsers,
    fetchRequestsAndQuarantine,
    fetchSecretsChecklist,
    fetchConfigStudio,
  ]);

  const handleActivateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserActionNotice(null);
    const data = await safeFetchJson<{ ok: boolean; error?: string }>('/api/users/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: Number(subTargetUserId),
        creditsToAdd: Number(subCreditsToAdd),
        subscriptionDays: 30,
        reason: subReason,
      }),
    });
    if (data?.ok) {
      setUserActionNotice(
        `Subscription activated for User ${subTargetUserId}. Trial quota atomically zeroed (trial_remaining = 0, trial_disabled = 1) and +${subCreditsToAdd} paid credits recorded.`
      );
      await fetchUsers(userSearch);
    } else {
      setUserActionNotice(`Error: ${data?.error ?? 'Request failed'}`);
    }
  };

  const handleRunValidator = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await safeFetchJson<{ validation: Record<string, unknown> }>(
      '/api/simulator/validate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: simCategory, rawInput: simInput }),
      }
    );
    if (data?.validation) {
      setSimValidationResult(data.validation);
    }
  };

  const handleRunPipelineSimulation = async () => {
    const data = await safeFetchJson<Record<string, unknown>>('/api/simulator/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lane: simLane,
        behaviorMode: simBehavior,
        rawDestinationChunks: [simPayloadText],
        category: simCategory,
        rawQueryInput: simInput,
      }),
    });
    if (data) {
      setSimPipelineResult(data);
      await fetchTelemetry();
      await fetchRequestsAndQuarantine(laneFilter);
      await fetchUsers(userSearch);
    }
  };

  const handleUpdateConfig = async (partialUpdate: Record<string, unknown>) => {
    setCfgNotice(null);
    const data = await safeFetchJson<{
      ok: boolean;
      error?: string;
      activeConfig?: Record<string, unknown>;
      history?: Array<Record<string, unknown>>;
      auditLogs?: Array<Record<string, unknown>>;
    }>('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partialUpdate, reason: cfgReason }),
    });
    if (data?.ok && data.activeConfig) {
      setActiveConfig(data.activeConfig);
      if (data.history) setConfigHistory(data.history);
      if (data.auditLogs) setAuditLogs(data.auditLogs);
      setCfgNotice('Configuration snapshot persisted and activated in SQLite WAL.');
    } else {
      setCfgNotice(`Error: ${data?.error ?? 'Failed to update configuration'}`);
    }
  };

  const handleRollbackVersion = async (versionNum: number) => {
    const data = await safeFetchJson<{
      ok: boolean;
      activeConfig?: Record<string, unknown>;
      history?: Array<Record<string, unknown>>;
      auditLogs?: Array<Record<string, unknown>>;
    }>('/api/config/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetVersionNumber: versionNum,
        reason: `Rollback to version #${versionNum}`,
      }),
    });
    if (data?.ok && data.activeConfig) {
      setActiveConfig(data.activeConfig);
      if (data.history) setConfigHistory(data.history);
      if (data.auditLogs) setAuditLogs(data.auditLogs);
      setCfgNotice(`Rolled back active configuration to snapshot v${versionNum}.`);
    }
  };

  const handleWizardPhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWizardNotice(null);
    const data = await safeFetchJson<{ ok: boolean; error?: string }>(
      '/api/mtproto/wizard/phone',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane: wizardLane,
          apiId: Number(wizardApiId),
          apiHash: wizardApiHash,
          phoneNumber: wizardPhone,
        }),
      }
    );
    if (data?.ok) {
      setWizardNotice(
        `Step 1 complete for ${wizardLane} lane. API_HASH encrypted via AES-256-GCM. Awaiting OTP code.`
      );
      await fetchTelemetry();
    } else {
      setWizardNotice(`Error: ${data?.error ?? 'Failed to submit phone credentials'}`);
    }
  };

  const handleWizardOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await safeFetchJson<{ ok: boolean; error?: string }>(
      '/api/mtproto/wizard/otp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lane: wizardLane,
          otpCode: wizardOtp,
          requires2Fa: wizard2Fa.trim().length > 0,
        }),
      }
    );
    if (data?.ok) {
      setWizardNotice(
        `MTProto StringSession for ${wizardLane} lane encrypted with AES-256-GCM and stored in SQLite mtproto_accounts.`
      );
      await fetchTelemetry();
    } else {
      setWizardNotice(`Error: ${data?.error ?? 'Failed to verify OTP code'}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Bar Contract: Zone 1 (Wordmark) - Zone 2 (Concise Nav Links) - Zone 3 (Primary Action) */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-slate-900">
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          Sovereign Relay Platform
        </a>

        <nav
          aria-label="Primary sections"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300"
        >
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'overview' ? 'text-white underline underline-offset-8' : ''
            }`}
          >
            Operations
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'users' ? 'text-white underline underline-offset-8' : ''
            }`}
          >
            Financial Ledger
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'requests' ? 'text-white underline underline-offset-8' : ''
            }`}
          >
            Quarantine
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'config' ? 'text-white underline underline-offset-8' : ''
            }`}
          >
            Config Studio
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('simulator')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'simulator' ? 'text-white underline underline-offset-8' : ''
            }`}
          >
            Simulator
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('simulator')}
            className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0"
          >
            Open Simulator
          </button>
        </div>
      </header>

      {/* Main Workspace Canvas: 272px Sidebar + Main Content Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row">
        <aside className="w-full lg:w-[272px] border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between shrink-0">
          <div className="space-y-1">
            <div className="px-3 py-2 text-xs font-medium text-slate-400">
              Unified Admin Console
            </div>
            {(
              [
                { id: 'overview', label: '01. Executive Overview', icon: Activity },
                { id: 'users', label: '02. User & Credit Ledger', icon: Users },
                { id: 'requests', label: '03. Request & Quarantine', icon: ShieldAlert },
                { id: 'wizard', label: '04. Session & Secrets', icon: KeyRound },
                { id: 'config', label: '05. Configuration Studio', icon: Sliders },
                { id: 'simulator', label: '06. Pipeline Simulator', icon: Terminal },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800 px-3 text-xs text-slate-400 space-y-1.5">
            <div className="flex items-center justify-between">
              <span>SSE Stream</span>
              <span className="font-mono text-slate-200">
                {sseConnected ? 'Connected' : 'Reconnecting'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>SQLite Mode</span>
              <span className="font-mono uppercase text-slate-200">
                {telemetry?.sqliteWalMode ?? 'WAL'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Memory RSS</span>
              <span className="font-mono tabular-nums text-slate-200">
                {telemetry?.system.rssMb ?? 0} MB
              </span>
            </div>
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-8">
          {/* TAB 1: EXECUTIVE OVERVIEW & DUAL-LANE QUEUE */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">
                    Executive Overview &amp; Dual-Lane MTProto Telemetry
                  </h1>
                  <p className="text-sm text-slate-400 mt-1">
                    Strict Single-Concurrency Isolation (`REAL_LANE` vs `TEST_LANE`) · Zero Account Fallback · AES-256-GCM Encrypted Sessions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchTelemetry()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh Snapshot
                </button>
              </div>

              {/* 4-Column KPI Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="text-xs text-slate-400">REAL_LANE Queue (Paid/Sub)</div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums mt-2">
                    {telemetry?.queue.realLaneWaiting ?? 0} waiting
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    Worker: {telemetry?.queue.realWorkerBusy ? 'Busy (1/1)' : 'Idle (0/1)'} · Concurrency = 1
                  </div>
                </div>

                <div className="p-5 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="text-xs text-slate-400">TEST_LANE Queue (Free Trial)</div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums mt-2">
                    {telemetry?.queue.testLaneWaiting ?? 0} waiting
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    Worker: {telemetry?.queue.testWorkerBusy ? 'Busy (1/1)' : 'Idle (0/1)'} · Concurrency = 1
                  </div>
                </div>

                <div className="p-5 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="text-xs text-slate-400">Pipeline Latency (P50 / P95)</div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums mt-2">
                    {telemetry?.queue.latencyP50Ms ?? 0}ms / {telemetry?.queue.latencyP95Ms ?? 0}ms
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    P99: {telemetry?.queue.latencyP99Ms ?? 0}ms · Collection Window: 5,000ms
                  </div>
                </div>

                <div className="p-5 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="text-xs text-slate-400">Lexical &amp; Canonical Coverage</div>
                  <div className="text-2xl font-bold text-white font-mono tabular-nums mt-2">
                    14 DBs · 73 Fields
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    9 Validators · 76 Emojis · Section 3/4 Firewall
                  </div>
                </div>
              </div>

              {/* Dual Account Isolation Status Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white">
                    Intermediary MTProto User Accounts (`mtproto_accounts`)
                  </h2>
                  <span className="text-xs text-slate-400">
                    ADR-03 Zero-Fallback Isolation Enforced
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-400">
                        <th className="py-3 px-6">Account Lane</th>
                        <th className="py-3 px-6">Connection State</th>
                        <th className="py-3 px-6">Auth Status</th>
                        <th className="py-3 px-6">Support Mode (/db)</th>
                        <th className="py-3 px-6 text-right">Dest Quota Remaining</th>
                        <th className="py-3 px-6 text-right">Dest Expiry (Days)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono tabular-nums">
                      {(['REAL', 'TEST'] as const).map((lane) => {
                        const acc = telemetry?.accounts[lane];
                        return (
                          <tr key={lane} className="hover:bg-slate-800/40">
                            <td className="py-3.5 px-6 font-semibold text-white">
                              {lane}_ACCOUNT
                            </td>
                            <td className="py-3.5 px-6 text-slate-200">
                              {acc?.connectionStatus ?? 'CONNECTED'}
                            </td>
                            <td className="py-3.5 px-6 text-slate-300">
                              {acc?.authStatus ?? 'AUTHENTICATED'}
                            </td>
                            <td className="py-3.5 px-6 text-slate-300">
                              {acc?.supportModeLocked ? 'LOCKED (Self-Healing /cancel)' : 'Normal'}
                            </td>
                            <td className="py-3.5 px-6 text-right text-slate-200">
                              {acc?.destQuotaRemaining ?? '—'}
                            </td>
                            <td className="py-3.5 px-6 text-right text-slate-200">
                              {acc?.destExpiryDays ?? '—'} days
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

          {/* TAB 2: USER, SUBSCRIPTION & ATOMIC FINANCIAL LEDGER */}
          {activeTab === 'users' && (
            <div className="space-y-8">
              <div className="border-b border-slate-800 pb-5">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  User, Subscription &amp; Atomic Financial Control
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Idempotent `BEGIN IMMEDIATE` Ledger · Activating Subscription Atomically Sets `trial_remaining = 0` &amp; `trial_disabled = 1`
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <form
                  onSubmit={handleActivateSubscription}
                  className="p-6 bg-slate-900 border border-slate-800 rounded-lg space-y-4"
                >
                  <h2 className="text-base font-semibold text-white">
                    Activate Subscription &amp; Add Credits
                  </h2>
                  <div>
                    <label
                      htmlFor="sub-user-id"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Telegram User ID
                    </label>
                    <input
                      id="sub-user-id"
                      type="text"
                      value={subTargetUserId}
                      onChange={(e) => setSubTargetUserId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm font-mono text-white"
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sub-credits"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Paid Credits to Add
                    </label>
                    <input
                      id="sub-credits"
                      type="number"
                      value={subCreditsToAdd}
                      onChange={(e) => setSubCreditsToAdd(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm font-mono text-white"
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sub-reason"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Mandatory Audit Reason
                    </label>
                    <input
                      id="sub-reason"
                      type="text"
                      value={subReason}
                      onChange={(e) => setSubReason(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
                  >
                    Activate Subscription (Zero Trial + Add Credits)
                  </button>
                  {userActionNotice && (
                    <p className="text-xs text-emerald-400 leading-relaxed">{userActionNotice}</p>
                  )}
                </form>

                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
                    <h2 className="text-base font-semibold text-white">Registered Users (`users`)</h2>
                    <input
                      type="search"
                      aria-label="Search users"
                      placeholder="Filter by ID or username..."
                      value={userSearch}
                      onChange={(e) => {
                        setUserSearch(e.target.value);
                        void fetchUsers(e.target.value);
                      }}
                      className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-xs text-slate-400">
                          <th className="py-3 px-4">Telegram ID</th>
                          <th className="py-3 px-4">Name / Username</th>
                          <th className="py-3 px-4">Account Tier</th>
                          <th className="py-3 px-4 text-right">Trial Remaining</th>
                          <th className="py-3 px-4 text-right">Paid Credits</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-mono tabular-nums text-xs">
                        {usersList.map((u) => (
                          <tr key={String(u.telegramId)} className="hover:bg-slate-800/40">
                            <td className="py-3 px-4 text-white">{String(u.telegramId)}</td>
                            <td className="py-3 px-4 font-sans text-slate-200">
                              {String(u.firstName ?? '—')} · @{String(u.username ?? 'none')}
                            </td>
                            <td className="py-3 px-4 text-slate-300">
                              {u.subscriptionActive ? 'SUBSCRIBED (REAL_LANE)' : 'TRIAL (TEST_LANE)'}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-300">
                              {String(u.trialRemaining)} / {String(u.trialInitial)}{' '}
                              {u.trialDisabled ? '(Disabled)' : ''}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-white">
                              {String(u.paidCredits)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Immutable Credit Transactions Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800">
                  <h2 className="text-base font-semibold text-white">
                    Immutable Financial &amp; Trial-Zeroing Ledger (`credit_transactions`)
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-3 px-4">User ID</th>
                        <th className="py-3 px-4">Tx Type</th>
                        <th className="py-3 px-4 text-right">Delta</th>
                        <th className="py-3 px-4 text-right">Before → After</th>
                        <th className="py-3 px-4">Idempotency Key</th>
                        <th className="py-3 px-4">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {txList.slice(0, 12).map((tx) => (
                        <tr key={String(tx.txId)} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-4 text-white">{String(tx.telegramId)}</td>
                          <td className="py-2.5 px-4 text-slate-200">{String(tx.txType)}</td>
                          <td className="py-2.5 px-4 text-right text-slate-200">
                            {Number(tx.amountDelta) > 0 ? `+${tx.amountDelta}` : String(tx.amountDelta)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-300">
                            {String(tx.balanceBefore)} → {String(tx.balanceAfter)}
                          </td>
                          <td className="py-2.5 px-4 text-slate-400 truncate max-w-xs">
                            {String(tx.idempotencyKey)}
                          </td>
                          <td className="py-2.5 px-4 font-sans text-slate-300">
                            {String(tx.notes ?? '')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: REQUEST LIFECYCLE & QUARANTINE INSPECTOR */}
          {activeTab === 'requests' && (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">
                    18-Step Request Lifecycle &amp; Late-Response Quarantine Inspector
                  </h1>
                  <p className="text-sm text-slate-400 mt-1">
                    PII Masked by Default · Zero Deduction on `NO_RESULTS_FOUND`, `TIMED_OUT`, `CANCELLED` &amp; `TEMPORARILY_UNAVAILABLE`
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                  {(['ALL', 'REAL', 'TEST'] as const).map((lf) => (
                    <button
                      key={lf}
                      type="button"
                      onClick={() => {
                        setLaneFilter(lf);
                        void fetchRequestsAndQuarantine(lf);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        laneFilter === lf
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {lf === 'ALL' ? 'All Lanes' : `${lf}_LANE`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800">
                  <h2 className="text-base font-semibold text-white">
                    Recent Search Requests (`requests`)
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-3 px-4">Ref Code</th>
                        <th className="py-3 px-4">Lane</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4">Masked Input</th>
                        <th className="py-3 px-4">Lifecycle State</th>
                        <th className="py-3 px-4 text-right">Deducted</th>
                        <th className="py-3 px-4 text-right">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {requestsList.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 px-6 text-center font-sans text-slate-400">
                            No requests logged yet. Run a test in the Pipeline Simulator tab to inspect live 18-step transitions.
                          </td>
                        </tr>
                      ) : (
                        requestsList.map((r) => (
                          <tr key={String(r.requestId)} className="hover:bg-slate-800/40">
                            <td className="py-3 px-4 font-semibold text-white">
                              {String(r.referenceCode)}
                            </td>
                            <td className="py-3 px-4 text-slate-300">{String(r.accountLane)}</td>
                            <td className="py-3 px-4 text-slate-300">{String(r.inputCategory)}</td>
                            <td className="py-3 px-4 text-slate-300">{String(r.rawInputMasked)}</td>
                            <td className="py-3 px-4 text-slate-200">{String(r.state)}</td>
                            <td className="py-3 px-4 text-right text-slate-200">
                              {String(r.quotaOrCreditDeducted)}
                            </td>
                            <td className="py-3 px-4 text-right text-slate-400">
                              {r.processingDurationMs ? `${r.processingDurationMs}ms` : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800">
                  <h2 className="text-base font-semibold text-white">
                    Quarantined Destination Payloads (`quarantined_responses`)
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-3 px-4">Lane</th>
                        <th className="py-3 px-4">Quarantine Reason</th>
                        <th className="py-3 px-4">Dest Msg ID</th>
                        <th className="py-3 px-4">Decrypted Intercepted Payload</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {quarantineList.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 px-6 text-center font-sans text-slate-400">
                            No quarantined payloads yet. Trigger Section 3/4 Firewall interception in the Simulator tab.
                          </td>
                        </tr>
                      ) : (
                        quarantineList.map((q) => (
                          <tr key={String(q.quarantineId)} className="hover:bg-slate-800/40">
                            <td className="py-3 px-4 text-white">{String(q.accountLane)}</td>
                            <td className="py-3 px-4 text-amber-400">
                              {String(q.quarantineReason)}
                            </td>
                            <td className="py-3 px-4 text-slate-300">
                              {String(q.destMsgId ?? '—')}
                            </td>
                            <td className="py-3 px-4 font-sans text-slate-300 max-w-xl truncate">
                              {String(q.rawPayloadDecrypted ?? '')}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MTPROTO SESSION WIZARD & SECRETS CHECKLIST */}
          {activeTab === 'wizard' && (
            <div className="space-y-8">
              <div className="border-b border-slate-800 pb-5">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Guided MTProto Session Wizard &amp; Non-Leaking Secrets Checklist
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Step-by-Step Phone, OTP &amp; 2FA Collection · Immediate AES-256-GCM Encrypted Persistence · Zero Raw Secret Exposure
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Non-Leaking Secrets Checklist */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">
                      Environment Secrets Checklist
                    </h2>
                    <Lock className="w-4 h-4 text-slate-400" />
                  </div>
                  <div className="divide-y divide-slate-800">
                    {secretsList.map((item) => {
                      const valid = Boolean(item.present && item.validFormat);
                      return (
                        <div
                          key={String(item.key)}
                          className="py-3 flex items-center justify-between gap-4"
                        >
                          <div>
                            <div className="text-xs font-mono font-semibold text-white">
                              {String(item.key)}
                            </div>
                            <div className="text-xs text-slate-400">
                              {String(item.description)}
                            </div>
                          </div>
                          <div className="text-xs font-mono shrink-0">
                            {valid ? (
                              <span className="text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                              </span>
                            ) : (
                              <span className="text-amber-400 flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> Ephemeral/Unset
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Guided MTProto Session Wizard */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-5">
                  <h2 className="text-base font-semibold text-white">
                    Interactive GramJS MTProto Session Wizard
                  </h2>

                  <div className="flex items-center gap-2">
                    {(['REAL', 'TEST'] as const).map((lane) => (
                      <button
                        key={lane}
                        type="button"
                        onClick={() => setWizardLane(lane)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          wizardLane === lane
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-950 text-slate-400 border border-slate-800'
                        }`}
                      >
                        Configure {lane}_ACCOUNT
                      </button>
                    ))}
                  </div>

                  <form onSubmit={handleWizardPhoneSubmit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="wiz-api-id"
                          className="block text-xs text-slate-300 mb-1"
                        >
                          MTProto API_ID ({wizardLane})
                        </label>
                        <input
                          id="wiz-api-id"
                          type="number"
                          value={wizardApiId}
                          onChange={(e) => setWizardApiId(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-white"
                          required
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="wiz-phone"
                          className="block text-xs text-slate-300 mb-1"
                        >
                          Phone Number
                        </label>
                        <input
                          id="wiz-phone"
                          type="text"
                          value={wizardPhone}
                          onChange={(e) => setWizardPhone(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-white"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="wiz-api-hash"
                        className="block text-xs text-slate-300 mb-1"
                      >
                        MTProto API_HASH (Encrypted via AES-256-GCM before SQLite storage)
                      </label>
                      <input
                        id="wiz-api-hash"
                        type="password"
                        value={wizardApiHash}
                        onChange={(e) => setWizardApiHash(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-white"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-medium text-white bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      Step 1: Save Encrypted API Credentials &amp; Request OTP
                    </button>
                  </form>

                  <form
                    onSubmit={handleWizardOtpSubmit}
                    className="pt-4 border-t border-slate-800 space-y-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="wiz-otp" className="block text-xs text-slate-300 mb-1">
                          Step 2: OTP Code
                        </label>
                        <input
                          id="wiz-otp"
                          type="text"
                          value={wizardOtp}
                          onChange={(e) => setWizardOtp(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-white"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="wiz-2fa" className="block text-xs text-slate-300 mb-1">
                          Optional 2FA Password
                        </label>
                        <input
                          id="wiz-2fa"
                          type="password"
                          placeholder="Leave blank if no 2FA"
                          value={wizard2Fa}
                          onChange={(e) => setWizard2Fa(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-white"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
                    >
                      Step 2: Verify OTP &amp; Persist AES-256-GCM Session
                    </button>
                  </form>

                  {wizardNotice && (
                    <p className="text-xs text-emerald-400 leading-relaxed">{wizardNotice}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: CONFIGURATION STUDIO & AUDIT TRAIL */}
          {activeTab === 'config' && activeConfig && (
            <div className="space-y-8">
              <div className="border-b border-slate-800 pb-5">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Configuration Studio (Immutable Versioning &amp; One-Click Rollback)
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Zod-Validated SQLite Snapshots · Reconciled Validation Policies · SHA-256 Hash-Chained Audit Trail
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Active Runtime Parameters
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label
                        htmlFor="cfg-tg-policy"
                        className="block text-slate-300 mb-1"
                      >
                        Telegram ID Validation Policy
                      </label>
                      <select
                        id="cfg-tg-policy"
                        value={String(activeConfig.telegramIdValidationPolicy)}
                        onChange={(e) =>
                          setActiveConfig({
                            ...activeConfig,
                            telegramIdValidationPolicy: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                      >
                        <option value="MODERN_10_DIGIT_MAX">MODERN_10_DIGIT_MAX (5..10 digits)</option>
                        <option value="LEGACY_9_DIGIT_MAX">LEGACY_9_DIGIT_MAX (5..9 digits)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="cfg-access-policy"
                        className="block text-slate-300 mb-1"
                      >
                        Access Policy
                      </label>
                      <select
                        id="cfg-access-policy"
                        value={String(activeConfig.accessPolicy)}
                        onChange={(e) =>
                          setActiveConfig({
                            ...activeConfig,
                            accessPolicy: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                      >
                        <option value="PUBLIC_ACCESS">PUBLIC_ACCESS</option>
                        <option value="APPROVED_CUSTOMERS_ONLY">APPROVED_CUSTOMERS_ONLY</option>
                        <option value="OWNER_ONLY">OWNER_ONLY</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="cfg-timeout" className="block text-slate-300 mb-1">
                        Master Timeout (Seconds)
                      </label>
                      <input
                        id="cfg-timeout"
                        type="number"
                        value={Number(activeConfig.requestTimeoutSeconds)}
                        onChange={(e) =>
                          setActiveConfig({
                            ...activeConfig,
                            requestTimeoutSeconds: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-white"
                      />
                    </div>

                    <div>
                      <label htmlFor="cfg-stale" className="block text-slate-300 mb-1">
                        Stale Search Watchdog (30s–60s)
                      </label>
                      <input
                        id="cfg-stale"
                        type="number"
                        value={Number(activeConfig.destinationStaleSearchTimeoutSeconds)}
                        onChange={(e) =>
                          setActiveConfig({
                            ...activeConfig,
                            destinationStaleSearchTimeoutSeconds: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 text-xs">
                    <label className="flex items-center gap-2 text-slate-200">
                      <input
                        type="checkbox"
                        checked={Boolean(activeConfig.enableNationalIdChecksum)}
                        onChange={(e) =>
                          setActiveConfig({
                            ...activeConfig,
                            enableNationalIdChecksum: e.target.checked,
                          })
                        }
                      />
                      Enable Iranian National ID Modulo-11 Checksum
                    </label>
                    <label className="flex items-center gap-2 text-slate-200">
                      <input
                        type="checkbox"
                        checked={Boolean(activeConfig.enableBankCardLuhn)}
                        onChange={(e) =>
                          setActiveConfig({
                            ...activeConfig,
                            enableBankCardLuhn: e.target.checked,
                          })
                        }
                      />
                      Enable 16-Digit Bank Card Luhn Checksum
                    </label>
                    <label className="flex items-center gap-2 text-slate-200">
                      <input
                        type="checkbox"
                        checked={Boolean(activeConfig.strictLegacyIpv4)}
                        onChange={(e) =>
                          setActiveConfig({
                            ...activeConfig,
                            strictLegacyIpv4: e.target.checked,
                          })
                        }
                      />
                      Strict Legacy IPv4 Mode (0..254 instead of 0..255)
                    </label>
                  </div>

                  <div>
                    <label htmlFor="cfg-reason" className="block text-xs text-slate-300 mb-1">
                      Mandatory Change Reason
                    </label>
                    <input
                      id="cfg-reason"
                      type="text"
                      value={cfgReason}
                      onChange={(e) => setCfgReason(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleUpdateConfig(activeConfig)}
                    className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
                  >
                    Save New Version Snapshot
                  </button>

                  {cfgNotice && <p className="text-xs text-emerald-400">{cfgNotice}</p>}
                </div>

                {/* Version History & Rollback */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Version History (`config_versions`)
                  </h2>
                  <div className="divide-y divide-slate-800 text-xs">
                    {configHistory.map((ver) => (
                      <div
                        key={String(ver.versionNumber)}
                        className="py-3 flex items-center justify-between gap-4"
                      >
                        <div>
                          <div className="font-mono font-semibold text-white">
                            v{String(ver.versionNumber)}{' '}
                            {ver.isActive ? '· ACTIVE' : ''}
                          </div>
                          <div className="text-slate-400">{String(ver.changeReason)}</div>
                        </div>
                        {!ver.isActive && (
                          <button
                            type="button"
                            onClick={() => void handleRollbackVersion(Number(ver.versionNumber))}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 rounded-md hover:bg-slate-700 shrink-0"
                          >
                            <RotateCcw className="w-3 h-3" /> Rollback
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: ISOLATED OPERATIONAL SIMULATOR & TEST RUNNER */}
          {activeTab === 'simulator' && (
            <div className="space-y-8">
              <div className="border-b border-slate-800 pb-5">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Operational Simulator: 9 Validators, Behavior A/B Correlation &amp; White-Label AST Renderer
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Test Universal Numeral Normalization, Section 3/4 Anti-Leakage Firewall, and 73-Field Canonical White-Label Tree Output
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column: 9-Category Validator + Pipeline Trigger */}
                <div className="space-y-6">
                  <form
                    onSubmit={handleRunValidator}
                    className="p-6 bg-slate-900 border border-slate-800 rounded-lg space-y-4"
                  >
                    <h2 className="text-base font-semibold text-white">
                      Step 1: Nine-Category Input Validation &amp; Numeral Normalizer
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label
                          htmlFor="sim-category"
                          className="block text-slate-300 mb-1"
                        >
                          Search Category (1–9)
                        </label>
                        <select
                          id="sim-category"
                          value={simCategory}
                          onChange={(e) => setSimCategory(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                        >
                          <option value="PHONE">1. Telephone Number (Iran/Russia)</option>
                          <option value="NATIONAL_ID">2. National ID (10 digits + Mod-11)</option>
                          <option value="TELEGRAM_ID">3. Numeric Telegram ID (5..10 digits)</option>
                          <option value="BANK_CARD">4. Bank Card Number (16 digits + Luhn)</option>
                          <option value="IBAN">5. IBAN (24 digits WITHOUT IR)</option>
                          <option value="IPV4">6. IPv4 Address (0..255 no leading zero)</option>
                          <option value="USERNAME">7. Telegram Username (@...)</option>
                          <option value="EMAIL">8. Email Address</option>
                          <option value="FULL_NAME">9. Full Name (Persian only)</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="sim-input" className="block text-slate-300 mb-1">
                          Raw User Input (Supports Persian ۰-۹)
                        </label>
                        <input
                          id="sim-input"
                          type="text"
                          value={simInput}
                          onChange={(e) => setSimInput(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg font-mono text-white"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-medium text-white bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      Validate &amp; Normalize Input
                    </button>

                    {simValidationResult && (
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs space-y-1">
                        <div className="flex items-center gap-2 font-mono">
                          {simValidationResult.valid ? (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-4 h-4" /> VALID
                            </span>
                          ) : (
                            <span className="text-rose-400 flex items-center gap-1">
                              <XCircle className="w-4 h-4" /> REJECTED (
                              {String(simValidationResult.errorCode)})
                            </span>
                          )}
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-200">
                            Normalized: {String(simValidationResult.normalizedValue)}
                          </span>
                        </div>
                        {!simValidationResult.valid && (
                          <div className="text-slate-300 dir-rtl text-right pt-1">
                            {String(simValidationResult.errorMessageFa)}
                          </div>
                        )}
                      </div>
                    )}
                  </form>

                  {/* Destination Bot Payload Simulator */}
                  <div className="p-6 bg-slate-900 border border-slate-800 rounded-lg space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-white">
                        Step 2: Simulate Destination Bot Payload &amp; Correlation
                      </h2>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSimPayloadText(EXAMPLE_1_PAYLOAD)}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
                      >
                        Load PDF Example 1 (Bank Mellat + Torob)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimPayloadText(SECTION_3_SUPPORT_PAYLOAD)}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-amber-300 rounded"
                      >
                        Load Section 3.3 (/db Support Trap)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimPayloadText(SECTION_4_QUOTA_PAYLOAD)}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-rose-300 rounded"
                      >
                        Load PDF Example 2 (4.2 Quota Depleted)
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label htmlFor="sim-lane" className="block text-slate-300 mb-1">
                          Intermediary Account Lane
                        </label>
                        <select
                          id="sim-lane"
                          value={simLane}
                          onChange={(e) => setSimLane(e.target.value as AccountLane)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                        >
                          <option value="REAL">REAL_LANE (Subscribed / Paid)</option>
                          <option value="TEST">TEST_LANE (Free Trial Watermarked)</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="sim-behavior" className="block text-slate-300 mb-1">
                          Destination Temp Search Transition
                        </label>
                        <select
                          id="sim-behavior"
                          value={simBehavior}
                          onChange={(e) =>
                            setSimBehavior(
                              e.target.value as
                                | 'BEHAVIOR_A_DELETE_AND_SEND'
                                | 'BEHAVIOR_B_IN_PLACE_EDIT'
                            )
                          }
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                        >
                          <option value="BEHAVIOR_B_IN_PLACE_EDIT">
                            Behavior B: Edit Temp Message In-Place
                          </option>
                          <option value="BEHAVIOR_A_DELETE_AND_SEND">
                            Behavior A: Delete Temp Message + Send New
                          </option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="sim-payload" className="block text-xs text-slate-300 mb-1">
                        Raw Upstream Reference Bot Message
                      </label>
                      <textarea
                        id="sim-payload"
                        rows={8}
                        dir="rtl"
                        value={simPayloadText}
                        onChange={(e) => setSimPayloadText(e.target.value)}
                        className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 leading-relaxed"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleRunPipelineSimulation()}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Execute Full Correlation &amp; White-Label Pipeline
                    </button>
                  </div>
                </div>

                {/* Right Column: White-Label Tree Output & Firewall Diagnostics */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <h2 className="text-base font-semibold text-white">
                        White-Label Tree Output &amp; Firewall Verdict
                      </h2>
                      <span className="text-xs font-mono text-slate-400">
                        {simPipelineResult
                          ? String(simPipelineResult.stage)
                          : 'Awaiting Execution'}
                      </span>
                    </div>

                    {!simPipelineResult ? (
                      <div className="py-16 text-center text-sm text-slate-400">
                        Run the correlation simulation on the left panel to inspect the Section 3/4 Firewall, Canonical AST, and rendered Persian White-Label Tree (`├─`, `╰─`).
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {Array.isArray(simPipelineResult.renderedPages) &&
                          simPipelineResult.renderedPages.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs text-emerald-400 font-medium">
                                Sanitized White-Label Output Delivered to End User (Zero Destination Leakage):
                              </div>
                              {(simPipelineResult.renderedPages as string[]).map((page, i) => (
                                <pre
                                  key={i}
                                  dir="rtl"
                                  className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 whitespace-pre-wrap leading-relaxed overflow-x-auto"
                                >
                                  {page}
                                </pre>
                              ))}
                            </div>
                          )}

                        <div className="space-y-2">
                          <div className="text-xs text-slate-400 font-medium">
                            Internal AST &amp; State Machine Trace:
                          </div>
                          <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-96">
                            {JSON.stringify(simPipelineResult, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
