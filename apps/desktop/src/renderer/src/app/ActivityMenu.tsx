import {
  Bell,
  CheckCircle2,
  CircleAlert,
  Cloud,
  FolderCheck,
  LoaderCircle,
  ShieldCheck,
  Workflow,
  XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActivityItem } from "../../../shared/desktop-api";

export function ActivityMenu({ activities }: { activities: ActivityItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const recentActivities = activities.slice(0, 12);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="rm-activity-menu-root" ref={rootRef}>
      <button
        className={`rm-notification-button ${open ? "active" : ""}`}
        type="button"
        title="本机活动"
        aria-label="打开本机活动"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} />
        <span>活动</span>
        {activities.length > 0 && <b>{Math.min(activities.length, 99)}</b>}
      </button>

      {open && (
        <section className="rm-activity-menu" role="dialog" aria-label="本机活动">
          <header>
            <div>
              <strong>本机活动</strong>
              <span>Worker、审批和工作流执行记录</span>
            </div>
            <small>{activities.length} 条</small>
          </header>

          <div className="rm-activity-list">
            {recentActivities.map((activity) => (
              <article className="rm-activity-item" key={activity.id}>
                <span className={`rm-activity-icon ${activityTone(activity.kind)}`}>
                  <ActivityIcon kind={activity.kind} />
                </span>
                <div>
                  <strong>{activity.title}</strong>
                  <p>{activity.detail}</p>
                  <time dateTime={activity.occurredAt}>
                    {formatActivityTime(activity.occurredAt)}
                  </time>
                </div>
              </article>
            ))}

            {recentActivities.length === 0 && (
              <div className="rm-activity-empty">
                <Bell size={22} />
                <strong>暂无本机活动</strong>
                <span>运行任务、触发工作流或进行本机审批后会显示在这里。</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ActivityIcon({ kind }: { kind: ActivityItem["kind"] }) {
  if (kind === "project.bound") return <FolderCheck size={15} />;
  if (kind === "cloud.connected") return <Cloud size={15} />;
  if (kind === "cloud.error" || kind === "job.failed") return <XCircle size={15} />;
  if (kind === "approval.requested") return <ShieldCheck size={15} />;
  if (kind === "approval.policy_removed") return <ShieldCheck size={15} />;
  if (kind === "approval.approved" || kind === "job.succeeded") {
    return <CheckCircle2 size={15} />;
  }
  if (kind === "approval.denied" || kind === "job.canceled") {
    return <CircleAlert size={15} />;
  }
  if (kind === "trigger.fired") return <Workflow size={15} />;
  return <LoaderCircle size={15} />;
}

function activityTone(kind: ActivityItem["kind"]) {
  if (kind === "cloud.error" || kind === "job.failed" || kind === "approval.denied") {
    return "danger";
  }
  if (kind === "approval.requested" || kind === "job.offered") return "warning";
  if (
    kind === "cloud.connected" ||
    kind === "job.succeeded" ||
    kind === "approval.approved"
  ) {
    return "success";
  }
  return "neutral";
}

function formatActivityTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;

  const elapsedMinutes = Math.round((timestamp - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");

  const elapsedDays = Math.round(elapsedHours / 24);
  if (Math.abs(elapsedDays) < 7) return formatter.format(elapsedDays, "day");
  return new Date(timestamp).toLocaleString("zh-CN");
}
