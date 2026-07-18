export type ProjectChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ProjectChatToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ProjectChatToolExecution = {
  content: string;
  summary: string;
  isError: boolean;
};

export const PROJECT_CHAT_TOOLS: ProjectChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "project_list_files",
      description:
        "List files and directories in the current local project. Use this before guessing project paths.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "project_search",
      description:
        "Search file paths and text content in the current local project.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Literal text to search for, between 1 and 256 characters."
          }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "project_read_file",
      description:
        "Read a UTF-8 text file in the current local project. The result includes sha256 for a later guarded write.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative file path using forward slashes."
          }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "project_write_file",
      description:
        "Replace an existing UTF-8 project file. Read it first and pass its sha256 as expected_sha256. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative file path using forward slashes."
          },
          text: {
            type: "string",
            description: "Complete replacement file content."
          },
          expected_sha256: {
            type: "string",
            description: "The sha256 returned by project_read_file."
          }
        },
        required: ["path", "text", "expected_sha256"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "project_create_file",
      description:
        "Create a new UTF-8 file in the current local project. Fails if it already exists and requires local approval.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative file path using forward slashes."
          },
          text: {
            type: "string",
            description: "Initial file content."
          }
        },
        required: ["path", "text"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "project_start_process",
      description:
        "Start a controlled process in the current project directory. Pass the executable and each argument separately; no implicit shell is used. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          executable: {
            type: "string",
            description:
              "Executable name or path, such as pnpm, npm, node, cmd.exe, or powershell.exe."
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Arguments passed directly to the executable."
          },
          wait_ms: {
            type: "integer",
            minimum: 0,
            maximum: 15_000,
            description:
              "How long to wait for initial output or process exit before returning. Defaults to 1000."
          }
        },
        required: ["executable", "args"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "project_list_processes",
      description:
        "List controlled processes started for the current project, including status and bounded stdout/stderr. Use this to inspect a command or development server after it starts.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "project_stop_process",
      description:
        "Stop a controlled process tree that belongs to the current project. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          process_id: {
            type: "string",
            description: "Process identifier returned by project_start_process."
          }
        },
        required: ["process_id"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_get_state",
      description:
        "Inspect the Managed Browser pages for the current project. The result identifies the active page and whether it is under user takeover or Agent control.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_create_page",
      description:
        "Create a new Managed Browser page for the current project under Agent control. Optionally open an HTTP or HTTPS URL and use an existing project Browser Profile.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Optional HTTP or HTTPS URL. Defaults to about:blank."
          },
          profile_id: {
            type: "string",
            description: "Optional Browser Profile identifier returned by browser_get_state."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description:
        "Navigate an Agent-controlled Managed Browser page in the current project to an HTTP or HTTPS URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "HTTP or HTTPS URL to open."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["url"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_click",
      description:
        "Click an element selected by a CSS selector in an Agent-controlled Managed Browser page. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector for the element to click."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["selector"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_type",
      description:
        "Replace the value of an input or textarea selected by a CSS selector in an Agent-controlled Managed Browser page. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector for the input or textarea."
          },
          text: {
            type: "string",
            description: "Text to enter."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["selector", "text"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_upload",
      description:
        "Upload one or more files from the current project into a file input on an Agent-controlled Managed Browser page. Requires explicit local approval.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector for an enabled input element whose type is file."
          },
          relative_paths: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: {
              type: "string",
              description: "Project-relative file path."
            }
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["selector", "relative_paths"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_extract",
      description:
        "Extract visible text from an element selected by a CSS selector in an Agent-controlled Managed Browser page.",
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "CSS selector for the element whose text should be read."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["selector"],
        additionalProperties: false
      }
    }
  }
];

export function projectChatToolTitle(name: string): string {
  if (name.startsWith("mcp_local_")) return "调用 Local MCP Tool";
  if (name.startsWith("skill_local_")) return "调用项目 Skill";
  if (name === "project_list_files") return "查看项目文件";
  if (name === "project_search") return "搜索项目";
  if (name === "project_read_file") return "读取项目文件";
  if (name === "project_write_file") return "修改项目文件";
  if (name === "project_create_file") return "新建项目文件";
  if (name === "project_start_process") return "启动项目进程";
  if (name === "project_list_processes") return "查看项目进程";
  if (name === "project_stop_process") return "停止项目进程";
  if (name === "browser_get_state") return "查看浏览器页面";
  if (name === "browser_create_page") return "新建浏览器页面";
  if (name === "browser_navigate") return "打开网页";
  if (name === "browser_click") return "点击网页元素";
  if (name === "browser_type") return "填写网页内容";
  if (name === "browser_upload") return "上传项目文件";
  if (name === "browser_extract") return "读取网页内容";
  return name;
}
