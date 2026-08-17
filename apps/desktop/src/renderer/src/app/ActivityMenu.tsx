import { getActiveLocale, tr } from "../i18n";
import { Bell, CheckCircle2, CircleAlert, Cloud, FolderCheck, LoaderCircle, ShieldCheck, Trash2, Workflow, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActivityItem } from "../../../shared/desktop-api";
export function ActivityMenu({ activities, onClear }: {
    activities: ActivityItem[];
    onClear(): void;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const recentActivities = activities.slice(0, 12);
    useEffect(() => {
        if (!open)
            return;
        function onPointerDown(event: PointerEvent) {
            if (!rootRef.current?.contains(event.target as Node))
                setOpen(false);
        }
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape")
                setOpen(false);
        }
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);
    return (<div className="rm-activity-menu-root" ref={rootRef}>
      <button className={`rm-notification-button ${open ? "active" : ""}`} type="button" title={tr("ui.4e3b59987e99")} aria-label={tr("ui.83d505149c64")} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Bell size={16}/>
        <span>{tr("ui.b2548636f024")}</span>
        {activities.length > 0 && <b>{Math.min(activities.length, 99)}</b>}
      </button>

      {open && (<section className="rm-activity-menu" role="dialog" aria-label={tr("ui.4e3b59987e99")}>
          <header>
            <div>
              <strong>{tr("ui.4e3b59987e99")}</strong>
              <span>{tr("ui.b972c55dbd08")}</span>
            </div>
            <div className="rm-activity-header-actions">
              <small>{activities.length}{tr("ui.bce2ef61514a")}</small>
              <button type="button" title={tr("ui.42009f73e385")} aria-label={tr("ui.42009f73e385")} disabled={activities.length === 0} onClick={onClear}>
                <Trash2 size={13}/>
              </button>
            </div>
          </header>

          <div className="rm-activity-list">
            {recentActivities.map((activity) => (<article className="rm-activity-item" key={activity.id}>
                <span className={`rm-activity-icon ${activityTone(activity.kind)}`}>
                  <ActivityIcon kind={activity.kind}/>
                </span>
                <div>
                  <strong>{activity.title}</strong>
                  {(activity.occurrenceCount ?? 1) > 1 && (<span className="rm-activity-repeat">{tr("ui.6e708ba759df")}{activity.occurrenceCount}{tr("ui.5e5b8169eee6")}</span>)}
                  <p>{activity.detail}</p>
                  <time dateTime={activity.occurredAt}>
                    {formatActivityTime(activity.occurredAt)}
                  </time>
                </div>
              </article>))}

            {recentActivities.length === 0 && (<div className="rm-activity-empty">
                <Bell size={22}/>
                <strong>{tr("ui.9149aaf6522e")}</strong>
                <span>{tr("ui.4d1f351c754c")}</span>
              </div>)}
          </div>
        </section>)}
    </div>);
}
function ActivityIcon({ kind }: {
    kind: ActivityItem["kind"];
}) {
    if (kind === "project.bound")
        return <FolderCheck size={15}/>;
    if (kind === "cloud.connected")
        return <Cloud size={15}/>;
    if (kind === "cloud.error" || kind === "job.failed")
        return <XCircle size={15}/>;
    if (kind === "approval.requested")
        return <ShieldCheck size={15}/>;
    if (kind === "approval.policy_removed")
        return <ShieldCheck size={15}/>;
    if (kind === "approval.approved" || kind === "job.succeeded") {
        return <CheckCircle2 size={15}/>;
    }
    if (kind === "approval.denied" || kind === "job.canceled") {
        return <CircleAlert size={15}/>;
    }
    if (kind === "trigger.fired")
        return <Workflow size={15}/>;
    return <LoaderCircle size={15}/>;
}
function activityTone(kind: ActivityItem["kind"]) {
    if (kind === "cloud.error" || kind === "job.failed" || kind === "approval.denied") {
        return "danger";
    }
    if (kind === "approval.requested" || kind === "job.offered")
        return "warning";
    if (kind === "cloud.connected" ||
        kind === "job.succeeded" ||
        kind === "approval.approved") {
        return "success";
    }
    return "neutral";
}
function formatActivityTime(value: string) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp))
        return value;
    const elapsedMinutes = Math.round((timestamp - Date.now()) / 60000);
    const formatter = new Intl.RelativeTimeFormat(getActiveLocale(), { numeric: "auto" });
    if (Math.abs(elapsedMinutes) < 60)
        return formatter.format(elapsedMinutes, "minute");
    const elapsedHours = Math.round(elapsedMinutes / 60);
    if (Math.abs(elapsedHours) < 24)
        return formatter.format(elapsedHours, "hour");
    const elapsedDays = Math.round(elapsedHours / 24);
    if (Math.abs(elapsedDays) < 7)
        return formatter.format(elapsedDays, "day");
    return new Date(timestamp).toLocaleString(getActiveLocale());
}
