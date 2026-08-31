import "./media.scss";
import {
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Download,
  Eye,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Lightbulb,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Video,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  MediaGenerationOutput,
  MediaInspirationPost,
  MediaInspirationSort,
  MediaInspirationTag,
  MediaModel,
  MediaModelCategory,
  RouteMarketWorkApi,
} from "../../../../shared/desktop-api";
import { tr } from "../../i18n";
import { ChatModelIcon } from "../chat/components/ChatModelIcon";
import { WorkspaceCreationModeTabs, type WorkspaceCreationMode } from "../../app/WorkspaceCreationModeTabs";

const MODEL_STORAGE_PREFIX = "routemarket.work.media-model";

type MediaConversationTurn = {
  id: string;
  kind: MediaModelCategory;
  prompt: string;
  modelName: string;
  settings: string;
  count: number;
  size: string;
  credits: number | null;
  startedAt: number;
  completedAt: number | null;
  status: "pending" | "completed" | "failed";
  outputs: MediaGenerationOutput[];
  error: string | null;
};

export function MediaGenerationPage({
  api,
  kind,
  onManageLocalModels,
  onCreationModeChange,
}: {
  api: RouteMarketWorkApi;
  kind: MediaModelCategory;
  onManageLocalModels?(): void;
  onCreationModeChange(mode: WorkspaceCreationMode): void;
}) {
  const [models, setModels] = useState<MediaModel[]>([]);
  const [modelCode, setModelCode] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [surfaceView, setSurfaceView] = useState<"create" | "inspiration">("create");
  const [inspirationPosts, setInspirationPosts] = useState<MediaInspirationPost[]>([]);
  const [inspirationTags, setInspirationTags] = useState<MediaInspirationTag[]>([]);
  const [inspirationLoading, setInspirationLoading] = useState(false);
  const [inspirationError, setInspirationError] = useState<string | null>(null);
  const [inspirationSort, setInspirationSort] = useState<MediaInspirationSort>("trending");
  const [inspirationQuery, setInspirationQuery] = useState("");
  const [inspirationTag, setInspirationTag] = useState("");
  const [inspirationCursor, setInspirationCursor] = useState<string | null>(null);
  const [inspirationHasMore, setInspirationHasMore] = useState(false);
  const [activeMode, setActiveMode] = useState(defaultMediaMode(kind));
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<MediaConversationTurn[]>([]);
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("standard");
  const [count, setCount] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [format, setFormat] = useState("mp3");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);

  const selectedModel = useMemo(() => models.find((model) => model.code === modelCode) ?? null, [modelCode, models]);
  const cloudModels = useMemo(() => models.filter((model) => model.source === "routemarket"), [models]);
  const localModels = useMemo(() => models.filter((model) => model.source === "local"), [models]);
  const imageSizeOptions = useMemo(() => mediaImageSizeOptions(selectedModel), [selectedModel]);
  const imageQualityOptions = useMemo(() => mediaImageQualityOptions(selectedModel), [selectedModel]);
  const imageCountOptions = useMemo(() => mediaImageCountOptions(selectedModel), [selectedModel]);
  const selectionPrice = useMemo(() => {
    if (!selectedModel) return null;
    if (kind !== "image") return selectedModel.price;
    const capabilities = selectedModel.imageCapabilities;
    return capabilities?.prices.length
      ? resolveMediaImageSelectionPrice(selectedModel, size, quality, count)
      : selectedModel.price;
  }, [count, kind, quality, selectedModel, size]);
  const imageSelectionUnavailable = kind === "image"
    && selectedModel?.source === "routemarket"
    && Boolean(selectedModel.imageCapabilities?.prices.length)
    && selectionPrice === null;

  useEffect(() => {
    let disposed = false;
    setLoadingModels(true);
    setError(null);
    setConversation([]);
    setPrompt("");
    setSurfaceView("create");
    setInspirationPosts([]);
    setInspirationTags([]);
    setInspirationError(null);
    setInspirationQuery("");
    setInspirationTag("");
    setActiveMode(defaultMediaMode(kind));
    void api
      .listMediaModels(kind)
      .then((items) => {
        if (disposed) return;
        setModels(items);
        const preferred = window.localStorage.getItem(`${MODEL_STORAGE_PREFIX}.${kind}`);
        setModelCode(items.some((item) => item.code === preferred) ? preferred! : (items[0]?.code ?? ""));
      })
      .catch((nextError) => {
        if (!disposed) setError(errorMessage(nextError, tr("media.models.loadError")));
      })
      .finally(() => {
        if (!disposed) setLoadingModels(false);
      });
    return () => {
      disposed = true;
    };
  }, [api, kind]);

  useEffect(() => {
    if (surfaceView !== "inspiration") return;
    if (typeof api.listMediaInspiration !== "function") {
      setInspirationLoading(false);
      setInspirationError(tr("media.inspiration.bridgeUnavailable"));
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      setInspirationLoading(true);
      setInspirationError(null);
      void api.listMediaInspiration({
        kind,
        sort: inspirationSort,
        ...(inspirationQuery.trim() ? { query: inspirationQuery.trim() } : {}),
        ...(inspirationTag ? { officialTag: inspirationTag } : {}),
      }).then((page) => {
        if (disposed) return;
        setInspirationPosts(page.items);
        setInspirationCursor(page.nextCursor);
        setInspirationHasMore(page.hasMore);
      }).catch((nextError) => {
        if (!disposed) setInspirationError(errorMessage(nextError, tr("media.inspiration.loadError")));
      }).finally(() => {
        if (!disposed) setInspirationLoading(false);
      });
    }, 180);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [api, inspirationQuery, inspirationSort, inspirationTag, kind, surfaceView]);

  useEffect(() => {
    if (surfaceView !== "inspiration" || inspirationTags.length > 0) return;
    if (typeof api.listMediaInspirationTags !== "function") return;
    let disposed = false;
    void api.listMediaInspirationTags(kind).then((tags) => {
      if (!disposed) setInspirationTags(tags);
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [api, inspirationTags.length, kind, surfaceView]);

  useEffect(() => {
    if (kind !== "image" || !selectedModel) return;
    const nextSize = pickMediaOption(
      imageSizeOptions,
      selectedModel.imageCapabilities?.defaultSize,
      "1024x1024"
    );
    const nextQuality = pickMediaOption(
      imageQualityOptions,
      selectedModel.imageCapabilities?.defaultQuality,
      selectedModel.source === "local" ? "standard" : ""
    );
    setSize(nextSize);
    setQuality(nextQuality);
    setCount(pickMediaCount(imageCountOptions, selectedModel.imageCapabilities?.defaultCount ?? 1));
  }, [imageCountOptions, imageQualityOptions, imageSizeOptions, kind, selectedModel]);

  useEffect(() => {
    if (!modelPickerOpen && !settingsOpen) return;
    function closePicker(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setModelPickerOpen(false);
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModelPickerOpen(false);
        setSettingsOpen(false);
      }
    }
    document.addEventListener("pointerdown", closePicker, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePicker, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelPickerOpen, settingsOpen]);

  useEffect(() => {
    if (surfaceView !== "create" || conversation.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      pageRef.current?.scrollTo({ top: pageRef.current.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversation, surfaceView]);

  function selectModel(code: string) {
    setModelCode(code);
    setModelPickerOpen(false);
    window.localStorage.setItem(`${MODEL_STORAGE_PREFIX}.${kind}`, code);
  }

  async function generate() {
    const normalizedPrompt = prompt.trim();
    if (!modelCode || !normalizedPrompt || generating) return;
    if (imageSelectionUnavailable) {
      setError(tr("media.image.selectionUnavailable"));
      return;
    }
    const turnId = crypto.randomUUID();
    const startedAt = Date.now();
    const turn: MediaConversationTurn = {
      id: turnId,
      kind,
      prompt: normalizedPrompt,
      modelName: selectedModel?.displayName ?? modelCode,
      settings: settingsSummary(kind, { size, quality, count, durationSeconds, format }),
      count: kind === "image" ? count : 1,
      size: kind === "image" ? size : kind === "video" ? "16x9" : "",
      credits: selectionPrice ?? null,
      startedAt,
      completedAt: null,
      status: "pending",
      outputs: [],
      error: null,
    };
    setConversation((current) => [...current, turn]);
    setPrompt("");
    setGenerating(true);
    setError(null);
    try {
      const result = await api.generateMedia({
        kind,
        model: modelCode,
        prompt: normalizedPrompt,
        ...(kind === "image" ? { size, count, ...(quality ? { quality } : {}) } : {}),
        ...(kind === "video" ? { durationSeconds } : {}),
        ...(kind === "audio" ? { format } : {}),
      });
      setConversation((current) => current.map((item) => item.id === turnId
        ? { ...item, status: "completed", completedAt: Date.now(), outputs: result.outputs }
        : item));
    } catch (nextError) {
      const message = errorMessage(nextError, tr("media.generate.error"));
      setConversation((current) => current.map((item) => item.id === turnId
        ? { ...item, status: "failed", completedAt: Date.now(), error: message }
        : item));
    } finally {
      setGenerating(false);
    }
  }

  async function loadMoreInspiration() {
    if (!inspirationCursor || inspirationLoading) return;
    setInspirationLoading(true);
    setInspirationError(null);
    try {
      const page = await api.listMediaInspiration({
        kind,
        sort: inspirationSort,
        cursor: inspirationCursor,
        ...(inspirationQuery.trim() ? { query: inspirationQuery.trim() } : {}),
        ...(inspirationTag ? { officialTag: inspirationTag } : {}),
      });
      setInspirationPosts((current) => {
        const known = new Set(current.map((post) => post.id));
        return [...current, ...page.items.filter((post) => !known.has(post.id))];
      });
      setInspirationCursor(page.nextCursor);
      setInspirationHasMore(page.hasMore);
    } catch (nextError) {
      setInspirationError(errorMessage(nextError, tr("media.inspiration.loadError")));
    } finally {
      setInspirationLoading(false);
    }
  }

  function useInspiration(post: MediaInspirationPost) {
    const nextPrompt = post.prompt ?? post.title ?? "";
    if (nextPrompt) setPrompt(nextPrompt);
    if (post.modelCode && models.some((model) => model.code === post.modelCode)) selectModel(post.modelCode);
    setSurfaceView("create");
  }

  const copy = mediaCopy(kind);
  const showStarterCards = surfaceView === "create" && conversation.length === 0;

  return (
    <section className={`media-page media-page-${kind}`} ref={pageRef}>
      <div className="media-page-inner">
        <header className={`media-hero${surfaceView === "inspiration" ? " inspiration" : ""}`}>
          {surfaceView === "create" && (
            <>
              <h1>{copy.title}</h1>
              <p>{copy.description}</p>
            </>
          )}
          <div className="media-view-switch" role="tablist" aria-label={tr("media.view.label")}>
            <button
              type="button"
              role="tab"
              aria-selected={surfaceView === "create"}
              className={surfaceView === "create" ? "active" : ""}
              onClick={() => setSurfaceView("create")}
            >
              {tr("media.view.create")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={surfaceView === "inspiration"}
              className={surfaceView === "inspiration" ? "active" : ""}
              onClick={() => setSurfaceView("inspiration")}
            >
              {tr("media.view.inspiration")}
            </button>
          </div>
        </header>

        {showStarterCards && (
          <section className="media-starter-stage">
            <div className="media-starter-grid">
              {copy.starters.map((starter, index) => (
                <button
                  type="button"
                  className={`media-starter-card tone-${index + 1}`}
                  key={starter.title}
                  onClick={() => {
                    setPrompt(starter.prompt);
                    setSurfaceView("create");
                  }}
                >
                  <span>{starter.badge}</span>
                  <strong>{starter.title}</strong>
                </button>
              ))}
            </div>
          </section>
        )}

        {surfaceView === "inspiration" && (
          <section className="media-inspiration-stage">
            <p className="media-inspiration-description">{tr(`media.inspiration.${kind}.description`)}</p>
            <div className="media-inspiration-toolbar">
              <div className="media-inspiration-sorts" role="tablist" aria-label={tr("media.inspiration.sortLabel")}>
                {(["newest", "trending", "featured"] as const).map((sort) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={inspirationSort === sort}
                    className={inspirationSort === sort ? "active" : ""}
                    key={sort}
                    onClick={() => setInspirationSort(sort)}
                  >
                    {tr(`media.inspiration.sort.${sort}`)}
                  </button>
                ))}
              </div>
              <label className="media-inspiration-search">
                <Search size={14} />
                <input
                  type="search"
                  value={inspirationQuery}
                  placeholder={tr("media.inspiration.search")}
                  onChange={(event) => setInspirationQuery(event.target.value)}
                />
              </label>
            </div>
            {kind === "image" && (
              <div className="media-inspiration-tags" aria-label={tr("media.inspiration.tags")}>
                <span>{tr("media.inspiration.tags")}</span>
                {inspirationTags.map(({ code, label }) => (
                  <button
                    type="button"
                    className={inspirationTag === code ? "active" : ""}
                    key={code}
                    onClick={() => setInspirationTag((current) => current === code ? "" : code)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {inspirationLoading && inspirationPosts.length === 0 ? (
              <div className="media-inspiration-skeleton" aria-label={tr("media.inspiration.loading")}>
                {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
              </div>
            ) : inspirationPosts.length > 0 ? (
              <div className={`media-inspiration-grid ${kind}`}>
                {inspirationPosts.map((post) => (
                  <MediaInspirationCard key={post.id} post={post} onUse={() => useInspiration(post)} />
                ))}
              </div>
            ) : (
              <div className="media-inspiration-empty">{inspirationError ?? tr("media.inspiration.empty")}</div>
            )}
            {inspirationError && inspirationPosts.length > 0 && (
              <div className="media-inspiration-inline-error" role="alert">{inspirationError}</div>
            )}
            {inspirationHasMore && (
              <button
                type="button"
                className="media-inspiration-more"
                disabled={inspirationLoading}
                onClick={() => void loadMoreInspiration()}
              >
                {inspirationLoading ? tr("media.inspiration.loading") : tr("media.inspiration.more")}
              </button>
            )}
          </section>
        )}

        {surfaceView === "create" && conversation.length > 0 && (
          <MediaConversation turns={conversation} />
        )}

        <div className={`media-composer-shell${surfaceView === "create" ? " create-mode" : " inspiration-mode"}${showStarterCards ? " starter-mode" : ""}`}>
          <WorkspaceCreationModeTabs activeMode={kind} onSelect={onCreationModeChange} />
          <div className="media-preset-strip" aria-label={tr("media.presets.label")}>
            {copy.quickActions.map((item) => (
              <button type="button" key={item.label} onClick={() => setPrompt(item.prompt)}>
                {item.label}
              </button>
            ))}
          </div>

          <div className="media-workbench">
            <div className="media-composer-topbar">
              {copy.modes.length > 0 && (
                <div className="media-mode-tabs" role="tablist" aria-label={tr("media.mode.label")}>
                  {copy.modes.map((mode) => (
                    <button
                      type="button"
                      role="tab"
                      key={mode.id}
                      disabled={mode.disabled}
                      aria-selected={activeMode === mode.id}
                      className={activeMode === mode.id ? "active" : ""}
                      title={mode.disabled ? tr("media.mode.comingSoon") : undefined}
                      onClick={() => setActiveMode(mode.id)}
                    >
                      {mode.label}
                      {mode.disabled && <small>{tr("media.mode.comingSoon")}</small>}
                    </button>
                  ))}
                </div>
              )}
              <div className="media-prompt-tools">
                <button type="button" onClick={() => setPrompt(copy.quickActions[0]?.prompt ?? prompt)}>
                  <BookOpen size={13} />
                  {tr("media.tools.commonPrompts")}
                  <ChevronDown size={11} />
                </button>
                <button type="button" disabled={!prompt.trim()} title={tr("media.tools.optimizeUnavailable")}>
                  <WandSparkles size={13} />
                  {tr("media.tools.optimize")}
                </button>
                <button type="button" onClick={() => setSurfaceView("inspiration")}>
                  <Lightbulb size={13} />
                  {tr("media.view.inspiration")}
                </button>
                {kind === "video" && (
                  <button type="button" disabled title={tr("media.mode.comingSoon")}>
                    <Video size={13} />
                    {tr("media.video.storyboard")}
                  </button>
                )}
              </div>
            </div>

            <label className="media-prompt-field">
              <span className="media-prompt-label">{tr("media.prompt")}</span>
              <textarea
                rows={3}
                value={prompt}
                disabled={generating}
                placeholder={copy.placeholder}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void generate();
                }}
              />
            </label>

            {kind === "audio" && (
              <div className="media-attachment-tiles">
                {copy.attachments.map((attachment) => (
                  <button type="button" key={attachment} title={tr("media.attachments.localOnly")}>
                    <Plus size={13} />
                    <span>{attachment}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="media-workbench-footer">
              <div className="media-workbench-controls">
                <div className="media-model-picker" ref={pickerRef}>
                  <button
                    className={`media-control-pill media-model-trigger${modelPickerOpen ? " open" : ""}`}
                    type="button"
                    disabled={loadingModels || generating}
                    aria-haspopup="dialog"
                    aria-expanded={modelPickerOpen}
                    onClick={() => {
                      setSettingsOpen(false);
                      setModelPickerOpen((open) => !open);
                    }}
                  >
                    {loadingModels ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : selectedModel?.source === "local" ? (
                      <Cpu size={16} />
                    ) : (
                      <ChatModelIcon model={selectedModel} size={17} />
                    )}
                    <span>{selectedModel?.displayName ?? tr("media.models.select")}</span>
                    <ChevronDown size={13} />
                  </button>

                  {modelPickerOpen && (
                    <div className="media-model-popover" role="dialog" aria-label={tr("media.models.select")}>
                      <div className="media-model-popover-heading">
                        <strong>{tr("media.models.select")}</strong>
                        <span>{tr("media.models.selectDescription")}</span>
                      </div>
                      {models.length > 0 ? (
                        <>
                          <MediaModelGroup
                            title={tr("media.models.online")}
                            icon={<Cloud size={14} />}
                            models={cloudModels}
                            selectedCode={modelCode}
                            onSelect={selectModel}
                          />
                          <MediaModelGroup
                            title={tr("media.models.local")}
                            icon={<Cpu size={14} />}
                            models={localModels}
                            selectedCode={modelCode}
                            emptyText={tr("media.models.localEmpty")}
                            onSelect={selectModel}
                          />
                        </>
                      ) : (
                        <div className="media-model-picker-empty">
                          <strong>{tr("media.models.empty")}</strong>
                          <span>{tr("media.models.emptyDescription")}</span>
                        </div>
                      )}
                      {onManageLocalModels && (
                        <button className="media-manage-models" type="button" onClick={onManageLocalModels}>
                          <Settings2 size={14} />
                          {tr("media.models.manageLocal")}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="media-settings-picker" ref={settingsRef}>
                  <button
                    type="button"
                    className={`media-control-pill media-settings-trigger${settingsOpen ? " open" : ""}`}
                    aria-haspopup="dialog"
                    aria-expanded={settingsOpen}
                    disabled={generating}
                    onClick={() => {
                      setModelPickerOpen(false);
                      setSettingsOpen((open) => !open);
                    }}
                  >
                    <SlidersHorizontal size={14} />
                    <span>{settingsSummary(kind, { size, quality, count, durationSeconds, format })}</span>
                    <ChevronDown size={12} />
                  </button>
                  {settingsOpen && (
                    <div className="media-settings-popover" role="dialog" aria-label={tr("media.settings")}>
                      {kind !== "image" && <strong>{tr("media.settings")}</strong>}
                      {kind === "image" && (
                        <ImageSettingsPanel
                          size={size}
                          quality={quality}
                          count={count}
                          disabled={generating}
                          sizeOptions={imageSizeOptions}
                          qualityOptions={imageQualityOptions}
                          countOptions={imageCountOptions}
                          onSizeChange={setSize}
                          onQualityChange={setQuality}
                          onCountChange={setCount}
                        />
                      )}
                      {kind === "video" && (
                        <OptionSelect
                          label={tr("media.video.duration")}
                          value={String(durationSeconds)}
                          disabled={generating}
                          onChange={(value) => setDurationSeconds(Number(value))}
                          options={[
                            ["5", tr("media.seconds", [5])],
                            ["10", tr("media.seconds", [10])],
                          ]}
                        />
                      )}
                      {kind === "audio" && (
                        <OptionSelect
                          label={tr("media.audio.format")}
                          value={format}
                          disabled={generating}
                          onChange={setFormat}
                          options={[
                            ["mp3", "MP3"],
                            ["wav", "WAV"],
                          ]}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button
                className="media-generate-button"
                type="button"
                disabled={generating || !modelCode || !prompt.trim() || imageSelectionUnavailable}
                onClick={() => void generate()}
              >
                {generating ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
                {generating ? tr("media.generating") : tr("media.generate")}
                {selectionPrice !== null && selectionPrice !== undefined && (
                  <small>⚡ {formatCredits(selectionPrice)}</small>
                )}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="media-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

function MediaModelGroup({
  title,
  icon,
  models,
  selectedCode,
  emptyText,
  onSelect,
}: {
  title: string;
  icon: ReactNode;
  models: MediaModel[];
  selectedCode: string;
  emptyText?: string;
  onSelect(code: string): void;
}) {
  if (!models.length && !emptyText) return null;
  return (
    <section className="media-model-group">
      <div className="media-model-group-title">
        {icon}
        <span>{title}</span>
        <small>{models.length}</small>
      </div>
      {models.length ? (
        <div className="media-model-list">
          {models.map((model) => (
            <button
              type="button"
              className={model.code === selectedCode ? "selected" : ""}
              key={model.code}
              onClick={() => onSelect(model.code)}
            >
              <span className="media-model-icon">
                {model.source === "local" ? <Cpu size={17} /> : <ChatModelIcon model={model} size={18} />}
              </span>
              <span>
                <strong>{model.displayName}</strong>
              </span>
              {model.code === selectedCode && <Check size={15} />}
            </button>
          ))}
        </div>
      ) : (
        <div className="media-model-group-empty">{emptyText}</div>
      )}
    </section>
  );
}

function ImageSettingsPanel({
  size,
  quality,
  count,
  disabled,
  sizeOptions,
  qualityOptions,
  countOptions,
  onSizeChange,
  onQualityChange,
  onCountChange,
}: {
  size: string;
  quality: string;
  count: number;
  disabled: boolean;
  sizeOptions: Array<[string, string]>;
  qualityOptions: Array<[string, string]>;
  countOptions: number[];
  onSizeChange(value: string): void;
  onQualityChange(value: string): void;
  onCountChange(value: number): void;
}) {
  return (
    <div className="media-image-settings">
      <section className="media-image-setting-section">
        <strong>{tr("media.image.size")}</strong>
        <span>{tr("media.image.ratio")}</span>
        <div className="media-image-size-options" style={{ gridTemplateColumns: `repeat(${sizeOptions.length}, minmax(0, 1fr))` }}>
          {sizeOptions.map(([value]) => (
            <button
              type="button"
              key={value}
              className={value === size ? "selected" : ""}
              aria-pressed={value === size}
              disabled={disabled}
              onClick={() => onSizeChange(value)}
            >
              <i style={{ aspectRatio: value.replace("x", " / ") }} />
              <strong>{imageRatio(value)}</strong>
            </button>
          ))}
        </div>
      </section>

      {qualityOptions.length > 0 && (
        <section className="media-image-setting-section">
          <strong>{tr("media.image.quality")}</strong>
          <div className="media-segmented-options" style={{ gridTemplateColumns: `repeat(${qualityOptions.length}, minmax(0, 1fr))` }}>
            {qualityOptions.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={value === quality ? "selected" : ""}
                aria-pressed={value === quality}
                disabled={disabled}
                onClick={() => onQualityChange(value)}
              >
                <strong>{label}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="media-image-setting-section">
        <strong>{tr("media.image.count")}</strong>
        <div className="media-segmented-options" style={{ gridTemplateColumns: `repeat(${countOptions.length}, minmax(0, 1fr))` }}>
          {countOptions.map((value) => (
            <button
              type="button"
              key={value}
              className={value === count ? "selected" : ""}
              aria-pressed={value === count}
              disabled={disabled}
              onClick={() => onCountChange(value)}
            >
              <strong>{value}</strong>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function OptionSelect({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  options: Array<[string, string]>;
  onChange(value: string): void;
}) {
  return (
    <label className="media-option" title={label}>
      <select value={value} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function MediaInspirationCard({
  post,
  onUse,
}: {
  post: MediaInspirationPost;
  onUse(): void;
}) {
  const previewUrl = post.thumbnailUrl ?? post.mediaUrl;
  const title = post.title ?? post.prompt ?? tr("media.inspiration.untitled");
  return (
    <article className="media-inspiration-card">
      <div className="media-inspiration-preview">
        {post.kind === "image" && previewUrl && <img src={previewUrl} alt={title} loading="lazy" />}
        {post.kind === "video" && post.mediaUrl && (
          <video src={post.mediaUrl} poster={post.thumbnailUrl ?? undefined} muted playsInline preload="metadata" />
        )}
        {post.kind === "audio" && (
          <div className="media-inspiration-audio">
            <AudioLines size={30} />
            {post.mediaUrl && <audio src={post.mediaUrl} controls preload="none" />}
          </div>
        )}
        {!previewUrl && post.kind !== "audio" && <ImageIcon size={30} />}
        <span className="media-inspiration-model">{post.modelName || post.modelCode}</span>
        <button type="button" className="media-inspiration-use" onClick={onUse}>
          <Sparkles size={13} />
          {tr("media.inspiration.try")}
        </button>
      </div>
      <div className="media-inspiration-meta">
        <strong>{title}</strong>
        <div>
          <span>{post.author?.name ?? "RouteMarket"}</span>
          <span><Eye size={12} /> {compactNumber(post.viewCount)}</span>
          <span><Heart size={12} /> {compactNumber(post.likeCount)}</span>
        </div>
      </div>
    </article>
  );
}

function MediaConversation({ turns }: { turns: MediaConversationTurn[] }) {
  return (
    <section className="media-conversation" aria-live="polite">
      {turns.map((turn) => (
        <article className="media-conversation-turn" key={turn.id}>
          <div className="media-conversation-user">
            <p>{turn.prompt}</p>
          </div>
          <div className="media-conversation-assistant">
            {turn.status === "pending" ? (
              <MediaPendingGeneration turn={turn} />
            ) : turn.status === "failed" ? (
              <MediaFailedGeneration turn={turn} />
            ) : (
              <MediaCompletedGeneration turn={turn} />
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

function MediaPendingGeneration({ turn }: { turn: MediaConversationTurn }) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - turn.startedAt);
  const progress = resolveMediaGenerationProgress(turn.kind, elapsedMs);
  const aspectRatio = mediaTurnAspectRatio(turn);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedMs(Date.now() - turn.startedAt), 1_000);
    return () => window.clearInterval(timer);
  }, [turn.startedAt]);

  return (
    <div className={`media-generation-block pending ${turn.kind}`}>
      <MediaGenerationMeta turn={turn} progress={progress} elapsedMs={elapsedMs} />
      <div className={`media-pending-gallery${turn.count > 1 ? " multiple" : ""}`}>
        <div
          className={`media-pending-visual ${turn.kind}`}
          style={aspectRatio ? { aspectRatio } : undefined}
          role="status"
          aria-label={`${progress}%`}
        >
          <div className="media-pending-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <strong>{progress}%</strong>
        </div>
        {turn.kind === "image" && turn.count > 1 && (
          <div className="media-pending-thumbnails" aria-hidden="true">
            {Array.from({ length: turn.count }, (_, index) => (
              <span className={index === 0 ? "active" : ""} key={index} style={{ aspectRatio }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaCompletedGeneration({ turn }: { turn: MediaConversationTurn }) {
  const elapsedMs = Math.max(0, (turn.completedAt ?? Date.now()) - turn.startedAt);
  return (
    <div className={`media-generation-block completed ${turn.kind}`}>
      <MediaGenerationMeta turn={turn} progress={100} elapsedMs={elapsedMs} />
      <div className={`media-turn-output-grid ${turn.kind}`}>
        {turn.outputs.map((output) => <MediaOutputCard key={output.id} output={output} />)}
      </div>
    </div>
  );
}

function MediaFailedGeneration({ turn }: { turn: MediaConversationTurn }) {
  const elapsedMs = Math.max(0, (turn.completedAt ?? Date.now()) - turn.startedAt);
  return (
    <div className="media-generation-block failed" role="alert">
      <MediaGenerationMeta turn={turn} elapsedMs={elapsedMs} />
      <div className="media-generation-failure">
        <strong>{tr("media.generate.error")}</strong>
        <span>{turn.error}</span>
      </div>
    </div>
  );
}

function MediaGenerationMeta({
  turn,
  progress,
  elapsedMs,
}: {
  turn: MediaConversationTurn;
  progress?: number;
  elapsedMs: number;
}) {
  return (
    <div className="media-generation-meta">
      <span>{turn.modelName}</span>
      <i />
      <span>{turn.settings}</span>
      {progress !== undefined && <><i /><span>{progress}%</span></>}
      <i />
      <span>{formatMediaElapsed(elapsedMs)}</span>
      {turn.credits !== null && <><i /><span>⚡ {formatCredits(turn.credits)}</span></>}
    </div>
  );
}

function MediaOutputCard({ output }: { output: MediaGenerationOutput }) {
  return (
    <article className="media-output-card">
      <div className="media-output-preview">
        {output.kind === "image" && <img src={output.url} alt={output.revisedPrompt ?? tr("media.result.imageAlt")} />}
        {output.kind === "video" && <video src={output.url} poster={output.thumbnailUrl ?? undefined} controls />}
        {output.kind === "audio" && (
          <div className="media-audio-preview">
            <AudioLines size={34} />
            <audio src={output.url} controls />
          </div>
        )}
      </div>
      {output.revisedPrompt && <p>{output.revisedPrompt}</p>}
      <div className="media-output-actions">
        <a href={output.url} target="_blank" rel="noreferrer">
          <ExternalLink size={14} />
          {tr("media.result.open")}
        </a>
        <a href={output.downloadUrl ?? output.url} download>
          <Download size={14} />
          {tr("media.result.download")}
        </a>
      </div>
    </article>
  );
}

type MediaPageCopy = {
  title: string;
  description: string;
  placeholder: string;
  modes: Array<{ id: string; label: string; disabled?: boolean }>;
  starters: Array<{ badge: string; title: string; prompt: string }>;
  quickActions: Array<{ label: string; prompt: string }>;
  attachments: string[];
};

function mediaCopy(kind: MediaModelCategory): MediaPageCopy {
  if (kind === "image") {
    const starters = [
      { badge: tr("media.starter.image.portraitBadge"), title: tr("media.starter.image.portrait") },
      { badge: tr("media.starter.image.productBadge"), title: tr("media.starter.image.product") },
      { badge: tr("media.starter.image.cinemaBadge"), title: tr("media.starter.image.cinema") },
      { badge: tr("media.starter.image.illustrationBadge"), title: tr("media.starter.image.illustration") },
    ];
    return {
      title: tr("media.image.title"),
      description: tr("media.image.description"),
      placeholder: tr("media.image.placeholder"),
      modes: [
        { id: "textToImage", label: tr("media.mode.image.text") },
        { id: "imageToImage", label: tr("media.mode.image.image") },
        { id: "imageEdit", label: tr("media.mode.image.edit") },
      ],
      starters: starters.map((item) => ({ ...item, prompt: item.title })),
      quickActions: [
        tr("media.quick.image.poster"),
        tr("media.quick.image.product"),
        tr("media.quick.image.character"),
        tr("media.quick.image.illustration"),
      ].map((label) => ({ label, prompt: label })),
      attachments: [],
    };
  }
  if (kind === "video") {
    const starters = [
      { badge: tr("media.starter.video.adBadge"), title: tr("media.starter.video.ad") },
      { badge: tr("media.starter.video.productBadge"), title: tr("media.starter.video.product") },
      { badge: tr("media.starter.video.cinemaBadge"), title: tr("media.starter.video.cinema") },
      { badge: tr("media.starter.video.loopBadge"), title: tr("media.starter.video.loop") },
    ];
    return {
      title: tr("media.video.title"),
      description: tr("media.video.description"),
      placeholder: tr("media.video.placeholder"),
      modes: [
        { id: "textToVideo", label: tr("media.mode.video.text") },
        { id: "imageToVideo", label: tr("media.mode.video.image") },
        { id: "videoEdit", label: tr("media.mode.video.edit") },
        { id: "avatar", label: tr("media.mode.video.avatar"), disabled: true },
        { id: "tools", label: tr("media.mode.video.tools"), disabled: true },
      ],
      starters: starters.map((item) => ({ ...item, prompt: item.title })),
      quickActions: starters.map((item) => ({ label: item.title, prompt: item.title })),
      attachments: [],
    };
  }
  const starters = [
    { badge: tr("media.starter.audio.voiceBadge"), title: tr("media.starter.audio.voice") },
    { badge: tr("media.starter.audio.trailerBadge"), title: tr("media.starter.audio.trailer") },
    { badge: tr("media.starter.audio.ambientBadge"), title: tr("media.starter.audio.ambient") },
    { badge: tr("media.starter.audio.dialogueBadge"), title: tr("media.starter.audio.dialogue") },
  ];
  return {
    title: tr("media.audio.title"),
    description: tr("media.audio.description"),
    placeholder: tr("media.audio.placeholder"),
    modes: [],
    starters: starters.map((item) => ({ ...item, prompt: item.title })),
    quickActions: starters.map((item) => ({ label: item.title, prompt: item.title })),
    attachments: [
      tr("media.attachment.script"),
      tr("media.attachment.referenceAudio"),
      tr("media.attachment.visualBeat"),
    ],
  };
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function defaultMediaMode(kind: MediaModelCategory): string {
  if (kind === "image") return "textToImage";
  if (kind === "video") return "textToVideo";
  return "generate";
}

function settingsSummary(
  kind: MediaModelCategory,
  settings: { size: string; quality: string; count: number; durationSeconds: number; format: string },
): string {
  if (kind === "image") {
    const parts = [settings.size];
    if (settings.quality) parts.push(mediaQualityLabel(settings.quality));
    parts.push(String(settings.count));
    return parts.join(" / ");
  }
  if (kind === "video") return `16:9 / 480P / ${tr("media.seconds", [settings.durationSeconds])}`;
  return `${tr("media.audio.voiceover")} / ${settings.format.toUpperCase()} / 44.1 kHz`;
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  const message = error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^ProjectChatResponseError:\s*/i, "")
    .trim();
  return /not configured with a valid price for image selection/i.test(message)
    ? tr("media.image.selectionUnavailable")
    : message;
}

function mediaImageSizeOptions(model: MediaModel | null): Array<[string, string]> {
  const configured = model?.imageCapabilities?.sizes ?? [];
  if (configured.length) {
    return configured.map((option) => [
      option.value,
      option.ratio ? `${option.ratio} · ${option.value.replace("x", "×")}` : option.label,
    ]);
  }
  if (model?.source === "routemarket") return [["1024x1024", "1:1 · 1024×1024"]];
  return [
    ["1024x1024", "1:1 · 1024×1024"],
    ["1536x1024", "3:2 · 1536×1024"],
    ["1024x1536", "2:3 · 1024×1536"],
  ];
}

function mediaImageQualityOptions(model: MediaModel | null): Array<[string, string]> {
  const configured = model?.imageCapabilities?.qualities ?? [];
  if (configured.length) {
    return configured.map((option) => [option.value, mediaQualityLabel(option.value, option.label)]);
  }
  return model?.source === "local"
    ? [
        ["standard", tr("media.quality.standard")],
        ["high", tr("media.quality.high")],
      ]
    : [];
}

function mediaImageCountOptions(model: MediaModel | null): number[] {
  const configured = model?.imageCapabilities?.counts ?? [];
  return configured.length ? configured : model?.source === "routemarket" ? [1] : [1, 2];
}

function mediaQualityLabel(value: string, fallback = value): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "low") return tr("media.quality.low");
  if (normalized === "medium") return tr("media.quality.medium");
  if (normalized === "high") return tr("media.quality.high");
  if (normalized === "standard" || normalized === "default") return tr("media.quality.standard");
  if (normalized === "auto") return tr("media.quality.auto");
  return fallback;
}

function pickMediaOption(
  options: Array<[string, string]>,
  preferred: string | null | undefined,
  fallback: string,
): string {
  if (preferred && options.some(([value]) => value === preferred)) return preferred;
  if (fallback && options.some(([value]) => value === fallback)) return fallback;
  return options[0]?.[0] ?? "";
}

function pickMediaCount(options: number[], preferred: number): number {
  return options.includes(preferred) ? preferred : (options[0] ?? 1);
}

export function resolveMediaImageSelectionPrice(
  model: MediaModel,
  size: string,
  quality: string,
  count = 1,
): number | null {
  const capabilities = model.imageCapabilities;
  if (!capabilities?.prices.length || !size) return null;
  const output = capabilities.sizes.find((option) => option.value === size);
  const matches = capabilities.prices.filter((price) =>
    (!price.size || price.size === size)
    && (!price.quality || price.quality === quality)
    && (!price.resolution || price.resolution === output?.resolution)
    && (!price.ratio || price.ratio === output?.ratio)
  );
  if (!matches.length) return null;
  const specificity = (price: (typeof matches)[number]) =>
    Number(Boolean(price.size))
    + Number(Boolean(price.quality))
    + Number(Boolean(price.resolution))
    + Number(Boolean(price.ratio));
  const highestSpecificity = Math.max(...matches.map(specificity));
  const outputCredits = Math.min(
    ...matches.filter((price) => specificity(price) === highestSpecificity).map((price) => price.credits)
  );
  return capabilities.requestCredits + outputCredits * Math.max(1, count);
}

function imageRatio(size: string): string {
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return size;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function formatCredits(value: number): string {
  return value.toFixed(2);
}

export function resolveMediaGenerationProgress(kind: MediaModelCategory, elapsedMs: number): number {
  const elapsedSeconds = Math.max(0, elapsedMs / 1_000);
  const scale = kind === "video" ? 54 : kind === "audio" ? 26 : 18;
  const curve = 100 * (1 - Math.exp(-elapsedSeconds / scale));
  const bounded = kind === "video" ? Math.min(curve, 93) : Math.min(curve, 96);
  return Math.max(6, Math.round(bounded));
}

function mediaTurnAspectRatio(turn: MediaConversationTurn): string | undefined {
  if (turn.kind === "audio") return undefined;
  const match = /^(\d+)x(\d+)$/i.exec(turn.size);
  if (!match) return turn.kind === "video" ? "16 / 9" : "1 / 1";
  return `${Number(match[1])} / ${Number(match[2])}`;
}

function formatMediaElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`;
}
