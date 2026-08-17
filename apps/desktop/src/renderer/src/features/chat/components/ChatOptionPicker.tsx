import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type ChatOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function ChatOptionPicker<T extends string>({ value, label, icon, options, disabled, onChange }: {
  value: T;
  label: string;
  icon?: ReactNode;
  options: ChatOption<T>[];
  disabled?: boolean;
  onChange(value: T): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
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
  return (<div className="chat-option-picker" ref={rootRef}>
    <button className="chat-option-picker-trigger" type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      {icon}<span>{selected?.label}</span><ChevronDown className={open ? "open" : ""} size={12}/>
    </button>
    {open && <div className="chat-option-picker-menu" role="listbox" aria-label={label}>
      {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} className={option.value === value ? "active" : ""} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={13}/>}</button>)}
    </div>}
  </div>);
}
