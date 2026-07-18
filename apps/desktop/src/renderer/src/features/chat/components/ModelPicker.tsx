import { ChevronDown, LoaderCircle, Sparkles } from "lucide-react";
import type { ChatModel, WorkState } from "../../../../../shared/desktop-api";

export function ModelPicker({
  models,
  value,
  authStatus,
  loading,
  disabled,
  onChange
}: {
  models: ChatModel[];
  value: string;
  authStatus: WorkState["authStatus"];
  loading: boolean;
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="rm-model-picker">
      <Sparkles size={13} />
      <select
        aria-label="对话模型"
        value={value}
        disabled={disabled || loading || models.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {models.length === 0 && (
          <option value="">
            {authStatus === "signed_in" ? "加载模型..." : "登录后选择模型"}
          </option>
        )}
        {models.map((model) => (
          <option key={model.code} value={model.code}>
            {model.displayName}
          </option>
        ))}
      </select>
      {loading
        ? <LoaderCircle className="spin" size={13} />
        : <ChevronDown size={13} />}
    </label>
  );
}
