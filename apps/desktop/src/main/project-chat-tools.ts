import { trMain } from "./i18n";
import type { ProjectChatArtifact } from "../shared/desktop-api";
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
  artifacts?: ProjectChatArtifact[];
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
  if (name === "web_search") return trMain("ui.45e62e474f4a");
  if (name.startsWith("mcp_local_")) return trMain("ui.fc60bd63e7ad");
  if (name.startsWith("skill_local_")) return trMain("ui.3cedc598d7d1");
  if (name === "project_list_files") return trMain("ui.cc7dcd4bb00a");
  if (name === "project_search") return trMain("ui.b617f05c84e4");
  if (name === "project_read_file") return trMain("ui.87e4a3b9a477");
  if (name === "project_write_file") return trMain("ui.d477365c5d2b");
  if (name === "project_create_file") return trMain("ui.54c7ecfd638a");
  if (name === "spreadsheet") return trMain("chat.tool.spreadsheet");
  if (name === "project_start_process") return trMain("ui.72729d85ab04");
  if (name === "project_list_processes") return trMain("ui.18cf322cd643");
  if (name === "project_stop_process") return trMain("ui.d86dd8ca7d2b");
  if (name === "browser_get_state") return trMain("ui.3a0191f541dd");
  if (name === "browser_create_page") return trMain("ui.92ab1f079b05");
  if (name === "browser_navigate") return trMain("ui.22d040b33dbe");
  if (name === "browser_click") return trMain("ui.21c2547386d0");
  if (name === "browser_type") return trMain("ui.7b93ef577697");
  if (name === "browser_upload") return trMain("ui.a40b283a86f3");
  if (name === "browser_extract") return trMain("ui.074c72c437c6");
  return name;
}
