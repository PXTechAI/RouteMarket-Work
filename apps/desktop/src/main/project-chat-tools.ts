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
  }
];

export function projectChatToolTitle(name: string): string {
  if (name === "project_list_files") return "查看项目文件";
  if (name === "project_search") return "搜索项目";
  if (name === "project_read_file") return "读取项目文件";
  if (name === "project_write_file") return "修改项目文件";
  if (name === "project_create_file") return "新建项目文件";
  return name;
}
