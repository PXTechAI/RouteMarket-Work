import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  DownloadableCloudSkill,
  LocalSkillInstallReceipt
} from "../../../../shared/desktop-api";
import {
  isCloudSkillInstalled,
  ProjectSkillsPanel,
  skillReceiptStatusCopy
} from "./ProjectSkillsPanel";

const cloudSkill: DownloadableCloudSkill = {
  skillId: "review",
  version: "1.2.3",
  versionId: "version_review_123",
  name: "Review",
  description: "Review project changes."
};

function localSkill(
  status: LocalSkillInstallReceipt["status"],
  version = "1.2.3"
): LocalSkillInstallReceipt {
  return {
    localProjectId: "project_test",
    skillId: "review",
    name: "Review",
    description: "Review project changes.",
    version,
    packageDigest: `sha256:${"a".repeat(64)}`,
    currentPackageDigest: `sha256:${"a".repeat(64)}`,
    source: "web_library",
    sourceLabel: "review.zip",
    publisherFingerprint: null,
    installedAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    status,
    managed: true,
    relativePath: ".routemarket/skills/review/SKILL.md",
    permissions: ["project.read"],
    operations: ["invoke"]
  };
}

describe("ProjectSkillsPanel", () => {
  it("explains why Skill management is unavailable without a project folder", () => {
    const html = renderToStaticMarkup(<ProjectSkillsPanel actions={null} />);

    expect(html).toContain("管理本地 Skill");
    expect(html).toContain("关联项目文件夹后管理本地 Skill");
    expect(html).toContain("disabled");
  });

  it("only treats the same ready local version as installed", () => {
    expect(isCloudSkillInstalled([localSkill("ready")], cloudSkill)).toBe(true);
    expect(isCloudSkillInstalled([localSkill("modified")], cloudSkill)).toBe(false);
    expect(isCloudSkillInstalled([localSkill("ready", "1.2.2")], cloudSkill)).toBe(false);
  });

  it("provides stable user-facing status labels", () => {
    expect(skillReceiptStatusCopy("ready")).toBe("可使用");
    expect(skillReceiptStatusCopy("modified")).toBe("内容已变化");
    expect(skillReceiptStatusCopy("missing")).toBe("文件已缺失");
    expect(skillReceiptStatusCopy("invalid")).toBe("无法验证");
  });
});
