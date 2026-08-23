import "./model-picker.scss";
import { tr } from "../../../i18n";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Search, Settings2 } from "lucide-react";
import type { ChatModel, ModelTokenPricing, WorkState } from "../../../../../shared/desktop-api";
import { ChatModelIcon } from "./ChatModelIcon";

export function ModelPicker({ models, value, authStatus, loading, disabled, onChange, onManageProviders }: {
  models: ChatModel[];
  value: string;
  authStatus: WorkState["authStatus"];
  loading: boolean;
  disabled: boolean;
  onChange(value: string): void;
  onManageProviders?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hoveredModelCode, setHoveredModelCode] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = models.find((model) => model.code === value) ?? null;
  const visibleModels = filterChatModels(models, query);
  const groups = [...visibleModels.reduce((map, model) => {
    const key = model.providerId ?? "routemarket";
    const group = map.get(key) ?? { name: model.providerName, source: model.source, models: [] as ChatModel[] };
    group.models.push(model);
    map.set(key, group);
    return map;
  }, new Map<string, { name: string; source: ChatModel["source"]; models: ChatModel[] }>()).entries()];
  const hoveredModel = models.find((model) => model.code === hoveredModelCode) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const unavailable = disabled || loading || models.length === 0;
  const toggle = () => {
    if (!open) {
      setQuery("");
      setHoveredModelCode(null);
    }
    setOpen((current) => !current);
  };
  const openProviderSettings = () => {
    setOpen(false);
    onManageProviders?.();
  };

  return (<div className="rm-model-picker" ref={rootRef}>
    <button className="rm-model-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} disabled={unavailable} onClick={toggle}>
      <ChatModelIcon model={selected} size={15}/>
      <span>{selected?.displayName ?? (authStatus === "signed_in" ? tr("ui.509039e664ff") : tr("ui.d4101b134474"))}</span>
      {loading ? <LoaderCircle className="spin" size={13}/> : <ChevronDown size={13}/>}
    </button>
    {open && (<div className="rm-model-picker-popover" onMouseLeave={() => setHoveredModelCode(null)}>
      <div className="rm-model-picker-menu" role="listbox" aria-label={tr("ui.d099933a7e56")}>
        <label className="rm-model-picker-search">
          <Search size={14}/>
          <input type="search" value={query} placeholder={tr("chat.model.searchPlaceholder")} aria-label={tr("chat.model.searchPlaceholder")} autoFocus onChange={(event) => setQuery(event.target.value)}/>
        </label>
        <div className="rm-model-picker-scroll">
          {groups.map(([key, group]) => (<div className="rm-model-picker-group" key={key}>
            <div className="rm-model-picker-group-label"><span>{group.name}</span><small>{tr(group.source === "routemarket" ? "chat.model.accountCredits" : "chat.model.ownApi")}</small></div>
            {group.models.map((model) => (<button key={model.code} type="button" role="option" aria-selected={model.code === value} className={model.code === value ? "active" : ""} onMouseEnter={() => setHoveredModelCode(model.code)} onFocus={() => setHoveredModelCode(model.code)} onClick={() => {
              onChange(model.code);
              setOpen(false);
            }}>
              <ChatModelIcon model={model} size={18}/>
              <span>{model.displayName}</span>
              {model.code === value ? <Check size={14}/> : null}
            </button>))}
          </div>))}
          {!visibleModels.length ? <div className="rm-model-picker-empty">{tr("chat.model.searchEmpty")}</div> : null}
        </div>
        {onManageProviders ? <div className="rm-model-picker-footer">
          <button type="button" onClick={openProviderSettings}><Settings2 size={13}/><span>{tr("chat.model.manageProviders")}</span></button>
        </div> : null}
      </div>
      {hoveredModel ? <ModelPricePanel model={hoveredModel} onConfigure={onManageProviders ? openProviderSettings : undefined}/> : null}
    </div>)}
  </div>);
}

function ModelPricePanel({ model, onConfigure }: { model: ChatModel; onConfigure?: () => void }) {
  const externalPrices = model.source === "external" ? referencePriceRows(model.pricing) : [];
  const platformComponents = model.platformPricing?.components ?? [];
  const hasPlatformPrice = model.source === "routemarket" && ((
    model.platformPricing?.primaryCredit !== null && model.platformPricing?.primaryCredit !== undefined
  ) || platformComponents.length > 0);
  const hasExternalPrice = externalPrices.some((price) => price.value !== null);

  return (<aside className="rm-model-price-panel" aria-label={tr("chat.model.priceDetails")}>
    <header>
      <ChatModelIcon model={model} size={20}/>
      <span><strong>{model.displayName}</strong><small>{model.providerName}</small></span>
    </header>
    <div className="rm-model-price-title">
      <span>{tr(model.source === "routemarket" ? "chat.model.creditPrice" : "chat.model.referencePrice")}</span>
      <small>{tr(model.source === "routemarket" ? "chat.model.creditBillingNote" : "chat.model.referencePriceNote")}</small>
    </div>
    {hasPlatformPrice ? (<div className="rm-model-price-list">
      {platformComponents.length ? platformComponents.slice(0, 6).map((component, index) => (<div key={`${component.billingMetric}:${index}`}>
        <span>{component.displayName}</span>
        <strong>{formatCredit(component.salePrice)}{component.unitLabel ? ` / ${component.unitLabel}` : ""}</strong>
      </div>)) : (<div>
        <span>{tr("chat.model.startingPrice")}</span>
        <strong>{formatCredit(model.platformPricing!.primaryCredit!)}</strong>
      </div>)}
    </div>) : null}
    {model.source === "external" ? (<div className="rm-model-price-list">
      {externalPrices.map((price) => (<div key={price.label}>
        <span>{price.label}</span>
        <strong className={price.value === null ? "unconfigured" : undefined}>
          {price.value === null ? "—" : formatUsdPerMillion(price.value)}
        </strong>
      </div>))}
    </div>) : null}
    {!hasPlatformPrice && !hasExternalPrice ? (<div className="rm-model-price-empty">
      <span>{tr("chat.model.priceUnavailable")}</span>
      {model.source === "external" && onConfigure ? <button type="button" onClick={onConfigure}><Settings2 size={13}/>{tr("chat.model.configurePrice")}</button> : null}
    </div>) : null}
  </aside>);
}

export function referencePriceRows(pricing: ModelTokenPricing | null | undefined) {
  return [
    { label: tr("chat.model.inputPrice"), value: normalizedReferencePrice(pricing?.inputUsdPerMillion) },
    { label: tr("chat.model.outputPrice"), value: normalizedReferencePrice(pricing?.outputUsdPerMillion) },
    { label: tr("chat.model.cacheReadPrice"), value: normalizedReferencePrice(pricing?.cacheReadUsdPerMillion) },
    { label: tr("chat.model.cacheWritePrice"), value: normalizedReferencePrice(pricing?.cacheWriteUsdPerMillion) }
  ];
}

function normalizedReferencePrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCredit(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)} Credit`;
}

function formatUsdPerMillion(value: number): string {
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)} / 1M`;
}

export function filterChatModels(models: ChatModel[], query: string): ChatModel[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return models;
  return models.filter((model) => [model.displayName, model.code, model.providerName]
    .some((candidate) => candidate.toLocaleLowerCase().includes(normalizedQuery)));
}
