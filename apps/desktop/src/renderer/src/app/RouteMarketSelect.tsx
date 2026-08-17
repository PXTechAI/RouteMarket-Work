import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type RouteMarketSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function RouteMarketSelect({
  value,
  options,
  label,
  autoFocus = false,
  disabled = false,
  onChange
}: {
  value: string;
  options: ReadonlyArray<RouteMarketSelectOption>;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} className={`rm-styled-select ${open ? "open" : ""}`}>
      <button
        className="rm-styled-select-trigger"
        type="button"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown className="rm-styled-select-caret" size={14}/>
      </button>
      {open && (
        <div className="rm-styled-select-menu" id={menuId} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              className={`rm-styled-select-option ${option.value === value ? "active" : ""}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14}/> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
