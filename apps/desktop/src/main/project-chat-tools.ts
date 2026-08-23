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
  images?: string[];
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
      name: "browser_request_user_login",
      description:
        "Pause Agent control and hand the active Managed Browser page to the user for sensitive login steps such as password entry, available password-manager or passkey flows, verification codes, QR scans or CAPTCHA. Do not ask the user to put credentials in chat. After login, the user returns control to the Agent.",
      parameters: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
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
      name: "browser_click_at",
      description:
        "Click visible page coordinates with a real mouse input event in an Agent-controlled Managed Browser page. Use coordinates returned by browser_inspect or inferred from a screenshot. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          x: {
            type: "integer",
            minimum: 0,
            description: "Horizontal coordinate relative to the visible page."
          },
          y: {
            type: "integer",
            minimum: 0,
            description: "Vertical coordinate relative to the visible page."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["x", "y"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_click_ref",
      description:
        "Click an element by the stable ref_id returned by the most recent browser_inspect call. Supports open Shadow DOM and same-origin frames, re-resolves the locator, and uses a real mouse event. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          ref_id: {
            type: "string",
            description: "Element reference returned by browser_inspect."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["ref_id"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_scroll",
      description:
        "Scroll an Agent-controlled Managed Browser page using a real mouse wheel input event. Positive delta_y scrolls down and negative delta_y scrolls up. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          delta_x: { type: "integer", minimum: -100000, maximum: 100000 },
          delta_y: { type: "integer", minimum: -100000, maximum: 100000 },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["delta_y"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_press",
      description:
        "Press a keyboard key in an Agent-controlled Managed Browser page. Supports Enter, Tab, Escape, navigation keys, F1-F12 and single characters, with optional shift/control/alt/meta modifiers. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Key to press." },
          modifiers: {
            type: "array",
            maxItems: 4,
            items: { type: "string", enum: ["shift", "control", "alt", "meta"] }
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["key"],
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
      name: "browser_type_ref",
      description:
        "Replace the value of an input, textarea or contenteditable element by the stable ref_id returned by browser_inspect. Supports open Shadow DOM and same-origin frames. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          ref_id: {
            type: "string",
            description: "Editable element reference returned by browser_inspect."
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
        required: ["ref_id", "text"],
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
  },
  {
    type: "function",
    function: {
      name: "browser_inspect",
      description:
        "Inspect the current page as compact visible text plus interactive DOM elements. Returns semantic names, stable CSS selectors and element coordinates. Requires local approval because page content may be private.",
      parameters: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          },
          max_elements: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Maximum interactive elements to return. Defaults to 200."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_wait_for",
      description:
        "Wait until an Agent-controlled page finishes loading, a selector appears, or visible text appears. Searches the main document, open Shadow DOM and same-origin frames.",
      parameters: {
        type: "object",
        properties: {
          condition: {
            type: "string",
            enum: ["load", "selector", "text"]
          },
          value: {
            type: "string",
            description: "Required for selector and text conditions; omit for load."
          },
          timeout_ms: {
            type: "integer",
            minimum: 100,
            maximum: 30000,
            description: "Maximum wait duration. Defaults to 10000."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["condition"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_get_console",
      description:
        "Read recent console messages and JavaScript errors captured from an Agent-controlled Managed Browser page. Requires local approval because logs may contain private data.",
      parameters: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            description: "Maximum recent entries to return. Defaults to 100."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_get_network",
      description:
        "Read recent request and response metadata captured from an Agent-controlled Managed Browser page, including status, resource type, duration and failures. Sensitive URL query values are redacted. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            description: "Maximum recent entries to return. Defaults to 100."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_get_network_body",
      description:
        "Read a bounded response body for a request returned by browser_get_network. Textual bodies are decoded; binary bodies remain base64. Requires explicit local approval because response bodies may contain sensitive data.",
      parameters: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            description: "Request identifier returned by browser_get_network."
          },
          max_characters: {
            type: "integer",
            minimum: 1,
            maximum: 200000,
            description: "Maximum body characters to return. Defaults to 100000."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        required: ["request_id"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_get_performance",
      description:
        "Read Navigation Timing, paint timing, aggregate resource sizes and the slowest resources from an Agent-controlled Managed Browser page. URLs are redacted and the operation requires local approval.",
      parameters: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_get_diagnostics",
      description:
        "Return a compact browser diagnostics snapshot combining JavaScript warnings/errors, failed or HTTP-error requests, and page performance metrics. Response bodies are never included. Requires local approval.",
      parameters: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          },
          console_limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            description: "Maximum recent console entries to inspect. Defaults to 100."
          },
          network_limit: {
            type: "integer",
            minimum: 1,
            maximum: 200,
            description: "Maximum recent network entries to inspect. Defaults to 100."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_export_har",
      description:
        "Export captured, redacted Managed Browser network metadata as a HAR 1.2 file in the current project. Request/response bodies and cookies are excluded. Requires explicit approval because it creates a project file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "New project-relative .har file path. The file must not already exist."
          },
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 300,
            description: "Maximum recent requests to export. Defaults to 300."
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
      name: "browser_screenshot",
      description:
        "Capture a compressed screenshot of an Agent-controlled Managed Browser page for visual verification. Requires local approval because the page may contain private data.",
      parameters: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "Optional page identifier. Uses the active project page when omitted."
          }
        },
        additionalProperties: false
      }
    }
  }
];

export const ATTACHED_BROWSER_CHAT_TOOLS: ProjectChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "browser_attached_navigate",
      description: "Navigate the already-connected Attached Browser page. The user must establish the R3 browser attachment in the UI first.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Credential-free HTTP(S) URL." } },
        required: ["url"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_attached_inspect",
      description: "Inspect visible text and interactive DOM elements in the connected Attached Browser, including open Shadow DOM and same-origin frames. Returns stable ref_id values and requires explicit approval.",
      parameters: {
        type: "object",
        properties: {
          max_elements: { type: "integer", minimum: 1, maximum: 500, description: "Maximum elements. Defaults to 200." }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_attached_click_ref",
      description: "Click an Attached Browser element using a ref_id from the most recent attached inspection. Uses a real CDP mouse event and requires explicit approval.",
      parameters: {
        type: "object",
        properties: { ref_id: { type: "string" } },
        required: ["ref_id"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_attached_type_ref",
      description: "Type into an Attached Browser element using a ref_id from the most recent attached inspection. Input text is not echoed in Tool results. Requires explicit approval.",
      parameters: {
        type: "object",
        properties: {
          ref_id: { type: "string" },
          text: { type: "string" }
        },
        required: ["ref_id", "text"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_attached_get_console",
      description: "Read recent console messages and JavaScript exceptions from the connected Attached Browser. Requires explicit approval because the browser may contain signed-in private data.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 200 } },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_attached_get_network",
      description: "Read recent redacted request/response metadata from the connected Attached Browser. Requires explicit approval.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 300 } },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_attached_get_network_body",
      description: "Read a bounded response body captured from the connected Attached Browser. Requires high-risk approval because an attached signed-in session may return sensitive data.",
      parameters: {
        type: "object",
        properties: {
          request_id: { type: "string" },
          max_characters: { type: "integer", minimum: 1, maximum: 200000 }
        },
        required: ["request_id"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_attached_screenshot",
      description: "Capture a compressed screenshot from the connected Attached Browser for a vision-capable model. Requires explicit approval.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  }
];

export function projectChatToolTitle(name: string): string {
  if (name === "browser_attached_navigate") return "Navigate attached browser";
  if (name === "browser_attached_inspect") return "Inspect attached browser";
  if (name === "browser_attached_click_ref") return "Click attached browser element";
  if (name === "browser_attached_type_ref") return "Type in attached browser";
  if (name === "browser_attached_get_console") return "Read attached browser console";
  if (name === "browser_attached_get_network") return "Read attached browser network";
  if (name === "browser_attached_get_network_body") return "Read attached response body";
  if (name === "browser_attached_screenshot") return "Capture attached browser screenshot";
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
  if (name === "browser_request_user_login") return "Request user login";
  if (name === "browser_create_page") return trMain("ui.92ab1f079b05");
  if (name === "browser_navigate") return trMain("ui.22d040b33dbe");
  if (name === "browser_click") return trMain("ui.21c2547386d0");
  if (name === "browser_click_ref") return "Click referenced browser element";
  if (name === "browser_click_at") return "Click browser coordinates";
  if (name === "browser_scroll") return "Scroll browser page";
  if (name === "browser_press") return "Press browser key";
  if (name === "browser_type") return trMain("ui.7b93ef577697");
  if (name === "browser_type_ref") return "Type into referenced browser element";
  if (name === "browser_upload") return trMain("ui.a40b283a86f3");
  if (name === "browser_extract") return trMain("ui.074c72c437c6");
  if (name === "browser_inspect") return "Inspect browser DOM";
  if (name === "browser_wait_for") return "Wait for browser page";
  if (name === "browser_get_console") return "Read browser console";
  if (name === "browser_get_network") return "Read browser network";
  if (name === "browser_get_network_body") return "Read browser response body";
  if (name === "browser_get_performance") return "Read browser performance";
  if (name === "browser_get_diagnostics") return "Diagnose browser page";
  if (name === "browser_export_har") return "Export browser HAR";
  if (name === "browser_screenshot") return trMain("ui.963479826cf8");
  return name;
}
