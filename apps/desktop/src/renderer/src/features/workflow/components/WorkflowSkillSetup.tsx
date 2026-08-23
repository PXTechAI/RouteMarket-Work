import "./workflow-skill-setup.scss";
import { tr } from "../../../i18n";
import { FilePlus2, FolderOpen, WandSparkles, X } from "lucide-react";
import { useState } from "react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
import { availableWorkflowSkills, workflowSkills } from "../workflow-skill-registry";
export function WorkflowSkillSetup({ model, actions, onCreateBlank, onCreated, onClose }: {
    model: WorkflowPageModel;
    actions: WorkflowPageActions["canvas"];
    onCreateBlank(): void;
    onCreated(): void;
    onClose(): void;
}) {
    const availableSkills = availableWorkflowSkills(model.registry?.definitions ?? []);
    const allSkills = workflowSkills();
    const [selectedSkillId, setSelectedSkillId] = useState(() => availableSkills[0]?.id ?? allSkills[0]?.id ?? "");
    const skill = availableSkills.find((candidate) => candidate.id === selectedSkillId) ??
        availableSkills[0] ??
        null;
    const [valuesBySkill, setValuesBySkill] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(allSkills.map((candidate) => [
        candidate.id,
        Object.fromEntries(candidate.setupFields.map((field) => [field.key, field.defaultValue ?? ""]))
    ])));
    const values = skill ? valuesBySkill[skill.id] ?? {} : {};
    function setValue(key: string, value: string) {
        if (!skill)
            return;
        setValuesBySkill((current) => ({
            ...current,
            [skill.id]: { ...(current[skill.id] ?? {}), [key]: value }
        }));
    }
    async function chooseDirectory(key: string) {
        const directory = await actions.onChooseOutputDirectory();
        if (directory)
            setValue(key, directory);
    }
    const complete = skill
        ? skill.setupFields.every((field) => !field.required || Boolean(values[field.key]?.trim()))
        : false;
    return (<section className="workflow-create-panel">
      <header className="workflow-create-header">
        <div className="workflow-create-heading">
          <span><FilePlus2 size={18}/></span>
          <div>
            <strong>{tr("ui.fdba55f21698")}</strong>
            <small>从空白画布开始，或使用模板快速生成节点和触发器。</small>
          </div>
        </div>
        <div className="workflow-create-actions">
          <button type="button" onClick={onCreateBlank}>
            <FilePlus2 size={15}/>空白工作流
          </button>
          <button className="icon-only" type="button" title={tr("ui.6c14bd7f6f9e")} onClick={onClose}>
            <X size={16}/>
          </button>
        </div>
      </header>

      {skill ? (<div className="workflow-template-card">
        <div className="workflow-template-copy">
          <span><WandSparkles size={18}/></span>
          <div>
            <strong>{skill.name}</strong>
            <small>{skill.description}</small>
          </div>
          {availableSkills.length > 1 && (<label>
              <span>模板</span>
              <select value={skill.id} onChange={(event) => setSelectedSkillId(event.target.value)}>
                {availableSkills.map((candidate) => (<option key={candidate.id} value={candidate.id}>{candidate.name}</option>))}
              </select>
            </label>)}
        </div>

        <div className="workflow-template-fields">
          {skill.setupFields.map((field) => field.kind === "directory" ? (<button className="workflow-template-directory" key={field.key} type="button" title={values[field.key] || tr("ui.929a3cded744", [field.label])} onClick={() => void chooseDirectory(field.key)}>
                <FolderOpen size={15}/>
                {values[field.key] ? tr("ui.44c084393835", [field.label]) : tr("ui.929a3cded744", [field.label])}
              </button>) : (<label key={field.key}>
                <span>{field.label}</span>
                <input type={field.kind} value={values[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setValue(field.key, event.target.value)}/>
              </label>))}
        </div>

        <footer>
          <span>创建后可在画布中逐个调整节点配置。</span>
          <button className="workflow-template-create" type="button" disabled={!model.selectedProjectId || !complete} onClick={() => {
              actions.onCreateWorkflowSkill(skill.id, values);
              onCreated();
            }}>{tr("ui.8e4f0ae29a3a")}</button>
        </footer>
      </div>) : (<div className="workflow-template-empty">
          当前节点环境没有可用模板，仍可创建空白工作流。
        </div>)}
    </section>);
}
