import { getActiveLocale, tr } from "../../i18n";
import "./approval.scss";
import { Ban, Check, CheckCircle2, LoaderCircle, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ApprovalPolicy, ApprovalRecord } from "../../../../shared/desktop-api";
type ApprovalStatusFilter = "all" | ApprovalRecord["status"];
type ApprovalPageProps = {
    approvals: ApprovalRecord[];
    policies: ApprovalPolicy[];
    projectName: string | null;
    busyPolicyId: string | null;
    onRevokePolicy: (policyId: string) => void;
};
export function ApprovalPage({ approvals, policies, projectName, busyPolicyId, onRevokePolicy }: ApprovalPageProps) {
    const [statusFilter, setStatusFilter] = useState<ApprovalStatusFilter>("all");
    const [capabilityFilter, setCapabilityFilter] = useState("");
    const capabilities = useMemo(() => [...new Set(approvals.map((approval) => approval.capability))].sort(), [approvals]);
    const visibleApprovals = useMemo(() => approvals.filter((approval) => (statusFilter === "all" || approval.status === statusFilter) &&
        (!capabilityFilter || approval.capability === capabilityFilter)), [approvals, capabilityFilter, statusFilter]);
    return (<section className="approval-page">
      <header className="approval-page-header">
        <div>
          <span className="eyebrow">Approval Center</span>
          <h2>{tr("ui.7ae665dec5a6")}</h2>
          <p>{tr("ui.5ee98755232d")}</p>
        </div>
        <div className="approval-summary">
          <span><strong>{policies.length}</strong>{tr("ui.3bfec152dcac")}</span>
          <span><strong>{approvals.length}</strong>{tr("ui.69d28aa1b0a6")}</span>
        </div>
      </header>

      <div className="approval-content">
        <section className="approval-section">
          <div className="approval-section-heading">
            <div>
              <h3>{tr("ui.9c41e78cd8d7")}</h3>
              <p>{projectName ? tr("ui.3fcfdaa29b31", [projectName]) : tr("ui.0e861814696d")}</p>
            </div>
            <span>{policies.length}</span>
          </div>

          <div className="approval-policy-list">
            {policies.map((policy) => (<article className="approval-policy-row" key={policy.policyId}>
                <div className={`approval-policy-icon ${policy.effect}`}>
                  {policy.effect === "allow" ? <CheckCircle2 size={17}/> : <Ban size={17}/>}
                </div>
                <div className="approval-policy-copy">
                  <div>
                    <strong>{policy.capability}</strong>
                    <span className={`approval-effect ${policy.effect}`}>
                      {policy.effect === "allow" ? tr("ui.2c28b7611cdf") : tr("ui.35749d186dd7")}
                    </span>
                  </div>
                  <p>{tr("ui.e9443fdad6c9")}{formatDate(policy.updatedAt)}</p>
                </div>
                <button className="approval-revoke-button" type="button" title={tr("ui.b3786742fc6a")} aria-label={tr("ui.b86f3f7f0ee2", [policy.capability])} disabled={busyPolicyId === policy.policyId} onClick={() => onRevokePolicy(policy.policyId)}>
                  {busyPolicyId === policy.policyId
                ? <LoaderCircle className="spin" size={15}/>
                : <Trash2 size={15}/>}
                </button>
              </article>))}
            {policies.length === 0 && (<div className="approval-policy-empty">
                <ShieldCheck size={22}/>
                <div>
                  <strong>{projectName ? tr("ui.c6bb2e594866") : tr("ui.5bae09492737")}</strong>
                  <p>
                    {projectName
                ? tr("ui.15991fa2a796") : tr("ui.820e7a7b0a6c")}
                  </p>
                </div>
              </div>)}
          </div>
        </section>

        <section className="approval-section approval-history-section">
          <div className="approval-section-heading">
            <div>
              <h3>{tr("ui.24b3235ab438")}</h3>
              <p>{tr("ui.81de9de1aa63")}</p>
            </div>
            <span>{visibleApprovals.length}</span>
          </div>

          <div className="approval-filters">
            <div className="approval-status-filter" aria-label={tr("ui.d2f9177175c1")}>
              {([
            ["all", tr("ui.778fc8f99453")],
            ["approved", tr("ui.3dec7f67efea")],
            ["denied", tr("ui.4c7c52c70655")],
            ["requested", tr("ui.bd3488d0a929")]
        ] as const).map(([value, label]) => (<button key={value} className={statusFilter === value ? "active" : ""} type="button" onClick={() => setStatusFilter(value)}>
                  {label}
                </button>))}
            </div>
            <label className="approval-capability-filter">
              <Search size={14}/>
              <select aria-label={tr("ui.8c84d36f7391")} value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value)}>
                <option value="">{tr("ui.85b24ba6a2e2")}</option>
                {capabilities.map((capability) => (<option key={capability} value={capability}>{capability}</option>))}
              </select>
            </label>
          </div>

          <div className="approval-history-list">
            {visibleApprovals.map((approval) => (<article key={approval.invocationId} className="approval-history-row">
                <div className={`approval-record-icon ${approval.status}`}>
                  {approval.status === "approved"
                ? <Check size={16}/>
                : approval.status === "denied"
                    ? <X size={16}/>
                    : <LoaderCircle className="spin" size={16}/>}
                </div>
                <div className="approval-record-copy">
                  <div>
                    <strong>{approval.title}</strong>
                    <span className={`risk-badge ${approval.risk.toLowerCase()}`}>{approval.risk}</span>
                  </div>
                  <p>{approval.capability} · {approval.detail}</p>
                  <code title={approval.parametersHash}>{approval.parametersHash}</code>
                </div>
                <div className="approval-record-meta">
                  <strong>{approvalStatusLabel(approval.status)}</strong>
                  <time>{formatDate(approval.resolvedAt ?? approval.requestedAt)}</time>
                </div>
              </article>))}
            {visibleApprovals.length === 0 && (<div className="approval-history-empty">
                <ShieldCheck size={28}/>
                <h3>{approvals.length ? tr("ui.6dce0134d68e") : tr("ui.a0ec0a1091a3")}</h3>
                <p>{approvals.length ? tr("ui.5c3fe03bf5f7") : tr("ui.20697b9481f9")}</p>
              </div>)}
          </div>
        </section>
      </div>
    </section>);
}
function approvalStatusLabel(status: ApprovalRecord["status"]): string {
    if (status === "approved")
        return tr("ui.3dec7f67efea");
    if (status === "denied")
        return tr("ui.4c7c52c70655");
    return tr("ui.25a45621edf5");
}
function formatDate(value: string): string {
    return new Date(value).toLocaleString(getActiveLocale());
}
