import { tr } from "../../../i18n";
import { FolderOpen, WandSparkles } from "lucide-react";
import { useState } from "react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";
import { availableWorkflowSkills, workflowSkills } from "../workflow-skill-registry";
export function WorkflowSkillSetup({ model, actions }: {
    model: WorkflowPageModel;
    actions: WorkflowPageActions["canvas"];
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
    if (!skill)
        return null;
    const values = valuesBySkill[skill.id] ?? {};
    function setValue(key: string, value: string) {
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
    const complete = skill.setupFields.every((field) => !field.required || Boolean(values[field.key]?.trim()));
    return (<section className="workflow-amazon-setup">
      <div className="workflow-amazon-copy">
        <span><WandSparkles size={15}/></span>
        <div>
          <strong>{skill.name}</strong>
          <small>{skill.description}</small>
        </div>
      </div>
      {availableSkills.length > 1 && (<label>
          <span>Skill</span>
          <select value={skill.id} onChange={(event) => setSelectedSkillId(event.target.value)}>
            {availableSkills.map((candidate) => (<option key={candidate.id} value={candidate.id}>{candidate.name}</option>))}
          </select>
        </label>)}
      {skill.setupFields.map((field) => field.kind === "directory" ? (<button key={field.key} type="button" title={values[field.key] || tr("ui.929a3cded744", [field.label])} onClick={() => void chooseDirectory(field.key)}>
            <FolderOpen size={13}/>
            {values[field.key] ? tr("ui.44c084393835", [field.label]) : tr("ui.929a3cded744", [field.label])}
          </button>) : (<label key={field.key}>
            <span>{field.label}</span>
            <input type={field.kind} value={values[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setValue(field.key, event.target.value)}/>
          </label>))}
      <button className="workflow-amazon-create" type="button" disabled={!model.selectedProjectId || !complete} onClick={() => actions.onCreateWorkflowSkill(skill.id, values)}>{tr("ui.8e4f0ae29a3a")}</button>
    </section>);
}
