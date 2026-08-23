import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import type {
  DesktopExtensionFilePickRequest,
  DesktopExtensionPage,
  DesktopExtensionSummary,
  RouteMarketWorkApi
} from "../../../../shared/desktop-api";
import "./extension-frame.scss";

export function ExtensionFrame({
  api,
  extension,
  page,
  loading,
  error,
  onRetry
}: {
  api: Pick<RouteMarketWorkApi, "pickDesktopExtensionFile">;
  extension: DesktopExtensionSummary | null;
  page: DesktopExtensionPage | null;
  loading: boolean;
  error: string | null;
  onRetry(): void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!page || event.source !== frameRef.current?.contentWindow) return;
      const message = parseFilePickMessage(event.data);
      if (!message) return;
      void api.pickDesktopExtensionFile(page.pluginId, message.request).then(
        (result) => frameRef.current?.contentWindow?.postMessage({
          protocol: "routemarket-extension/1",
          type: "host.files.pick.result",
          requestId: message.requestId,
          result
        }, "*"),
        (nextError) => frameRef.current?.contentWindow?.postMessage({
          protocol: "routemarket-extension/1",
          type: "host.files.pick.result",
          requestId: message.requestId,
          error: nextError instanceof Error ? nextError.message : String(nextError)
        }, "*")
      );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [api, page]);
  if (loading) {
    return (
      <div className="rm-extension-state" role="status">
        <LoaderCircle className="spinning" size={24} />
        <strong>正在启动本地插件</strong>
        <span>{extension?.name ?? "Desktop extension"}</span>
      </div>
    );
  }
  if (error || !page) {
    return (
      <div className="rm-extension-state rm-extension-error" role="alert">
        <CircleAlert size={24} />
        <strong>插件启动失败</strong>
        <span>{error ?? "插件页面不可用。"}</span>
        <button type="button" onClick={onRetry}><RefreshCw size={14} />重试</button>
      </div>
    );
  }
  return (
    <section className="rm-extension-frame-shell" aria-label={page.title}>
      <iframe
        ref={frameRef}
        className="rm-extension-frame"
        src={page.url}
        title={page.title}
        sandbox="allow-scripts allow-forms allow-downloads allow-modals"
        referrerPolicy="no-referrer"
      />
    </section>
  );
}

export function parseFilePickMessage(value: unknown): {
  requestId: string;
  request: DesktopExtensionFilePickRequest;
} | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.protocol !== "routemarket-extension/1" ||
    message.type !== "host.files.pick" ||
    typeof message.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(message.requestId) ||
    !message.request ||
    typeof message.request !== "object"
  ) return null;
  const request = message.request as Record<string, unknown>;
  if (
    request.purpose !== "data-input" &&
    request.purpose !== "media-input" &&
    request.purpose !== "media-output-directory" &&
    request.purpose !== "model-directory" &&
    request.purpose !== "runtime-executable" &&
    request.purpose !== "runtime-directory"
  ) return null;
  return {
    requestId: message.requestId,
    request: {
      purpose: request.purpose,
      ...(typeof request.title === "string" ? { title: request.title.slice(0, 120) } : {}),
      ...(Array.isArray(request.extensions)
        ? { extensions: request.extensions.filter((item): item is string => typeof item === "string").slice(0, 24) }
        : {})
    }
  };
}
