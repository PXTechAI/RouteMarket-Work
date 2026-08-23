import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  ChartBar,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  Info,
  KeyRound,
  LockKeyhole,
  Languages,
  Monitor,
  Moon,
  Palette,
  Plug,
  Puzzle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Sun,
  Trash2,
  Workflow,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  DesktopAppInfo,
  ChatModel,
  LocalDataInfo,
  LocalDataScopeSummary,
  LocalApiGatewayState,
  LocalApiGatewayUsage,
  MarketplaceCatalogResponse,
  MarketplacePluginInstallPreview,
  MarketplacePluginInstallation,
  ModelProviderInput,
  ModelProviderCompatibility,
  ModelProviderHeader,
  ModelProviderModel,
  ModelProviderProtocol,
  ModelProviderSummary,
  ModelTokenPricing,
  RouteMarketWorkApi,
} from "../../../../shared/desktop-api";
import { getStoredThemePreference, setThemePreference, type ThemePreference } from "../../app/theme";
import { RouteMarketSelect } from "../../app/RouteMarketSelect";
import { tr, useLocale } from "../../i18n";
import { LOCALE_OPTIONS, type LocalePreference } from "../../i18n/locales";
import { DesktopUsageDashboard } from "./DesktopUsageDashboard";
import "./settings.scss";
import "./settings-data.scss";
import "./settings-modal.scss";
import "./settings-responsive.scss";
import "./providers.scss";
import "./provider-models.scss";
import "./marketplace.scss";
import "./local-api.scss";

type SettingsApi = Pick<
  RouteMarketWorkApi,
  | "getAppInfo"
  | "checkForUpdates"
  | "listMarketplaceCatalog"
  | "listMarketplacePluginInstallations"
  | "prepareMarketplacePluginInstall"
  | "prepareLocalPluginInstall"
  | "cancelMarketplacePluginInstall"
  | "installMarketplacePlugin"
  | "setMarketplacePluginEnabled"
  | "removeMarketplacePlugin"
  | "listModelProviders"
  | "listChatModels"
  | "saveModelProvider"
  | "syncModelProvider"
  | "removeModelProvider"
  | "getLocalApiGateway"
  | "updateLocalApiGateway"
  | "saveLocalApiGatewayRoute"
  | "removeLocalApiGatewayRoute"
  | "listLocalApiGatewayUsage"
  | "getLocalDataInfo"
  | "listLocalDataScopes"
  | "removeLocalDataScope"
  | "showLocalData"
  | "exportLocalData"
  | "clearLocalData"
>;

export type SettingsView = "general" | "providers" | "localApi" | "usage" | "extensions" | "data" | "about";
export type ToolsCategory = "overview" | "plugins" | "skills" | "agents" | "mcp" | "workflows" | "apps";
type MarketplaceKindFilter = "all" | "plugin" | "skill" | "workflow" | "app";
type MarketplaceScopeFilter = "remote" | "local";

const NAV_ITEMS: ReadonlyArray<{
  id: SettingsView;
  icon: typeof Settings2;
  label:
    | "settings.nav.general"
    | "settings.nav.providers"
    | "settings.nav.localApi"
    | "settings.nav.usage"
    | "settings.nav.extensions"
    | "settings.nav.data"
    | "settings.nav.about";
}> = [
  { id: "general", icon: Settings2, label: "settings.nav.general" },
  { id: "providers", icon: KeyRound, label: "settings.nav.providers" },
  { id: "localApi", icon: Server, label: "settings.nav.localApi" },
  { id: "usage", icon: ChartBar, label: "settings.nav.usage" },
  { id: "extensions", icon: Puzzle, label: "settings.nav.extensions" },
  { id: "data", icon: HardDrive, label: "settings.nav.data" },
  { id: "about", icon: Info, label: "settings.nav.about" },
];

type ProviderTemplateId =
  | "deepseek"
  | "openai"
  | "anthropic"
  | "gemini"
  | "qwen"
  | "siliconflow"
  | "openrouter"
  | "opencode"
  | "opencode-console"
  | "nine-router"
  | "local"
  | "custom";

const PROVIDER_TEMPLATES: ReadonlyArray<{
  id: Exclude<ProviderTemplateId, "custom">;
  name: string;
  protocol: ModelProviderProtocol;
  compatibility: ModelProviderCompatibility;
  baseUrl: string;
}> = [
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai-compatible",
    compatibility: "standard",
    baseUrl: "https://api.deepseek.com",
  },
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai-compatible",
    compatibility: "standard",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    compatibility: "standard",
    baseUrl: "https://api.anthropic.com/v1",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    protocol: "openai-compatible",
    compatibility: "standard",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "qwen",
    name: "阿里云百炼 / Qwen",
    protocol: "openai-compatible",
    compatibility: "standard",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    protocol: "openai-compatible",
    compatibility: "standard",
    baseUrl: "https://api.siliconflow.cn/v1",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai-compatible",
    compatibility: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "opencode",
    name: "OpenCode Zen",
    protocol: "openai-compatible",
    compatibility: "opencode",
    baseUrl: "https://opencode.ai/zen/v1",
  },
  {
    id: "opencode-console",
    name: "OpenCode Console",
    protocol: "openai-compatible",
    compatibility: "opencode",
    baseUrl: "https://console.opencode.ai/inference/openai/v1",
  },
  {
    id: "nine-router",
    name: "9Router（本机）",
    protocol: "openai-compatible",
    compatibility: "nine-router",
    baseUrl: "http://127.0.0.1:20128/v1",
  },
  {
    id: "local",
    name: "Local model server",
    protocol: "openai-compatible",
    compatibility: "standard",
    baseUrl: "http://127.0.0.1:8000/v1",
  },
];

const EMPTY_PROVIDER: ModelProviderInput = {
  name: "DeepSeek",
  instanceName: "DeepSeek",
  protocol: "openai-compatible",
  compatibility: "standard",
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  headers: [],
  enabled: true,
  models: [],
};

