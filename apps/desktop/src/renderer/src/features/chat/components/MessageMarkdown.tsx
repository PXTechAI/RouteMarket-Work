import "./message-markdown.scss";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

type MessageMarkdownProps = {
  content: string;
  projectId?: string | null;
  onOpenProjectFile?: (relativePath: string) => void;
};

export function MessageMarkdown({ content, projectId, onOpenProjectFile }: MessageMarkdownProps) {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("project://") ? url : defaultUrlTransform(url))}
        components={{
          a({ href, children, ...props }) {
            const projectFile = parseProjectFileUri(href);
            if (projectFile) {
              const canOpen = projectFile.projectId === projectId && Boolean(onOpenProjectFile);
              return (
                <button
                  className="message-markdown-project-link"
                  type="button"
                  disabled={!canOpen}
                  title={projectFile.relativePath}
                  onClick={() => onOpenProjectFile?.(projectFile.relativePath)}
                >
                  {children}
                </button>
              );
            }
            return (
              <a {...props} href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {normalizeMessageMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

export function normalizeMessageMarkdown(content: string): string {
  return content.replaceAll("\r\n", "\n").replace(/\]\s*\n\s*\((project:\/\/[^)\s]+)\)/gi, "]($1)");
}

export function parseProjectFileUri(href?: string): { projectId: string; relativePath: string } | null {
  if (!href?.startsWith("project://")) return null;
  try {
    const rawPath = href.slice("project://".length).split(/[?#]/, 1)[0] ?? "";
    const rawSegments = rawPath
      .split("/")
      .slice(1)
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const url = new URL(href);
    if (
      !url.hostname ||
      url.search ||
      url.hash ||
      !rawSegments.length ||
      rawSegments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))
    ) {
      return null;
    }
    return { projectId: url.hostname, relativePath: rawSegments.join("/") };
  } catch {
    return null;
  }
}
