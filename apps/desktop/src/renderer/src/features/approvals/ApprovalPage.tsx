import {
  Ban,
  Check,
  CheckCircle2,
  LoaderCircle,
  Search,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ApprovalPolicy,
  ApprovalRecord
} from "../../../../shared/desktop-api";

type ApprovalStatusFilter = "all" | ApprovalRecord["status"];

type ApprovalPageProps = {
  approvals: ApprovalRecord[];
  policies: ApprovalPolicy[];
  projectName: string | null;
  busyPolicyId: string | null;
  onRevokePolicy: (policyId: string) => void;
};

export function ApprovalPage({
  approvals,
  policies,
  projectName,
  busyPolicyId,
  onRevokePolicy
}: ApprovalPageProps) {
  const [statusFilter, setStatusFilter] = useState<ApprovalStatusFilter>("all");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const capabilities = useMemo(
    () => [...new Set(approvals.map((approval) => approval.capability))].sort(),
    [approvals]
  );
  const visibleApprovals = useMemo(
    () => approvals.filter((approval) =>
      (statusFilter === "all" || approval.status === statusFilter) &&
      (!capabilityFilter || approval.capability === capabilityFilter)
    ),
    [approvals, capabilityFilter, statusFilter]
  );

  return (
    <section className="approval-page">
      <header className="approval-page-header">
        <div>
          <span className="eyebrow">Approval Center</span>
          <h2>本机权限与审批</h2>
          <p>管理当前项目的长期规则，并审查每次本地能力调用。</p>
        </div>
        <div className="approval-summary">
          <span><strong>{policies.length}</strong> 条策略</span>
          <span><strong>{approvals.length}</strong> 条记录</span>
        </div>
      </header>

      <div className="approval-content">
        <section className="approval-section">
          <div className="approval-section-heading">
            <div>
              <h3>项目策略</h3>
              <p>{projectName ? `${projectName} 的长期权限规则` : "选择项目后管理长期权限规则"}</p>
            </div>
            <span>{policies.length}</span>
          </div>

          <div className="approval-policy-list">
            {policies.map((policy) => (
              <article className="approval-policy-row" key={policy.policyId}>
                <div className={`approval-policy-icon ${policy.effect}`}>
                  {policy.effect === "allow" ? <CheckCircle2 size={17} /> : <Ban size={17} />}
                </div>
                <div className="approval-policy-copy">
                  <div>
                    <strong>{policy.capability}</strong>
                    <span className={`approval-effect ${policy.effect}`}>
                      {policy.effect === "allow" ? "始终允许" : "始终拒绝"}
                    </span>
                  </div>
                  <p>作用于当前项目 · 更新于 {formatDate(policy.updatedAt)}</p>
                </div>
                <button
                  className="approval-revoke-button"
                  type="button"
                  title="撤销此项目策略"
                  aria-label={`撤销 ${policy.capability} 项目策略`}
                  disabled={busyPolicyId === policy.policyId}
                  onClick={() => onRevokePolicy(policy.policyId)}
                >
                  {busyPolicyId === policy.policyId
                    ? <LoaderCircle className="spin" size={15} />
                    : <Trash2 size={15} />}
                </button>
              </article>
            ))}
            {policies.length === 0 && (
              <div className="approval-policy-empty">
                <ShieldCheck size={22} />
                <div>
                  <strong>{projectName ? "当前项目没有长期策略" : "尚未选择项目"}</strong>
                  <p>
                    {projectName
                      ? "敏感操作弹窗中可以选择项目内始终允许或始终拒绝。"
                      : "项目策略只会作用于创建它的本地项目。"}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="approval-section approval-history-section">
          <div className="approval-section-heading">
            <div>
              <h3>审批历史</h3>
              <p>审计记录只保存目标摘要和参数哈希，不保存文件内容或秘密参数。</p>
            </div>
            <span>{visibleApprovals.length}</span>
          </div>

          <div className="approval-filters">
            <div className="approval-status-filter" aria-label="审批状态筛选">
              {([
                ["all", "全部"],
                ["approved", "已允许"],
                ["denied", "已拒绝"],
                ["requested", "等待中"]
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={statusFilter === value ? "active" : ""}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="approval-capability-filter">
              <Search size={14} />
              <select
                aria-label="按能力筛选审批"
                value={capabilityFilter}
                onChange={(event) => setCapabilityFilter(event.target.value)}
              >
                <option value="">全部能力</option>
                {capabilities.map((capability) => (
                  <option key={capability} value={capability}>{capability}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="approval-history-list">
            {visibleApprovals.map((approval) => (
              <article key={approval.invocationId} className="approval-history-row">
                <div className={`approval-record-icon ${approval.status}`}>
                  {approval.status === "approved"
                    ? <Check size={16} />
                    : approval.status === "denied"
                      ? <X size={16} />
                      : <LoaderCircle className="spin" size={16} />}
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
              </article>
            ))}
            {visibleApprovals.length === 0 && (
              <div className="approval-history-empty">
                <ShieldCheck size={28} />
                <h3>{approvals.length ? "没有符合筛选条件的记录" : "暂无审批记录"}</h3>
                <p>{approvals.length ? "调整状态或能力筛选后再查看。" : "敏感的本地操作会显示在这里。"}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function approvalStatusLabel(status: ApprovalRecord["status"]): string {
  if (status === "approved") return "已允许";
  if (status === "denied") return "已拒绝";
  return "等待确认";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN");
}