export function SettingsPage({
  dataApi,
  onProvidersChanged,
  initialView = "general",
  tools,
  onToolsCategoryChange,
  onPluginsChanged,
}: {
  dataApi: SettingsApi;
  onProvidersChanged(): void;
  initialView?: SettingsView;
  tools: { agent: ReactNode; localSkills: ReactNode; mcp: ReactNode };
  onToolsCategoryChange?(category: ToolsCategory | null): void;
  onPluginsChanged?(): void | Promise<void>;
}) {
  const { preference, setPreference } = useLocale();
  const [activeView, setActiveView] = useState<SettingsView>(initialView);
  const [toolsCategory, setToolsCategory] = useState<ToolsCategory>("overview");
  const [theme, setTheme] = useState(getStoredThemePreference);
  const [zoomFactor, setZoomFactor] = useState(1.1);
  const [localData, setLocalData] = useState<LocalDataInfo | null>(null);
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [dataScopes, setDataScopes] = useState<LocalDataScopeSummary[]>([]);
  const [providers, setProviders] = useState<ModelProviderSummary[]>([]);
  const [localApi, setLocalApi] = useState<LocalApiGatewayState | null>(null);
  const [localApiPort, setLocalApiPort] = useState("17480");
  const [localApiBusy, setLocalApiBusy] = useState(false);
  const [localApiLoading, setLocalApiLoading] = useState(true);
  const [localApiError, setLocalApiError] = useState<string | null>(null);
  const [localApiNotice, setLocalApiNotice] = useState<string | null>(null);
  const [localApiTokenVisible, setLocalApiTokenVisible] = useState(false);
  const [localApiCopied, setLocalApiCopied] = useState<string | null>(null);
  const [localApiModels, setLocalApiModels] = useState<ChatModel[]>([]);
  const [localApiUsage, setLocalApiUsage] = useState<LocalApiGatewayUsage[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [routeDraft, setRouteDraft] = useState<{
    name: string;
    strategy: "priority" | "round-robin";
    targets: string[];
  } | null>(null);
  const [routeTarget, setRouteTarget] = useState("");
  const [marketplaceCatalog, setMarketplaceCatalog] = useState<MarketplaceCatalogResponse | null>(null);
  const [marketplaceInstallations, setMarketplaceInstallations] = useState<MarketplacePluginInstallation[]>([]);
  const [marketplaceBusy, setMarketplaceBusy] = useState(false);
  const [marketplaceInstalling, setMarketplaceInstalling] = useState<string | null>(null);
  const [marketplaceInstallPreview, setMarketplaceInstallPreview] = useState<MarketplacePluginInstallPreview | null>(
    null,
  );
  const [marketplaceRemoveConfirm, setMarketplaceRemoveConfirm] = useState<string | null>(null);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceKind, setMarketplaceKind] = useState<MarketplaceKindFilter>("all");
  const [marketplaceScope, setMarketplaceScope] = useState<MarketplaceScopeFilter>("remote");
  const [providerDraft, setProviderDraft] = useState<ModelProviderInput | null>(null);
  const [providerTemplate, setProviderTemplate] = useState<ProviderTemplateId>("deepseek");
  const [providerBusy, setProviderBusy] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [localDataBusy, setLocalDataBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [localDataError, setLocalDataError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  useEffect(() => setActiveView(initialView), [initialView]);

  useEffect(() => {
    let active = true;
    void window.routeMarketWork?.getPreferences().then((preferences) => {
      if (active) setZoomFactor(preferences.zoomFactor ?? 1.1);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    onToolsCategoryChange?.(activeView === "extensions" ? toolsCategory : null);
  }, [activeView, onToolsCategoryChange, toolsCategory]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      dataApi.getLocalDataInfo(),
      dataApi.getAppInfo(),
      dataApi.listLocalDataScopes(),
      dataApi.getLocalApiGateway(),
    ]).then(([data, app, scopes, gateway]) => {
      if (!active) return;
      if (data.status === "fulfilled") setLocalData(data.value);
      else setLocalDataError(errorMessage(data.reason, "settings.localData.readError"));
      if (app.status === "fulfilled") setAppInfo(app.value);
      if (scopes.status === "fulfilled") setDataScopes(scopes.value);
      if (gateway.status === "fulfilled") {
        setLocalApi(gateway.value);
        setLocalApiPort(String(gateway.value.port));
      } else setLocalApiError(errorMessage(gateway.reason, "settings.localApi.readError"));
      setLocalApiLoading(false);
    });
    return () => {
      active = false;
    };
  }, [dataApi]);

  useEffect(() => {
    if (activeView !== "localApi") return;
    setLocalApiLoading(true);
    void Promise.all([dataApi.getLocalApiGateway(), dataApi.listChatModels().catch(() => [])])
      .then(([gateway, models]) => {
        setLocalApi(gateway);
        setLocalApiPort(String(gateway.port));
        setLocalApiModels(models);
        if (!routeTarget && models[0]) setRouteTarget(localGatewayModelId(models[0]));
        setLocalApiError(null);
      })
      .catch((error) => setLocalApiError(errorMessage(error, "settings.localApi.readError")))
      .finally(() => setLocalApiLoading(false));
  }, [activeView, dataApi]);

  useEffect(() => {
    if (activeView !== "usage") return;
    setUsageLoading(true);
    void Promise.all([dataApi.listChatModels().catch(() => []), dataApi.listLocalApiGatewayUsage(2_000)])
      .then(([models, usage]) => {
        setLocalApiModels(models);
        setLocalApiUsage(usage);
        setLocalApiError(null);
      })
      .catch((error) => setLocalApiError(errorMessage(error, "settings.localApi.readError")))
      .finally(() => setUsageLoading(false));
  }, [activeView, dataApi]);

  useEffect(() => {
    if (activeView !== "extensions" || marketplaceCatalog || marketplaceBusy || marketplaceError) return;
    void refreshMarketplace();
  }, [activeView, marketplaceCatalog, marketplaceBusy, marketplaceError]);

  useEffect(() => {
    let active = true;
    void loadModelProviders()
      .then((items) => {
        if (active) setProviders(items);
      })
      .catch((error) => {
        if (active) setProviderError(errorMessage(error, "settings.providers.readError"));
      });
    return () => {
      active = false;
    };
  }, [dataApi]);

  async function loadModelProviders(): Promise<ModelProviderSummary[]> {
    const [items, catalog] = await Promise.all([
      dataApi.listModelProviders(),
      dataApi.listChatModels().catch(() => []),
    ]);
    return items.map((provider) => {
      if (provider.models?.length || provider.modelCount === 0) return provider;
      const models = catalog
        .filter((model) => model.source === "external" && model.providerId === provider.id)
        .flatMap((model) => {
          const id = decodeExternalModelId(model.code);
          return id
            ? [
                {
                  id,
                  displayName: model.displayName,
                  source: "synced" as const,
                  category: model.category,
                  supportsTools: model.supportsTools,
                  supportsVision: model.supportsVision,
                  supportsStream: model.supportsStream,
                  supportsReasoningSummary: model.supportsReasoningSummary,
                  ...(model.pricing ? { pricing: { ...model.pricing } } : {}),
                },
              ]
            : [];
        });
      return { ...provider, models };
    });
  }

  function selectTheme(nextTheme: ThemePreference) {
    setTheme(nextTheme);
    setThemePreference(nextTheme);
  }

  function selectZoomFactor(nextZoomFactor: number) {
    setZoomFactor(nextZoomFactor);
    void window.routeMarketWork?.updatePreferences({ zoomFactor: nextZoomFactor });
  }

  function openProviderEditor(provider?: ModelProviderSummary) {
    setProviderError(null);
    setProviderTemplate(provider ? inferProviderTemplate(provider) : "deepseek");
    setProviderDraft(
      provider
        ? {
            id: provider.id,
            name: provider.name,
            instanceName: provider.instanceName,
            protocol: provider.protocol,
            compatibility: provider.compatibility,
            baseUrl: provider.baseUrl,
            apiKey: "",
            headers: (provider.headers ?? []).map((header) => ({ ...header })),
            enabled: provider.enabled,
            models: (provider.models ?? []).map((model) => ({ ...model })),
          }
        : { ...EMPTY_PROVIDER },
    );
  }

  function addManualModel() {
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            models: [...(current.models ?? []), createManualModel()],
          }
        : current,
    );
  }

  function updateProviderModel(index: number, patch: Partial<ModelProviderModel>) {
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            models: (current.models ?? []).map((model, modelIndex) =>
              modelIndex === index ? { ...model, ...patch } : model,
            ),
          }
        : current,
    );
  }

  function removeProviderModel(index: number) {
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            models: (current.models ?? []).filter((_model, modelIndex) => modelIndex !== index),
          }
        : current,
    );
  }

  function addProviderHeader() {
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            headers: [...(current.headers ?? []), { name: "", value: "" }],
          }
        : current,
    );
  }

  function updateProviderHeader(index: number, patch: Partial<ModelProviderHeader>) {
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            headers: (current.headers ?? []).map((header, headerIndex) =>
              headerIndex === index ? { ...header, ...patch } : header,
            ),
          }
        : current,
    );
  }

  function removeProviderHeader(index: number) {
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            headers: (current.headers ?? []).filter((_header, headerIndex) => headerIndex !== index),
          }
        : current,
    );
  }

  function changeProviderTemplate(templateId: ProviderTemplateId) {
    setProviderTemplate(templateId);
    if (templateId === "custom") {
      setProviderDraft((current) =>
        current && !current.id
          ? {
              ...current,
              name: "",
              protocol: "openai-compatible",
              compatibility: "custom",
              baseUrl: "",
            }
          : current,
      );
      return;
    }
    const template = PROVIDER_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            instanceName:
              !current.instanceName?.trim() || current.instanceName === current.name
                ? template.name
                : current.instanceName,
            name: template.name,
            protocol: template.protocol,
            compatibility: template.compatibility,
            baseUrl: template.baseUrl,
          }
        : current,
    );
  }

  function changeProviderProtocol(protocol: ModelProviderProtocol) {
    setProviderDraft((current) =>
      current
        ? {
            ...current,
            protocol,
            compatibility: "standard",
            baseUrl: protocol === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1",
          }
        : current,
    );
  }

  async function saveProvider() {
    if (!providerDraft) return;
    setProviderBusy(providerDraft.id ?? "new");
    setProviderError(null);
    try {
      await dataApi.saveModelProvider(providerDraft);
      setProviders(await loadModelProviders());
      setProviderDraft(null);
      onProvidersChanged();
    } catch (error) {
      setProviderError(errorMessage(error, "settings.providers.saveError"));
    } finally {
      setProviderBusy(null);
    }
  }

  async function syncProvider(providerId: string) {
    setProviderBusy(providerId);
    setProviderError(null);
    try {
      await dataApi.syncModelProvider(providerId);
      setProviders(await loadModelProviders());
      onProvidersChanged();
    } catch (error) {
      setProviders(await loadModelProviders().catch(() => providers));
      setProviderError(errorMessage(error, "settings.providers.syncError"));
    } finally {
      setProviderBusy(null);
    }
  }

  async function removeProvider(providerId: string) {
    if (!window.confirm(tr("settings.providers.removeConfirm"))) return;
    setProviderBusy(providerId);
    setProviderError(null);
    try {
      await dataApi.removeModelProvider(providerId);
      setProviders(await loadModelProviders());
      onProvidersChanged();
    } catch (error) {
      setProviderError(errorMessage(error, "settings.providers.removeError"));
    } finally {
      setProviderBusy(null);
    }
  }

  async function updateLocalApi(input: { enabled?: boolean; port?: number; rotateToken?: boolean }) {
    if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)) {
      setLocalApiError(tr("settings.localApi.invalidPort"));
      return;
    }
    setLocalApiBusy(true);
    setLocalApiError(null);
    setLocalApiNotice(null);
    try {
      const state = await dataApi.updateLocalApiGateway(input);
      setLocalApi(state);
      setLocalApiPort(String(state.port));
      setLocalApiNotice(
        tr(
          input.rotateToken
            ? "settings.localApi.tokenRotated"
            : input.port !== undefined
              ? "settings.localApi.portSaved"
              : state.running
                ? "settings.localApi.startedNotice"
                : "settings.localApi.stoppedNotice",
        ),
      );
    } catch (error) {
      setLocalApiError(error instanceof Error ? error.message : tr("settings.localApi.updateError"));
      setLocalApi(await dataApi.getLocalApiGateway().catch(() => localApi));
    } finally {
      setLocalApiBusy(false);
    }
  }

  async function copyLocalApiValue(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setLocalApiCopied(label);
    window.setTimeout(() => setLocalApiCopied((current) => (current === label ? null : current)), 1600);
  }

  async function refreshUsage() {
    setUsageLoading(true);
    setLocalApiError(null);
    try {
      const [models, usage] = await Promise.all([
        dataApi.listChatModels().catch(() => localApiModels),
        dataApi.listLocalApiGatewayUsage(2_000),
      ]);
      setLocalApiModels(models);
      setLocalApiUsage(usage);
    } catch (error) {
      setLocalApiError(errorMessage(error, "settings.localApi.readError"));
    } finally {
      setUsageLoading(false);
    }
  }

  async function saveLocalRoute() {
    if (!routeDraft) return;
    setLocalApiBusy(true);
    setLocalApiError(null);
    try {
      setLocalApi(await dataApi.saveLocalApiGatewayRoute(routeDraft));
      setRouteDraft(null);
    } catch (error) {
      setLocalApiError(error instanceof Error ? error.message : tr("settings.localApi.routeSaveError"));
    } finally {
      setLocalApiBusy(false);
    }
  }

  async function removeLocalRoute(routeId: string) {
    setLocalApiBusy(true);
    setLocalApiError(null);
    try {
      setLocalApi(await dataApi.removeLocalApiGatewayRoute(routeId));
    } catch (error) {
      setLocalApiError(error instanceof Error ? error.message : tr("settings.localApi.routeRemoveError"));
    } finally {
      setLocalApiBusy(false);
    }
  }

  function moveRouteTarget(index: number, direction: -1 | 1) {
    setRouteDraft((current) => {
      if (!current) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.targets.length) return current;
      const targets = [...current.targets];
      [targets[index], targets[nextIndex]] = [targets[nextIndex]!, targets[index]!];
      return { ...current, targets };
    });
  }

  async function removeDataScope(scopeId: string) {
    setLocalDataBusy(true);
    setLocalDataError(null);
    try {
      const removed = await dataApi.removeLocalDataScope(scopeId);
      if (removed) {
        setDataScopes(await dataApi.listLocalDataScopes());
        setLocalData(await dataApi.getLocalDataInfo());
      }
    } catch (error) {
      setLocalDataError(errorMessage(error, "settings.localData.actionError"));
    } finally {
      setLocalDataBusy(false);
    }
  }

  async function runLocalDataAction(action: "show" | "export" | "clear") {
    setLocalDataBusy(true);
    setLocalDataError(null);
    try {
      if (action === "show") await dataApi.showLocalData();
      if (action === "export") await dataApi.exportLocalData();
      if (action === "clear") {
        await dataApi.clearLocalData();
        setClearOpen(false);
      }
      setLocalData(await dataApi.getLocalDataInfo());
    } catch (error) {
      setLocalDataError(errorMessage(error, "settings.localData.actionError"));
    } finally {
      setLocalDataBusy(false);
    }
  }

  async function checkForUpdates() {
    setUpdateBusy(true);
    setUpdateResult(null);
    try {
      const started = await dataApi.checkForUpdates();
      setUpdateResult(tr(started ? "settings.about.updateStarted" : "settings.about.updateUnavailable"));
    } catch (error) {
      setUpdateResult(errorMessage(error, "settings.about.updateError"));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function refreshMarketplace() {
    setMarketplaceBusy(true);
    setMarketplaceError(null);
    try {
      const [catalog, installations] = await Promise.allSettled([
        dataApi.listMarketplaceCatalog(),
        dataApi.listMarketplacePluginInstallations(),
      ]);
      if (installations.status === "rejected") throw installations.reason;
      setMarketplaceInstallations(installations.value);
      if (catalog.status === "fulfilled") setMarketplaceCatalog(catalog.value);
      else setMarketplaceError(errorMessage(catalog.reason, "settings.extensions.marketplaceError"));
    } catch (error) {
      setMarketplaceError(errorMessage(error, "settings.extensions.marketplaceError"));
    } finally {
      setMarketplaceBusy(false);
    }
  }

  async function prepareMarketplacePluginInstall(pluginId: string) {
    setMarketplaceInstalling(pluginId);
    setMarketplaceError(null);
    try {
      setMarketplaceInstallPreview(await dataApi.prepareMarketplacePluginInstall(pluginId));
    } catch (error) {
      setMarketplaceError(errorMessage(error, "settings.extensions.installError"));
    } finally {
      setMarketplaceInstalling(null);
    }
  }

  async function prepareLocalPluginInstall() {
    setMarketplaceInstalling("local");
    setMarketplaceError(null);
    try {
      const preview = await dataApi.prepareLocalPluginInstall();
      if (preview) setMarketplaceInstallPreview(preview);
    } catch (error) {
      setMarketplaceError(errorMessage(error, "settings.extensions.installError"));
    } finally {
      setMarketplaceInstalling(null);
    }
  }

  async function confirmMarketplacePluginInstall() {
    if (!marketplaceInstallPreview) return;
    const installingLocal = marketplaceInstallPreview.source === "local";
    setMarketplaceInstalling(marketplaceInstallPreview.pluginId);
    setMarketplaceError(null);
    try {
      const installation = await dataApi.installMarketplacePlugin(marketplaceInstallPreview.installToken);
      setMarketplaceInstallations((current) => [
        ...current.filter((item) => item.pluginId !== installation.pluginId),
        installation,
      ]);
      setMarketplaceInstallPreview(null);
      if (installingLocal) setMarketplaceScope("local");
      await onPluginsChanged?.();
    } catch (error) {
      setMarketplaceError(errorMessage(error, "settings.extensions.installError"));
    } finally {
      setMarketplaceInstalling(null);
    }
  }

  function cancelMarketplacePluginInstall() {
    if (!marketplaceInstallPreview || marketplaceInstalling !== null) return;
    const token = marketplaceInstallPreview.installToken;
    setMarketplaceInstallPreview(null);
    void dataApi.cancelMarketplacePluginInstall(token);
  }

  async function setMarketplacePluginEnabled(pluginId: string, enabled: boolean) {
    setMarketplaceInstalling(pluginId);
    setMarketplaceError(null);
    try {
      const installation = await dataApi.setMarketplacePluginEnabled(pluginId, enabled);
      setMarketplaceInstallations((current) =>
        current.map((item) => (item.pluginId === pluginId ? installation : item)),
      );
      await onPluginsChanged?.();
    } catch (error) {
      setMarketplaceError(errorMessage(error, "settings.extensions.stateError"));
    } finally {
      setMarketplaceInstalling(null);
    }
  }

  async function removeMarketplacePlugin(pluginId: string) {
    if (marketplaceRemoveConfirm !== pluginId) {
      setMarketplaceRemoveConfirm(pluginId);
      return;
    }
    setMarketplaceInstalling(pluginId);
    setMarketplaceError(null);
    try {
      await dataApi.removeMarketplacePlugin(pluginId);
      setMarketplaceInstallations((current) => current.filter((item) => item.pluginId !== pluginId));
      setMarketplaceRemoveConfirm(null);
      await onPluginsChanged?.();
    } catch (error) {
      setMarketplaceError(errorMessage(error, "settings.extensions.removeError"));
    } finally {
      setMarketplaceInstalling(null);
    }
  }

  const marketplaceCatalogIds = new Set(marketplaceCatalog?.items.map((item) => item.id) ?? []);
  const marketplaceInstallationIds = new Set(marketplaceInstallations.map((item) => item.pluginId));
  const normalizedMarketplaceQuery = marketplaceQuery.trim().toLocaleLowerCase();
  const matchesMarketplaceQuery = (values: Array<string | undefined>) =>
    !normalizedMarketplaceQuery ||
    values.some((value) => value?.toLocaleLowerCase().includes(normalizedMarketplaceQuery));
  const visibleMarketplaceItems =
    marketplaceCatalog?.items.filter((item) => {
      const installed = item.release.distributionSource === "bundled" || marketplaceInstallationIds.has(item.id);
      return (
        (marketplaceKind === "all" || item.kind === marketplaceKind) &&
        (marketplaceScope === "remote" || installed) &&
        matchesMarketplaceQuery([
          item.id,
          marketplaceItemName(item.id, item.name),
          item.name,
          item.description,
          item.publisher,
        ])
      );
    }) ?? [];
  const unlistedMarketplaceInstallations = marketplaceInstallations.filter((installation) => {
    if (marketplaceCatalogIds.has(installation.pluginId)) return false;
    if (marketplaceKind !== "all" && marketplaceKind !== "plugin") return false;
    if (marketplaceScope !== "local") return false;
    return matchesMarketplaceQuery([installation.pluginId, installation.publisher]);
  });
  const marketplaceTotalCount =
    (marketplaceCatalog?.items.length ?? 0) +
    marketplaceInstallations.filter((installation) => !marketplaceCatalogIds.has(installation.pluginId)).length;
  const marketplaceVisibleCount = visibleMarketplaceItems.length + unlistedMarketplaceInstallations.length;
  const marketplaceKindCounts = {
    plugin: marketplaceCatalog?.items.filter((item) => item.kind === "plugin").length ?? 0,
    skill: marketplaceCatalog?.items.filter((item) => item.kind === "skill").length ?? 0,
    agent: marketplaceCatalog?.items.filter((item) => item.kind === "agent").length ?? 0,
    mcp: marketplaceCatalog?.items.filter((item) => item.kind === "mcp").length ?? 0,
    workflow: marketplaceCatalog?.items.filter((item) => item.kind === "workflow").length ?? 0,
    app: marketplaceCatalog?.items.filter((item) => item.kind === "app").length ?? 0,
  };
  const marketplaceCategoryTotalCount =
    marketplaceKind === "all" ? marketplaceTotalCount : marketplaceKindCounts[marketplaceKind];
  const localSkillPackagesView = toolsCategory === "skills" && marketplaceScope === "local";

  function selectToolsCategory(category: ToolsCategory) {
    setToolsCategory(category);
    const marketplaceKinds: Partial<Record<ToolsCategory, MarketplaceKindFilter>> = {
      plugins: "plugin",
      skills: "skill",
      workflows: "workflow",
      apps: "app",
    };
    const kind = marketplaceKinds[category];
    if (kind) setMarketplaceKind(kind);
  }

  return (
    <section className="rm-settings-page">
      <aside className="rm-settings-nav" aria-label={tr("settings.title")}>
        <header>
          <h1>{tr("settings.title")}</h1>
          <p>{tr("settings.description")}</p>
        </header>
        <nav>
          {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              className={activeView === id ? "active" : ""}
              aria-current={activeView === id ? "page" : undefined}
              onClick={() => setActiveView(id)}
            >
              <Icon size={16} />
              <span>{tr(label)}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="rm-settings-content">
        {activeView === "general" && (
          <>
            <PageHeading title={tr("settings.general.title")} description={tr("settings.general.description")} />
            <SettingsGroup
              title={tr("settings.language.title")}
              description={tr("settings.language.description")}
              icon={<Languages size={17} />}
            >
              <SettingRow title={tr("settings.language.label")} scope={tr("settings.scope.device")}>
                <RouteMarketSelect
                  label={tr("settings.language.label")}
                  value={preference}
                  options={LOCALE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: tr(`settings.language.${option.value}`),
                  }))}
                  onChange={(value) => setPreference(value as LocalePreference)}
                />
              </SettingRow>
            </SettingsGroup>
            <SettingsGroup
              title={tr("settings.appearance.title")}
              description={tr("settings.appearance.description")}
              icon={<Palette size={17} />}
            >
              <SettingRow title={tr("settings.appearance.theme")} scope={tr("settings.scope.device")}>
                <div className="rm-theme-picker" role="group" aria-label={tr("settings.appearance.theme")}>
                  <ThemeButton active={theme === "light"} onClick={() => selectTheme("light")}>
                    <Sun size={14} />
                    {tr("settings.appearance.light")}
                  </ThemeButton>
                  <ThemeButton active={theme === "dark"} onClick={() => selectTheme("dark")}>
                    <Moon size={14} />
                    {tr("settings.appearance.dark")}
                  </ThemeButton>
                  <ThemeButton active={theme === "system"} onClick={() => selectTheme("system")}>
                    <Monitor size={14} />
                    {tr("settings.appearance.system")}
                  </ThemeButton>
                </div>
              </SettingRow>
              <SettingRow title={tr("settings.appearance.scale")} scope={tr("settings.scope.device")}>
                <div className="rm-scale-picker" role="group" aria-label={tr("settings.appearance.scale")}>
                  {[1, 1.1, 1.25, 1.5].map((factor) => (
                    <ThemeButton key={factor} active={Math.abs(zoomFactor - factor) < 0.01} onClick={() => selectZoomFactor(factor)}>
                      {Math.round(factor * 100)}%
                    </ThemeButton>
                  ))}
                </div>
              </SettingRow>
            </SettingsGroup>
          </>
        )}

        {activeView === "providers" && (
          <>
            <PageHeading title={tr("settings.providers.title")} description={tr("settings.providers.description")} />
            <div className="rm-provider-toolbar">
              <div>
                <strong>{tr("settings.providers.byokTitle")}</strong>
                <p>{tr("settings.providers.byokDescription")}</p>
              </div>
              <button type="button" onClick={() => openProviderEditor()}>
                <Plus size={14} />
                {tr("settings.providers.add")}
              </button>
            </div>
            {providerError && (
              <div className="rm-settings-error rm-provider-page-error" role="alert">
                {providerError}
              </div>
            )}
            <div className="rm-provider-list">
              {providers.length === 0 ? (
                <div className="rm-provider-empty">
                  <Server size={24} />
                  <strong>{tr("settings.providers.emptyTitle")}</strong>
                  <p>{tr("settings.providers.emptyDescription")}</p>
                </div>
              ) : (
                providers.map((provider) => (
                  <section className="rm-provider-card" key={provider.id}>
                    <div className="rm-provider-card-icon">
                      <Server size={17} />
                    </div>
                    <div className="rm-provider-card-copy">
                      <div>
                        <strong>{provider.instanceName}</strong>
                        <span>
                          {provider.instanceName !== provider.name ? `${provider.name} · ` : ""}
                          {provider.protocol === "anthropic"
                            ? tr("settings.providers.anthropic")
                            : compatibilityLabel(provider.compatibility)}
                        </span>
                      </div>
                      <code>{provider.baseUrl}</code>
                      <p>
                        {tr("settings.providers.modelCount", [provider.modelCount])}
                        {provider.lastSyncedAt ? ` · ${tr("settings.providers.synced")}` : ""}
                      </p>
                      {provider.lastError && <p className="error">{provider.lastError}</p>}
                    </div>
                    <div className="rm-provider-card-actions">
                      <button
                        type="button"
                        title={tr("settings.providers.edit")}
                        disabled={providerBusy !== null}
                        onClick={() => openProviderEditor(provider)}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title={tr("settings.providers.sync")}
                        disabled={providerBusy !== null}
                        onClick={() => void syncProvider(provider.id)}
                      >
                        <RefreshCw className={providerBusy === provider.id ? "spin" : ""} size={14} />
                      </button>
                      <button
                        className="danger"
                        type="button"
                        title={tr("settings.providers.remove")}
                        disabled={providerBusy !== null}
                        onClick={() => void removeProvider(provider.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </section>
                ))
              )}
            </div>
          </>
        )}

        {activeView === "localApi" && (
          <>
            <PageHeading title={tr("settings.localApi.title")} description={tr("settings.localApi.description")} />
            <div className="rm-provider-toolbar">
              <div>
                <strong>{tr("settings.localApi.serviceTitle")}</strong>
                <p>{tr("settings.localApi.serviceDescription")}</p>
              </div>
              <button
                type="button"
                className={localApi?.enabled ? "rm-local-api-stop" : ""}
                disabled={localApiBusy}
                onClick={() => void updateLocalApi({ enabled: !localApi?.enabled })}
              >
                {localApiBusy ? <RefreshCw className="spin" size={14} /> : <Server size={14} />}{" "}
                {tr(localApi?.enabled ? "settings.localApi.disable" : "settings.localApi.enable")}
              </button>
            </div>
            {localApiError && (
              <div className="rm-settings-error" role="alert">
                {localApiError}
              </div>
            )}
            {localApiNotice && (
              <div className="rm-settings-success" role="status">
                <CheckCircle2 size={14} />
                {localApiNotice}
              </div>
            )}
            <section className="rm-local-api-panel" data-testid="local-api-service-panel">
              <div className="rm-local-api-status">
                <span className={localApi?.running ? "running" : localApiLoading ? "loading" : ""} />
                <div>
                  <strong>
                    {tr(
                      localApiLoading
                        ? "settings.localApi.loading"
                        : localApi?.running
                          ? "settings.localApi.running"
                          : "settings.localApi.stopped",
                    )}
                  </strong>
                  <p>{localApi?.lastError ?? tr("settings.localApi.localOnly")}</p>
                </div>
                <em>
                  {localApi?.running ? tr("settings.localApi.statusRunning") : tr("settings.localApi.statusStopped")}
                </em>
              </div>
              <div className="rm-local-api-field">
                <label>{tr("settings.localApi.endpoint")}</label>
                <code>{localApi?.baseUrl ?? `http://127.0.0.1:${localApiPort || "17480"}/v1`}</code>
                <button
                  type="button"
                  onClick={() =>
                    void copyLocalApiValue(
                      "endpoint",
                      localApi?.baseUrl ?? `http://127.0.0.1:${localApiPort || "17480"}/v1`,
                    )
                  }
                >
                  {tr(localApiCopied === "endpoint" ? "settings.localApi.copied" : "settings.localApi.copy")}
                </button>
              </div>
              <div className="rm-local-api-field rm-local-api-token">
                <label>{tr("settings.localApi.token")}</label>
                <code>
                  {localApi
                    ? localApiTokenVisible
                      ? localApi.token
                      : `${localApi.token.slice(0, 12)}${"•".repeat(18)}`
                    : "—"}
                </code>
                <button
                  type="button"
                  disabled={!localApi}
                  title={tr(localApiTokenVisible ? "settings.localApi.hideToken" : "settings.localApi.showToken")}
                  onClick={() => setLocalApiTokenVisible((visible) => !visible)}
                >
                  {localApiTokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  disabled={!localApi}
                  onClick={() => localApi && void copyLocalApiValue("token", localApi.token)}
                >
                  {tr(localApiCopied === "token" ? "settings.localApi.copied" : "settings.localApi.copy")}
                </button>
              </div>
              <div className="rm-local-api-port">
                <label>
                  <span>{tr("settings.localApi.port")}</span>
                  <input
                    aria-label={tr("settings.localApi.port")}
                    inputMode="numeric"
                    value={localApiPort}
                    onChange={(event) => setLocalApiPort(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  />
                </label>
                <button
                  type="button"
                  disabled={localApiBusy || (localApi !== null && Number(localApiPort) === localApi.port)}
                  onClick={() => void updateLocalApi({ port: Number(localApiPort) })}
                >
                  {tr(localApi?.running ? "settings.localApi.applyPort" : "settings.localApi.savePort")}
                </button>
                <button
                  type="button"
                  disabled={localApiBusy || !localApi}
                  onClick={() => void updateLocalApi({ rotateToken: true })}
                >
                  {tr("settings.localApi.rotateToken")}
                </button>
              </div>
              <div className="rm-local-api-stats">
                <span>{tr("settings.localApi.listenAddress", [localApiPort || "17480"])}</span>
                <span>{tr("settings.localApi.requests", [localApi?.requestCount ?? 0])}</span>
                <span>
                  {localApi?.lastRequestAt
                    ? tr("settings.localApi.lastRequest", [new Date(localApi.lastRequestAt).toLocaleString()])
                    : tr("settings.localApi.noRequests")}
                </span>
              </div>
            </section>
            <section className="rm-local-route-section">
              <header>
                <div>
                  <strong>{tr("settings.localApi.routesTitle")}</strong>
                  <p>{tr("settings.localApi.routesDescription")}</p>
                </div>
                <button type="button" onClick={() => setRouteDraft({ name: "", strategy: "priority", targets: [] })}>
                  <Plus size={13} />
                  {tr("settings.localApi.addRoute")}
                </button>
              </header>
              {routeDraft && (
                <div className="rm-local-route-editor">
                  <label>
                    <span>{tr("settings.localApi.routeName")}</span>
                    <input
                      value={routeDraft.name}
                      placeholder={tr("settings.localApi.routeNamePlaceholder")}
                      onChange={(event) => setRouteDraft({ ...routeDraft, name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>{tr("settings.localApi.routeStrategy")}</span>
                    <RouteMarketSelect
                      label={tr("settings.localApi.routeStrategy")}
                      value={routeDraft.strategy}
                      options={[
                        { value: "priority", label: tr("settings.localApi.strategyPriority") },
                        { value: "round-robin", label: tr("settings.localApi.strategyRoundRobin") },
                      ]}
                      onChange={(value) =>
                        setRouteDraft({ ...routeDraft, strategy: value as "priority" | "round-robin" })
                      }
                    />
                  </label>
                  <div className="rm-local-route-add-target">
                    <RouteMarketSelect
                      label={tr("settings.localApi.targetModel")}
                      value={routeTarget}
                      options={localApiModels.map((model) => ({
                        value: localGatewayModelId(model),
                        label: model.displayName,
                        group: model.providerName || "RouteMarket",
                      }))}
                      onChange={setRouteTarget}
                    />
                    <button
                      type="button"
                      disabled={!routeTarget || routeDraft.targets.includes(routeTarget)}
                      onClick={() => setRouteDraft({ ...routeDraft, targets: [...routeDraft.targets, routeTarget] })}
                    >
                      <Plus size={13} />
                      {tr("settings.localApi.addTarget")}
                    </button>
                  </div>
                  <div className="rm-local-route-targets">
                    {routeDraft.targets.map((target, index) => (
                      <div key={target}>
                        <span>{index + 1}</span>
                        <strong>{gatewayModelLabel(target, localApiModels)}</strong>
                        <div>
                          <button type="button" disabled={index === 0} onClick={() => moveRouteTarget(index, -1)}>
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            disabled={index === routeDraft.targets.length - 1}
                            onClick={() => moveRouteTarget(index, 1)}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRouteDraft({
                                ...routeDraft,
                                targets: routeDraft.targets.filter((item) => item !== target),
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="rm-local-route-actions">
                    <button type="button" onClick={() => setRouteDraft(null)}>
                      {tr("settings.providers.cancel")}
                    </button>
                    <button
                      className="primary"
                      type="button"
                      disabled={localApiBusy || !routeDraft.name.trim() || !routeDraft.targets.length}
                      onClick={() => void saveLocalRoute()}
                    >
                      {tr("settings.localApi.saveRoute")}
                    </button>
                  </div>
                </div>
              )}
              <div className="rm-local-route-list">
                {localApi?.routes.length ? (
                  localApi.routes.map((route) => (
                    <div key={route.id}>
                      <div>
                        <strong>{route.name}</strong>
                        <span>
                          {tr(
                            route.strategy === "round-robin"
                              ? "settings.localApi.strategyRoundRobin"
                              : "settings.localApi.strategyPriority",
                          )}
                        </span>
                        <code>{`route/${route.id}`}</code>
                        <p>{route.targets.map((target) => gatewayModelLabel(target, localApiModels)).join(" → ")}</p>
                        {route.targets.some((target) =>
                          localApi.targetHealth.some((health) => health.model === target && health.openUntil),
                        ) ? (
                          <p className="warning">{tr("settings.localApi.circuitOpen")}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={localApiBusy}
                        title={tr("settings.localApi.removeRoute")}
                        onClick={() => void removeLocalRoute(route.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="rm-local-route-empty">{tr("settings.localApi.routesEmpty")}</p>
                )}
              </div>
            </section>
          </>
        )}

        {activeView === "usage" && (
          <>
            <PageHeading title={tr("settings.usage.title")} description={tr("settings.usage.description")} />
            {localApiError && (
              <div className="rm-settings-error" role="alert">
                {localApiError}
              </div>
            )}
            <DesktopUsageDashboard
              records={localApiUsage}
              refreshing={usageLoading}
              onRefresh={() => void refreshUsage()}
              modelLabel={(model, providerId, providerName) =>
                gatewayModelLabel(model, localApiModels, providerId, providerName)
              }
            />
          </>
        )}

        {activeView === "extensions" && (
          <>
            <PageHeading title={tr("settings.extensions.title")} description={tr("settings.extensions.description")} />
            <div className="rm-tools-category-tabs" role="tablist" aria-label={tr("settings.extensions.categoryLabel")}>
              {(
                [
                  ["overview", Puzzle, "settings.extensions.category.overview"],
                  ["plugins", Puzzle, "settings.extensions.category.plugins"],
                  ["skills", Sparkles, "settings.extensions.category.skills"],
                  ["agents", Bot, "settings.extensions.category.agents"],
                  ["mcp", Plug, "settings.extensions.category.mcp"],
                  ["workflows", Workflow, "settings.extensions.category.workflows"],
                  ["apps", Monitor, "settings.extensions.category.apps"],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={toolsCategory === id}
                  className={toolsCategory === id ? "active" : ""}
                  onClick={() => selectToolsCategory(id)}
                >
                  <Icon size={15} />
                  <span>{tr(label)}</span>
                </button>
              ))}
            </div>

            {toolsCategory === "overview" && (
              <div className="rm-tools-overview">
                <button type="button" onClick={() => selectToolsCategory("plugins")}>
                  <span>
                    <Puzzle size={19} />
                  </span>
                  <strong>{tr("settings.extensions.category.plugins")}</strong>
                  <p>{tr("settings.extensions.overview.plugins")}</p>
                  <small>{tr("settings.extensions.overview.remoteCount", [marketplaceKindCounts.plugin])}</small>
                </button>
                <button type="button" onClick={() => selectToolsCategory("skills")}>
                  <span>
                    <Sparkles size={19} />
                  </span>
                  <strong>{tr("settings.extensions.category.skills")}</strong>
                  <p>{tr("settings.extensions.overview.skills")}</p>
                  <small>{tr("settings.extensions.overview.remoteCount", [marketplaceKindCounts.skill])}</small>
                </button>
                <button type="button" onClick={() => selectToolsCategory("agents")}>
                  <span>
                    <Bot size={19} />
                  </span>
                  <strong>{tr("settings.extensions.category.agents")}</strong>
                  <p>{tr("settings.extensions.overview.agents")}</p>
                  <small>{tr("settings.extensions.overview.cloud")}</small>
                </button>
                <button type="button" onClick={() => selectToolsCategory("mcp")}>
                  <span>
                    <Plug size={19} />
                  </span>
                  <strong>{tr("settings.extensions.category.mcp")}</strong>
                  <p>{tr("settings.extensions.overview.mcp")}</p>
                  <small>{tr("settings.extensions.overview.local")}</small>
                </button>
                <button type="button" onClick={() => selectToolsCategory("workflows")}>
                  <span>
                    <Workflow size={19} />
                  </span>
                  <strong>{tr("settings.extensions.category.workflows")}</strong>
                  <p>{tr("settings.extensions.overview.workflows")}</p>
                  <small>{tr("settings.extensions.overview.remoteCount", [marketplaceKindCounts.workflow])}</small>
                </button>
                <button type="button" onClick={() => selectToolsCategory("apps")}>
                  <span>
                    <Monitor size={19} />
                  </span>
                  <strong>{tr("settings.extensions.category.apps")}</strong>
                  <p>{tr("settings.extensions.overview.apps")}</p>
                  <small>{tr("settings.extensions.overview.remoteCount", [marketplaceKindCounts.app])}</small>
                </button>
              </div>
            )}

            {(toolsCategory === "plugins" ||
              toolsCategory === "skills" ||
              toolsCategory === "workflows" ||
              toolsCategory === "apps") && (
              <div className="rm-marketplace-surface">
                <div className="rm-provider-toolbar rm-marketplace-toolbar">
                  <div>
                    <strong>
                      {localSkillPackagesView ? (
                        tr("settings.extensions.localSkills.title")
                      ) : (
                        <>
                          {tr(
                            (
                              {
                                all: "settings.extensions.allKinds",
                                plugin: "settings.extensions.kind.plugin",
                                skill: "settings.extensions.kind.skill",
                                agent: "settings.extensions.kind.agent",
                                mcp: "settings.extensions.kind.mcp",
                                workflow: "settings.extensions.kind.workflow",
                                app: "settings.extensions.kind.app",
                              } as const
                            )[marketplaceKind],
                          )}{" "}
                          · {tr("settings.extensions.marketplaceTitle")}
                        </>
                      )}
                    </strong>
                    <p>
                      {tr(
                        localSkillPackagesView
                          ? "settings.extensions.localSkills.description"
                          : "settings.extensions.marketplaceDescription",
                      )}
                    </p>
                  </div>
                  {!localSkillPackagesView && (
                    <div className="rm-marketplace-toolbar-actions">
                      {toolsCategory === "plugins" ? (
                        <button
                          type="button"
                          disabled={marketplaceInstalling !== null}
                          onClick={() => void prepareLocalPluginInstall()}
                        >
                          <FolderOpen size={14} />
                          {tr("settings.extensions.installLocal")}
                        </button>
                      ) : null}
                      <button type="button" disabled={marketplaceBusy} onClick={() => void refreshMarketplace()}>
                        <RefreshCw className={marketplaceBusy ? "spin" : ""} size={14} />
                        {tr("settings.extensions.refreshMarketplace")}
                      </button>
                    </div>
                  )}
                </div>
                <div className="rm-marketplace-controls">
                  {!localSkillPackagesView && (
                    <label className="rm-marketplace-search">
                      <Search size={14} />
                      <input
                        type="search"
                        value={marketplaceQuery}
                        placeholder={tr("settings.extensions.searchPlaceholder")}
                        aria-label={tr("settings.extensions.searchPlaceholder")}
                        onChange={(event) => setMarketplaceQuery(event.target.value)}
                      />
                    </label>
                  )}
                  <RouteMarketSelect
                    label={tr("settings.extensions.filterScope")}
                    value={marketplaceScope}
                    options={[
                      { value: "remote", label: tr("settings.extensions.scopeRemote") },
                      { value: "local", label: tr("settings.extensions.scopeLocal") },
                    ]}
                    onChange={(value) => setMarketplaceScope(value as MarketplaceScopeFilter)}
                  />
                  {!localSkillPackagesView && marketplaceCatalog ? (
                    <span className="rm-marketplace-result-count">
                      {tr("settings.extensions.resultCount", [marketplaceVisibleCount, marketplaceCategoryTotalCount])}
                    </span>
                  ) : null}
                </div>
                {localSkillPackagesView ? (
                  tools.localSkills
                ) : (
                  <>
                    {marketplaceError && (
                      <div className="rm-settings-error rm-provider-page-error" role="alert">
                        {marketplaceError}
                      </div>
                    )}
                    <div className="rm-marketplace-list">
                      {!marketplaceCatalog && marketplaceBusy ? (
                        <div className="rm-provider-empty">
                          <RefreshCw className="spin" size={24} />
                          <strong>{tr("settings.extensions.loadingMarketplace")}</strong>
                        </div>
                      ) : null}
                      {marketplaceCatalog && marketplaceCategoryTotalCount === 0 ? (
                        <div className="rm-provider-empty">
                          <Puzzle size={24} />
                          <strong>{tr("settings.extensions.emptyMarketplace")}</strong>
                        </div>
                      ) : null}
                      {marketplaceCatalog && marketplaceCategoryTotalCount > 0 && marketplaceVisibleCount === 0 ? (
                        <div className="rm-provider-empty">
                          <Search size={24} />
                          <strong>{tr("settings.extensions.noResults")}</strong>
                          <p>{tr("settings.extensions.noResultsDescription")}</p>
                        </div>
                      ) : null}
                      {visibleMarketplaceItems.map((item) => {
                        const installation = marketplaceInstallations.find(
                          (candidate) => candidate.pluginId === item.id,
                        );
                        const bundled = item.release.distributionSource === "bundled";
                        return (
                          <section className="rm-marketplace-card" key={item.id}>
                            <div className="rm-provider-card-icon">
                              <Puzzle size={17} />
                            </div>
                            <div className="rm-marketplace-card-copy">
                              <div>
                                <strong>{marketplaceItemName(item.id, item.name)}</strong>
                                <span>{tr(`settings.extensions.kind.${item.kind}`)}</span>
                              </div>
                              <p>{marketplaceItemDescription(item.id, item.description)}</p>
                              <small>
                                {item.publisher} · {tr("settings.extensions.version", [item.release.version])}
                              </small>
                              {bundled ? (
                                <small className="rm-marketplace-managed-note">
                                  {tr("settings.extensions.bundledManagement")}
                                </small>
                              ) : null}
                            </div>
                            {bundled ? (
                              <span className="included">{tr("settings.extensions.included")}</span>
                            ) : installation ? (
                              <div className="rm-marketplace-actions">
                                <span className={installation.status === "ready" ? "included" : "invalid"}>
                                  {tr(
                                    installation.status === "ready"
                                      ? installation.enabled
                                        ? "settings.extensions.enabled"
                                        : "settings.extensions.disabled"
                                      : "settings.extensions.invalid",
                                  )}
                                </span>
                                <button
                                  type="button"
                                  disabled={marketplaceInstalling !== null || installation.status !== "ready"}
                                  onClick={() => void setMarketplacePluginEnabled(item.id, !installation.enabled)}
                                >
                                  {tr(
                                    installation.enabled ? "settings.extensions.disable" : "settings.extensions.enable",
                                  )}
                                </button>
                                <button
                                  className={marketplaceRemoveConfirm === item.id ? "danger" : ""}
                                  type="button"
                                  disabled={marketplaceInstalling !== null}
                                  onClick={() => void removeMarketplacePlugin(item.id)}
                                >
                                  <Trash2 size={12} />
                                  {tr(
                                    marketplaceRemoveConfirm === item.id
                                      ? "settings.extensions.confirmRemove"
                                      : "settings.extensions.remove",
                                  )}
                                </button>
                              </div>
                            ) : item.kind === "plugin" ? (
                              <button
                                className="rm-marketplace-install"
                                type="button"
                                disabled={marketplaceInstalling !== null || item.status !== "available"}
                                onClick={() => void prepareMarketplacePluginInstall(item.id)}
                              >
                                {marketplaceInstalling === item.id ? (
                                  <RefreshCw className="spin" size={13} />
                                ) : (
                                  <Download size={13} />
                                )}
                                {tr("settings.extensions.install")}
                              </button>
                            ) : (
                              <span className="available">{tr("settings.extensions.available")}</span>
                            )}
                          </section>
                        );
                      })}
                      {unlistedMarketplaceInstallations.map((installation) => (
                            <section className="rm-marketplace-card" key={installation.pluginId}>
                              <div className="rm-provider-card-icon">
                                <Puzzle size={17} />
                              </div>
                              <div className="rm-marketplace-card-copy">
                                <div>
                                  <strong>{installation.name}</strong>
                                  <span>{tr("settings.extensions.kind.plugin")}</span>
                                  <span>
                                    {tr(
                                      installation.source === "local"
                                        ? "settings.extensions.sourceLocal"
                                        : "settings.extensions.sourceMarketplace",
                                    )}
                                  </span>
                                </div>
                                <p>
                                  {installation.description || tr(
                                    installation.source === "local"
                                      ? "settings.extensions.localDescription"
                                      : "settings.extensions.unlistedDescription",
                                  )}
                                </p>
                                <small>
                                  {installation.publisher} · {tr("settings.extensions.version", [installation.version])}
                                </small>
                                {installation.source === "local" ? (
                                  <small className="rm-marketplace-managed-note">
                                    {tr("settings.extensions.localDescription")}
                                  </small>
                                ) : null}
                              </div>
                              <div className="rm-marketplace-actions">
                                <span className={installation.status === "ready" ? "included" : "invalid"}>
                                  {tr(
                                    installation.status === "ready"
                                      ? installation.enabled
                                        ? "settings.extensions.enabled"
                                        : "settings.extensions.disabled"
                                      : "settings.extensions.invalid",
                                  )}
                                </span>
                                <button
                                  type="button"
                                  disabled={marketplaceInstalling !== null || installation.status !== "ready"}
                                  onClick={() =>
                                    void setMarketplacePluginEnabled(installation.pluginId, !installation.enabled)
                                  }
                                >
                                  {tr(
                                    installation.enabled ? "settings.extensions.disable" : "settings.extensions.enable",
                                  )}
                                </button>
                                <button
                                  className={marketplaceRemoveConfirm === installation.pluginId ? "danger" : ""}
                                  type="button"
                                  disabled={marketplaceInstalling !== null}
                                  onClick={() => void removeMarketplacePlugin(installation.pluginId)}
                                >
                                  <Trash2 size={12} />
                                  {tr(
                                    marketplaceRemoveConfirm === installation.pluginId
                                      ? "settings.extensions.confirmRemove"
                                      : "settings.extensions.remove",
                                  )}
                                </button>
                              </div>
                            </section>
                          ))}
                    </div>
                    {marketplaceCatalog ? (
                      <p className="rm-marketplace-revision">
                        {tr("settings.extensions.catalogRevision", [marketplaceCatalog.revision.slice(0, 19)])}
                      </p>
                    ) : null}
                    <div className="rm-settings-callout">
                      <ShieldCheck size={16} />
                      <div>
                        <strong>{tr("settings.extensions.signatureTitle")}</strong>
                        <p>{tr("settings.extensions.signatureDescription")}</p>
                      </div>
                      <span>{tr("settings.scope.accountSpace")}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {toolsCategory === "agents" && (
              <div className="rm-tools-embedded rm-tools-embedded-agent">{tools.agent}</div>
            )}
            {toolsCategory === "mcp" && <div className="rm-tools-embedded rm-tools-embedded-mcp">{tools.mcp}</div>}
          </>
        )}

        {activeView === "data" && (
          <>
            <PageHeading title={tr("settings.data.title")} description={tr("settings.data.description")} />
            <div className="rm-settings-callout rm-data-scope-callout">
              <ShieldCheck size={16} />
              <div>
                <strong>{tr("settings.localData.isolationTitle")}</strong>
                <p>{tr("settings.localData.isolationDescription")}</p>
              </div>
              <span>{tr("settings.localData.isolated")}</span>
            </div>
            <SettingsGroup
              title={tr("settings.localData.title")}
              description={tr("settings.localData.description")}
              icon={<Database size={17} />}
            >
              <DataMetric
                label={tr("settings.localData.currentAccount")}
                value={localData?.accountName ?? tr("settings.localData.guest")}
              />
              <DataMetric
                label={tr("settings.localData.currentSpace")}
                value={localData?.spaceName ?? tr("settings.localData.localSpace")}
              />
              <DataMetric
                label={tr("settings.localData.currentSpaceStorage")}
                value={localData ? formatBytes(localData.totalBytes) : tr("settings.localData.calculating")}
              />
              <DataMetric
                label={tr("settings.localData.database")}
                value={localData ? formatBytes(localData.databaseBytes) : "—"}
              />
              <DataMetric
                label={tr("settings.localData.other")}
                value={localData ? formatBytes(Math.max(0, localData.totalBytes - localData.databaseBytes)) : "—"}
              />
              <div className="rm-data-location">
                <div>
                  <strong>{tr("settings.localData.location")}</strong>
                  <code title={localData?.dataPath}>{localData?.dataPath ?? "—"}</code>
                </div>
                <button type="button" disabled={localDataBusy} onClick={() => void runLocalDataAction("show")}>
                  <FolderOpen size={14} />
                  {tr("settings.localData.open")}
                </button>
              </div>
              <div className="rm-database-health">
                <CheckCircle2 size={15} />
                <span>
                  {localData ? databaseHealthLabel(localData.databaseHealth) : tr("settings.localData.deviceCopy")}
                </span>
              </div>
              {localDataError && (
                <div className="rm-settings-error" role="alert">
                  {localDataError}
                </div>
              )}
            </SettingsGroup>
            <SettingsGroup
              title={tr("settings.localData.deviceSummaryTitle")}
              description={tr("settings.localData.deviceSummaryDescription")}
              icon={<HardDrive size={17} />}
            >
              <DataMetric
                label={tr("settings.localData.storedAccounts")}
                value={localData ? String(localData.storedAccountCount) : "—"}
              />
              <DataMetric
                label={tr("settings.localData.storedSpaces")}
                value={localData ? String(localData.storedSpaceCount) : "—"}
              />
              <DataMetric
                label={tr("settings.localData.allScopesStorage")}
                value={localData ? formatBytes(localData.allScopesBytes) : "—"}
              />
            </SettingsGroup>
            <SettingsGroup
              title={tr("settings.localData.manageScopesTitle")}
              description={tr("settings.localData.manageScopesDescription")}
              icon={<UsersRound size={17} />}
            >
              {dataScopes.length === 0 ? (
                <div className="rm-data-scopes-empty">{tr("settings.localData.noStoredScopes")}</div>
              ) : (
                dataScopes.map((scope) => (
                  <div className="rm-data-scope-row" key={scope.scopeId}>
                    <div>
                      <strong>{scope.spaceName}</strong>
                      <span>
                        {scope.accountName} · {formatBytes(scope.totalBytes)}
                      </span>
                    </div>
                    {scope.current ? (
                      <span className="rm-data-scope-current">{tr("settings.localData.current")}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={localDataBusy}
                        onClick={() => void removeDataScope(scope.scopeId)}
                      >
                        <Trash2 size={13} />
                        {tr("settings.localData.removeFromDevice")}
                      </button>
                    )}
                  </div>
                ))
              )}
            </SettingsGroup>
            <SettingsGroup
              title={tr("settings.backup.title")}
              description={tr("settings.backup.description")}
              icon={<Download size={17} />}
            >
              <SettingRow
                title={tr("settings.backup.exportTitle")}
                description={tr("settings.backup.exportDescription")}
              >
                <button type="button" disabled={localDataBusy} onClick={() => void runLocalDataAction("export")}>
                  <Download size={14} />
                  {tr("settings.localData.export")}
                </button>
              </SettingRow>
            </SettingsGroup>
            <section className="rm-danger-zone">
              <div>
                <h2>{tr("settings.danger.title")}</h2>
                <p>{tr("settings.danger.description")}</p>
              </div>
              <button type="button" disabled={localDataBusy} onClick={() => setClearOpen(true)}>
                <Trash2 size={14} />
                {tr("settings.localData.clearCurrentSpace")}
              </button>
            </section>
          </>
        )}

        {activeView === "about" && (
          <>
            <PageHeading title={tr("settings.about.title")} description={tr("settings.about.description")} />
            <SettingsGroup
              title="RouteMarket Work"
              description={tr("settings.about.productDescription")}
              icon={<Info size={17} />}
            >
              <DataMetric label={tr("settings.about.version")} value={appInfo?.version ?? "—"} />
              <DataMetric
                label={tr("settings.about.build")}
                value={appInfo ? buildLabel(appInfo.buildEnvironment) : "—"}
              />
              <DataMetric
                label={tr("settings.about.channel")}
                value={appInfo ? updateChannelLabel(appInfo.updateChannel) : "—"}
              />
              <SettingRow
                title={tr("settings.about.updates")}
                description={
                  appInfo?.updateEnabled
                    ? tr("settings.about.updatesDescription")
                    : tr("settings.about.updatesDisabled")
                }
              >
                <button
                  type="button"
                  disabled={updateBusy || !appInfo?.updateEnabled}
                  onClick={() => void checkForUpdates()}
                >
                  <RefreshCw className={updateBusy ? "spin" : ""} size={14} />
                  {tr("settings.about.checkUpdates")}
                </button>
              </SettingRow>
              {updateResult && (
                <div className="rm-settings-feedback" role="status">
                  {updateResult}
                </div>
              )}
            </SettingsGroup>
          </>
        )}
      </main>

      {marketplaceInstallPreview && (
        <div
          className="rm-settings-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && cancelMarketplacePluginInstall()}
        >
          <section
            className="rm-settings-modal rm-marketplace-permission-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketplace-install-title"
          >
            <div className="rm-settings-modal-icon">
              <ShieldCheck size={21} />
            </div>
            <h2 id="marketplace-install-title">{tr("settings.extensions.reviewTitle")}</h2>
            <p>
              {tr(
                marketplaceInstallPreview.source === "local"
                  ? "settings.extensions.localReviewDescription"
                  : "settings.extensions.reviewDescription",
              )}
            </p>
            <div className="rm-marketplace-review-identity">
              <strong>{marketplaceInstallPreview.name}</strong>
              <span>
                {marketplaceInstallPreview.publisher} · {marketplaceInstallPreview.version}
              </span>
              {marketplaceInstallPreview.description ? <p>{marketplaceInstallPreview.description}</p> : null}
            </div>
            <div className="rm-marketplace-review-section">
              <strong>{tr("settings.extensions.permissionsTitle")}</strong>
              {marketplaceInstallPreview.permissions.length ? (
                <ul>
                  {marketplaceInstallPreview.permissions.map((permission) => (
                    <li key={permission}>{marketplacePermissionLabel(permission)}</li>
                  ))}
                </ul>
              ) : (
                <p>{tr("settings.extensions.noPermissions")}</p>
              )}
            </div>
            <div className="rm-marketplace-review-section">
              <strong>{tr("settings.extensions.capabilitiesTitle")}</strong>
              <ul>
                <li>{tr("settings.extensions.toolCount", [marketplaceInstallPreview.tools.length])}</li>
                <li>{tr("settings.extensions.viewerCount", [marketplaceInstallPreview.viewers.length])}</li>
                <li>{tr("settings.extensions.workflowCount", [marketplaceInstallPreview.workflowNodes.length])}</li>
                <li>{tr("settings.extensions.connectorCount", [marketplaceInstallPreview.connectors.length])}</li>
                <li>{tr("settings.extensions.navigationCount", [marketplaceInstallPreview.navigation.length])}</li>
                <li>{tr("settings.extensions.pageCount", [marketplaceInstallPreview.pages.length])}</li>
                <li>{tr("settings.extensions.modelCount", [marketplaceInstallPreview.models.length])}</li>
              </ul>
            </div>
            <div className="rm-settings-callout">
              <ShieldCheck size={16} />
              <div>
                <strong>
                  {tr(
                    marketplaceInstallPreview.source === "local"
                      ? "settings.extensions.localVerifiedTitle"
                      : "settings.extensions.verifiedTitle",
                  )}
                </strong>
                <p>
                  {tr(
                    marketplaceInstallPreview.source === "local"
                      ? "settings.extensions.localVerifiedDescription"
                      : "settings.extensions.verifiedDescription",
                  )}
                </p>
              </div>
            </div>
            <div className="rm-settings-modal-actions">
              <button type="button" disabled={marketplaceInstalling !== null} onClick={cancelMarketplacePluginInstall}>
                {tr("settings.providers.cancel")}
              </button>
              <button
                className="primary"
                type="button"
                disabled={marketplaceInstalling !== null}
                onClick={() => void confirmMarketplacePluginInstall()}
              >
                {marketplaceInstalling ? <RefreshCw className="spin" size={14} /> : <Download size={14} />}{" "}
                {tr("settings.extensions.confirmInstall")}
              </button>
            </div>
          </section>
        </div>
      )}

      {providerDraft && (
        <div
          className="rm-settings-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setProviderDraft(null)}
        >
          <section
            className="rm-settings-modal rm-provider-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-editor-title"
          >
            <div className="rm-settings-modal-icon">
              <KeyRound size={21} />
            </div>
            <h2 id="provider-editor-title">
              {tr(providerDraft.id ? "settings.providers.editTitle" : "settings.providers.addTitle")}
            </h2>
            <p>{tr("settings.providers.formDescription")}</p>
            <div className="rm-provider-form">
              <label>
                <span>{tr("settings.providers.template")}</span>
                <RouteMarketSelect
                  autoFocus
                  label={tr("settings.providers.template")}
                  value={providerTemplate}
                  options={[
                    ...PROVIDER_TEMPLATES.map((template) => ({ value: template.id, label: template.name })),
                    { value: "custom", label: tr("settings.providers.custom") },
                  ]}
                  onChange={(value) => changeProviderTemplate(value as ProviderTemplateId)}
                />
              </label>
              {providerTemplate === "custom" || providerTemplate === "local" ? (
                <>
                  <label>
                    <span>{tr("settings.providers.name")}</span>
                    <input
                      value={providerDraft.name}
                      onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
                      placeholder={tr("settings.providers.namePlaceholder")}
                    />
                  </label>
                  <label>
                    <span>{tr("settings.providers.protocol")}</span>
                    <RouteMarketSelect
                      label={tr("settings.providers.protocol")}
                      value={providerDraft.protocol}
                      options={[
                        { value: "openai-compatible", label: tr("settings.providers.openai") },
                        { value: "anthropic", label: tr("settings.providers.anthropic") },
                      ]}
                      onChange={(value) => changeProviderProtocol(value as ModelProviderProtocol)}
                    />
                  </label>
                  <label>
                    <span>{tr("settings.providers.baseUrl")}</span>
                    <input
                      value={providerDraft.baseUrl}
                      onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })}
                      spellCheck={false}
                    />
                  </label>
                </>
              ) : (
                <div className="rm-provider-template-summary">
                  <div>
                    <span>{tr("settings.providers.protocol")}</span>
                    <strong>
                      {providerDraft.protocol === "anthropic"
                        ? tr("settings.providers.anthropic")
                        : tr("settings.providers.openai")}
                    </strong>
                  </div>
                  <div>
                    <span>{tr("settings.providers.baseUrl")}</span>
                    <code>{providerDraft.baseUrl}</code>
                  </div>
                </div>
              )}
              <label>
                <span>{tr("settings.providers.instanceName")}</span>
                <input
                  value={providerDraft.instanceName ?? ""}
                  onChange={(event) => setProviderDraft({ ...providerDraft, instanceName: event.target.value })}
                  placeholder={tr("settings.providers.instanceNamePlaceholder")}
                />
                <small>{tr("settings.providers.instanceNameDescription")}</small>
              </label>
              <label>
                <span>{tr("settings.providers.compatibility")}</span>
                <RouteMarketSelect
                  label={tr("settings.providers.compatibility")}
                  value={providerDraft.compatibility ?? "standard"}
                  options={[
                    { value: "standard", label: tr("settings.providers.compatibilityStandard") },
                    { value: "openrouter", label: "OpenRouter" },
                    { value: "opencode", label: "OpenCode" },
                    { value: "nine-router", label: "9Router" },
                    { value: "custom", label: tr("settings.providers.compatibilityCustom") },
                  ]}
                  onChange={(value) =>
                    setProviderDraft({ ...providerDraft, compatibility: value as ModelProviderCompatibility })
                  }
                />
              </label>
              <label>
                <span>{tr("settings.providers.apiKey")}</span>
                <input
                  type="password"
                  value={providerDraft.apiKey ?? ""}
                  onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })}
                  autoComplete="off"
                  placeholder={
                    providerDraft.id ? tr("settings.providers.apiKeyKeep") : tr("settings.providers.apiKeyPlaceholder")
                  }
                />
              </label>
              <div className="rm-provider-security-note">
                <LockKeyhole size={15} />
                <div>
                  <strong>{tr("settings.providers.localKeyHint")}</strong>
                  <span>{tr("settings.providers.dataDestination", [providerDestination(providerDraft.baseUrl)])}</span>
                </div>
              </div>
              <label className="rm-provider-enabled">
                <input
                  type="checkbox"
                  checked={providerDraft.enabled}
                  onChange={(event) => setProviderDraft({ ...providerDraft, enabled: event.target.checked })}
                />
                <span>{tr("settings.providers.enabled")}</span>
              </label>
              <div className="rm-provider-manual-models rm-provider-headers">
                <div className="rm-provider-manual-heading">
                  <div>
                    <span>{tr("settings.providers.customHeaders")}</span>
                    <small>{tr("settings.providers.customHeadersDescription")}</small>
                  </div>
                  <button type="button" onClick={addProviderHeader}>
                    <Plus size={13} />
                    {tr("settings.providers.addHeader")}
                  </button>
                </div>
                {(providerDraft.headers ?? []).length ? (
                  <div className="rm-provider-manual-list">
                    {(providerDraft.headers ?? []).map((header, index) => (
                      <div className="rm-provider-manual-model" key={`header-${index}`}>
                        <div className="rm-provider-manual-fields">
                          <label>
                            <span>{tr("settings.providers.headerName")}</span>
                            <input
                              value={header.name}
                              spellCheck={false}
                              placeholder="User-Agent"
                              onChange={(event) => updateProviderHeader(index, { name: event.target.value })}
                            />
                          </label>
                          <label>
                            <span>{tr("settings.providers.headerValue")}</span>
                            <input
                              value={header.value}
                              spellCheck={false}
                              placeholder="RouteMarket-Desktop"
                              onChange={(event) => updateProviderHeader(index, { value: event.target.value })}
                            />
                          </label>
                          <button
                            className="rm-provider-manual-remove"
                            type="button"
                            title={tr("settings.providers.removeHeader")}
                            onClick={() => removeProviderHeader(index)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {(providerDraft.models ?? []).some((model) => model.source === "synced") ? (
                <div className="rm-provider-synced-models">
                  <div className="rm-provider-synced-heading">
                    <span>{tr("settings.providers.syncedModels")}</span>
                    <small>
                      {tr("settings.providers.modelCount", [
                        (providerDraft.models ?? []).filter((model) => model.source === "synced").length,
                      ])}
                    </small>
                  </div>
                  <p>{tr("settings.providers.syncedModelsDescription")}</p>
                  <div className="rm-provider-synced-list">
                    {(providerDraft.models ?? []).map((model, index) =>
                      model.source === "synced" ? (
                        <details className="rm-provider-synced-model" key={model.id}>
                          <summary>
                            <span>{model.displayName}</span>
                            <code>{model.id}</code>
                            <em>
                              {tr(
                                model.pricing
                                  ? "settings.providers.priceConfigured"
                                  : "settings.providers.priceNotConfigured",
                              )}
                            </em>
                          </summary>
                          <ModelPricingFields
                            pricing={model.pricing}
                            onChange={(pricing) => updateProviderModel(index, { pricing })}
                          />
                        </details>
                      ) : null,
                    )}
                  </div>
                </div>
              ) : null}
              <div className="rm-provider-manual-models">
                <div className="rm-provider-manual-heading">
                  <div>
                    <span>{tr("settings.providers.manualModels")}</span>
                    <small>{tr("settings.providers.manualModelsDescription")}</small>
                  </div>
                  <button type="button" onClick={addManualModel}>
                    <Plus size={13} />
                    {tr("settings.providers.addManualModel")}
                  </button>
                </div>
                {(providerDraft.models ?? []).some((model) => model.source === "manual") ? (
                  <div className="rm-provider-manual-list">
                    {(providerDraft.models ?? []).map((model, index) =>
                      model.source === "manual" ? (
                        <div className="rm-provider-manual-model" key={`manual-${index}`}>
                          <div className="rm-provider-manual-fields">
                            <label>
                              <span>{tr("settings.providers.modelId")}</span>
                              <input
                                value={model.id}
                                spellCheck={false}
                                placeholder={tr("settings.providers.modelIdPlaceholder")}
                                onChange={(event) => updateProviderModel(index, { id: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>{tr("settings.providers.modelDisplayName")}</span>
                              <input
                                value={model.displayName}
                                placeholder={tr("settings.providers.modelDisplayNamePlaceholder")}
                                onChange={(event) => updateProviderModel(index, { displayName: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>{tr("settings.providers.modelCategory")}</span>
                              <select
                                value={model.category}
                                onChange={(event) => updateProviderModel(index, {
                                  category: event.target.value as ModelProviderModel["category"],
                                })}
                              >
                                <option value="chat">{tr("settings.providers.categoryChat")}</option>
                                <option value="reasoning">{tr("settings.providers.categoryReasoning")}</option>
                                <option value="image">{tr("settings.providers.categoryImage")}</option>
                                <option value="video">{tr("settings.providers.categoryVideo")}</option>
                                <option value="audio">{tr("settings.providers.categoryAudio")}</option>
                              </select>
                            </label>
                            <button
                              className="rm-provider-manual-remove"
                              type="button"
                              title={tr("settings.providers.removeManualModel")}
                              onClick={() => removeProviderModel(index)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {model.category === "chat" || model.category === "reasoning" ? (
                            <ModelPricingFields
                              pricing={model.pricing}
                              onChange={(pricing) => updateProviderModel(index, { pricing })}
                            />
                          ) : null}
                        </div>
                      ) : null,
                    )}
                  </div>
                ) : (
                  <div className="rm-provider-manual-empty">{tr("settings.providers.manualModelsEmpty")}</div>
                )}
              </div>
            </div>
            {providerError && (
              <div className="rm-settings-error" role="alert">
                {providerError}
              </div>
            )}
            <div className="rm-settings-modal-actions">
              <button type="button" disabled={providerBusy !== null} onClick={() => setProviderDraft(null)}>
                {tr("settings.providers.cancel")}
              </button>
              <button
                className="primary"
                type="button"
                disabled={
                  providerBusy !== null ||
                  !providerDraft.name.trim() ||
                  !providerDraft.baseUrl.trim() ||
                  (!providerDraft.id && !providerDraft.apiKey?.trim() && !isLoopbackProviderUrl(providerDraft.baseUrl)) ||
                  hasInvalidManualModels(providerDraft.models ?? []) ||
                  hasInvalidProviderHeaders(providerDraft.headers ?? [])
                }
                onClick={() => void saveProvider()}
              >
                {providerBusy ? <RefreshCw className="spin" size={14} /> : <KeyRound size={14} />}{" "}
                {tr("settings.providers.saveAndSync")}
              </button>
            </div>
          </section>
        </div>
      )}

      {clearOpen && (
        <div
          className="rm-settings-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setClearOpen(false)}
        >
          <section className="rm-settings-modal" role="dialog" aria-modal="true" aria-labelledby="clear-data-title">
            <div className="rm-settings-modal-icon">
              <AlertTriangle size={21} />
            </div>
            <h2 id="clear-data-title">{tr("settings.clearDialog.title")}</h2>
            <p>{tr("settings.clearDialog.description")}</p>
            <ul>
              <li>{tr("settings.clearDialog.itemConversations")}</li>
              <li>{tr("settings.clearDialog.itemProjects")}</li>
              <li>{tr("settings.clearDialog.itemRuns")}</li>
            </ul>
            <div className="rm-settings-modal-note">{tr("settings.localData.note")}</div>
            <div className="rm-settings-modal-actions">
              <button type="button" disabled={localDataBusy} onClick={() => setClearOpen(false)}>
                {tr("settings.clearDialog.cancel")}
              </button>
              <button
                className="danger"
                type="button"
                disabled={localDataBusy}
                onClick={() => void runLocalDataAction("clear")}
              >
                <Trash2 size={14} />
                {tr("settings.clearDialog.confirm")}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="rm-settings-page-heading">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function SettingsGroup({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rm-settings-group">
      <header>
        {icon}
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="rm-settings-group-body">{children}</div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  scope,
  children,
}: {
  title: string;
  description?: string;
  scope?: string;
  children: ReactNode;
}) {
  return (
    <div className="rm-setting-row">
      <div className="rm-setting-copy">
        <div>
          <strong>{title}</strong>
          {scope && <span>{scope}</span>}
        </div>
        {description && <p>{description}</p>}
      </div>
      <div className="rm-setting-control">{children}</div>
    </div>
  );
}

function DataMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rm-data-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ThemeButton({ active, onClick, children }: { active: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className={active ? "active" : ""} aria-pressed={active} onClick={onClick}>
      {children}
    </button>
  );
}

function databaseHealthLabel(health: LocalDataInfo["databaseHealth"]) {
  if (health === "healthy") return tr("settings.localData.healthy");
  if (health === "empty") return tr("settings.localData.empty");
  return tr("settings.localData.corrupt");
}

function buildLabel(build: DesktopAppInfo["buildEnvironment"]) {
  return tr(`settings.about.build.${build}`);
}

function updateChannelLabel(channel: DesktopAppInfo["updateChannel"]) {
  return tr(`settings.about.channel.${channel}`);
}

function marketplaceItemDescription(itemId: string, fallback: string) {
  const keys = {
    "ai.routemarket.browser": "settings.extensions.catalog.browserDescription",
    "ai.routemarket.spreadsheet": "settings.extensions.catalog.spreadsheetDescription",
    "ai.routemarket.pdf": "settings.extensions.catalog.pdfDescription",
  } as const;
  return itemId in keys ? tr(keys[itemId as keyof typeof keys]) : fallback;
}

function marketplaceItemName(itemId: string, fallback: string) {
  const names: Record<string, string> = {
    "ai.routemarket.browser": "Browser",
    "ai.routemarket.pdf": "PDF",
    "ai.routemarket.spreadsheet": "Spreadsheet",
  };
  return names[itemId] ?? fallback;
}

function marketplacePermissionLabel(permission: string) {
  const keys: Record<string, Parameters<typeof tr>[0]> = {
    "project.read": "settings.extensions.permission.project.read",
    "project.write": "settings.extensions.permission.project.write",
    network: "settings.extensions.permission.network",
    process: "settings.extensions.permission.process",
    external_apps: "settings.extensions.permission.external_apps",
    "browser.read": "settings.extensions.permission.browser.read",
    "browser.interact": "settings.extensions.permission.browser.interact",
    "artifact.read": "settings.extensions.permission.artifact.read",
    "artifact.write": "settings.extensions.permission.artifact.write",
    "device.gpu": "settings.extensions.permission.device.gpu",
    "data.read": "settings.extensions.permission.data.read",
    "media.read": "settings.extensions.permission.media.read",
    "media.write": "settings.extensions.permission.media.write",
    "media.upload.cloud": "settings.extensions.permission.media.upload.cloud",
    "models.manage": "settings.extensions.permission.models.manage",
    "models.invoke.local": "settings.extensions.permission.models.invoke.local",
    "models.invoke.cloud": "settings.extensions.permission.models.invoke.cloud",
    "biometric.face": "settings.extensions.permission.biometric.face",
    "biometric.voice": "settings.extensions.permission.biometric.voice",
  };
  return keys[permission] ? tr(keys[permission]) : permission;
}

function errorMessage(error: unknown, fallback: Parameters<typeof tr>[0]) {
  return error instanceof Error ? error.message : tr(fallback);
}

function inferProviderTemplate(provider: Pick<ModelProviderSummary, "protocol" | "baseUrl">): ProviderTemplateId {
  return (
    PROVIDER_TEMPLATES.find(
      (template) => template.protocol === provider.protocol && template.baseUrl === provider.baseUrl,
    )?.id ?? "custom"
  );
}

function compatibilityLabel(compatibility: ModelProviderCompatibility): string {
  if (compatibility === "openrouter") return "OpenRouter";
  if (compatibility === "opencode") return "OpenCode";
  if (compatibility === "nine-router") return "9Router";
  if (compatibility === "custom") return tr("settings.providers.compatibilityCustom");
  return tr("settings.providers.openai");
}

function providerDestination(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.hostname || tr("settings.providers.destinationUnknown");
  } catch {
    return tr("settings.providers.destinationUnknown");
  }
}

function hasInvalidProviderHeaders(headers: ModelProviderHeader[]): boolean {
  const names = headers.map((header) => header.name.trim().toLowerCase()).filter(Boolean);
  return (
    headers.some(
      (header) => !header.name.trim() || !header.value.trim() || /[\r\n\0]/.test(header.name + header.value),
    ) || new Set(names).size !== names.length
  );
}

function localGatewayModelId(model: ChatModel): string {
  if (model.source === "routemarket") return `routemarket/${model.code}`;
  const bytes = new TextEncoder().encode(model.code);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `byok/${model.providerId ?? "provider"}/${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export function gatewayModelLabel(
  id: string,
  models: ChatModel[],
  providerId?: string | null,
  providerName?: string,
): string {
  const matchesId = (candidate: ChatModel) =>
    localGatewayModelId(candidate) === id || candidate.code === id || decodeExternalModelId(candidate.code) === id;
  const model = providerId
    ? models.find((candidate) => candidate.providerId === providerId && matchesId(candidate))
    : models.find((candidate) => matchesId(candidate));
  const provider = providerName?.trim() || model?.providerName;
  const displayName = model?.displayName ?? readableGatewayModelId(id);
  return provider ? `${provider} · ${displayName}` : displayName;
}

function readableGatewayModelId(id: string): string {
  const routeMarket = /^routemarket\/(.+)$/.exec(id);
  if (routeMarket) return routeMarket[1]!;
  const external = /^byok\/[^/]+\/([A-Za-z0-9_-]+)$/.exec(id);
  if (!external) return id;
  try {
    const encoded = external[1]!.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))) || id;
  } catch {
    return id;
  }
}

function createManualModel(): ModelProviderModel {
  return {
    id: "",
    displayName: "",
    source: "manual",
    category: "chat",
    supportsTools: false,
    supportsVision: false,
    supportsStream: true,
    supportsReasoningSummary: false,
  };
}

function ModelPricingFields({
  pricing,
  onChange,
}: {
  pricing: ModelTokenPricing | null | undefined;
  onChange(pricing: ModelTokenPricing | null): void;
}) {
  return (
    <div className="rm-provider-pricing">
      <div>
        <span>{tr("settings.providers.referencePricing")}</span>
        <small>{tr("settings.providers.referencePricingDescription")}</small>
      </div>
      <div className="rm-provider-pricing-fields">
        <PricingInput
          label={tr("settings.providers.inputPrice")}
          value={pricing?.inputUsdPerMillion}
          onChange={(value) => onChange(updatePricing(pricing, "inputUsdPerMillion", value))}
        />
        <PricingInput
          label={tr("settings.providers.outputPrice")}
          value={pricing?.outputUsdPerMillion}
          onChange={(value) => onChange(updatePricing(pricing, "outputUsdPerMillion", value))}
        />
        <PricingInput
          label={tr("settings.providers.cacheReadPrice")}
          value={pricing?.cacheReadUsdPerMillion}
          onChange={(value) => onChange(updatePricing(pricing, "cacheReadUsdPerMillion", value))}
        />
        <PricingInput
          label={tr("settings.providers.cacheWritePrice")}
          value={pricing?.cacheWriteUsdPerMillion}
          onChange={(value) => onChange(updatePricing(pricing, "cacheWriteUsdPerMillion", value))}
        />
      </div>
    </div>
  );
}

function PricingInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  onChange(value: number | null): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        max="1000000"
        step="0.01"
        inputMode="decimal"
        value={value ?? ""}
        placeholder="—"
        onChange={(event) => onChange(parseOptionalPrice(event.target.value))}
      />
    </label>
  );
}

function updatePricing(
  current: ModelTokenPricing | null | undefined,
  field: keyof Omit<ModelTokenPricing, "currency">,
  value: number | null,
): ModelTokenPricing | null {
  const next: ModelTokenPricing = {
    currency: "USD",
    inputUsdPerMillion: current?.inputUsdPerMillion ?? null,
    outputUsdPerMillion: current?.outputUsdPerMillion ?? null,
    cacheReadUsdPerMillion: current?.cacheReadUsdPerMillion ?? null,
    cacheWriteUsdPerMillion: current?.cacheWriteUsdPerMillion ?? null,
    [field]: value,
  };
  return next.inputUsdPerMillion === null &&
    next.outputUsdPerMillion === null &&
    next.cacheReadUsdPerMillion === null &&
    next.cacheWriteUsdPerMillion === null
    ? null
    : next;
}

function parseOptionalPrice(value: string): number | null {
  if (!value.trim()) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function hasInvalidManualModels(models: ModelProviderModel[]): boolean {
  const ids = models.filter((model) => model.source === "manual").map((model) => model.id.trim());
  return ids.some((id) => !id || id.length > 200 || /[\r\n\0]/.test(id)) || new Set(ids).size !== ids.length;
}

function isLoopbackProviderUrl(value: string): boolean {
  try {
    const hostname = new URL(value.trim()).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function decodeExternalModelId(code: string): string | null {
  const match = /^external:provider_[a-f0-9]{32}:([A-Za-z0-9_-]+)$/.exec(code);
  if (!match) return null;
  try {
    const encoded = match[1]!.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))) || null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
}
