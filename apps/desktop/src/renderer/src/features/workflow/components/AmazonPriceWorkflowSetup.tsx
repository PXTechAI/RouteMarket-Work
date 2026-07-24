import { FolderOpen, ShoppingCart } from "lucide-react";
import { useState } from "react";
import type { WorkflowPageActions, WorkflowPageModel } from "../types";

export function AmazonPriceWorkflowSetup({
  model,
  actions
}: {
  model: WorkflowPageModel;
  actions: WorkflowPageActions["canvas"];
}) {
  const [url, setUrl] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [fileName, setFileName] = useState("amazon-product-price.csv");

  async function chooseDirectory() {
    const directory = await actions.onChooseOutputDirectory();
    if (directory) setOutputDirectory(directory);
  }

  return (
    <section className="workflow-amazon-setup">
      <div className="workflow-amazon-copy">
        <span><ShoppingCart size={15} /></span>
        <div>
          <strong>Amazon 单品价格采集</strong>
          <small>打开商品页 → 识别商品名与价格 → 保存 CSV 到本地</small>
        </div>
      </div>
      <label>
        <span>商品链接</span>
        <input
          value={url}
          placeholder="https://www.amazon.com/dp/..."
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <label>
        <span>输出文件</span>
        <input
          value={fileName}
          placeholder="amazon-product-price.csv"
          onChange={(event) => setFileName(event.target.value)}
        />
      </label>
      <button
        type="button"
        title={outputDirectory || "选择保存目录"}
        onClick={() => void chooseDirectory()}
      >
        <FolderOpen size={13} />
        {outputDirectory ? "已选择目录" : "选择目录"}
      </button>
      <button
        className="workflow-amazon-create"
        type="button"
        disabled={!model.selectedProjectId || !url.trim() || !outputDirectory}
        onClick={() =>
          actions.onCreateAmazonPriceWorkflow({
            url,
            outputDirectory,
            fileName
          })
        }
      >
        生成工作流
      </button>
    </section>
  );
}
