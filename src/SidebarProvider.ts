import * as vscode from "vscode";
import { getNonce } from "./getNonce";
import * as path from "path";
import * as fs from "fs/promises";

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _debounceTimer: NodeJS.Timeout | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "getFileTree":
          {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
              try {
                const fileTree = await this.getWorkspaceFiles(workspaceFolders[0].uri);
                webviewView.webview.postMessage({
                  type: "fileTree",
                  value: fileTree,
                });
              } catch (error: any) {
                vscode.window.showErrorMessage("Error building file tree: " + error.message);
              }
            } else {
              vscode.window.showWarningMessage("No workspace folder found.");
            }
          }
          break;

        case "copyToClipboard":
          {
            const { files } = data;
            if (!files || !files.length) {
              vscode.window.showWarningMessage("No files selected");
              return;
            }
            try {
              const combined = await this.combineSelectedFiles(files);
              await vscode.env.clipboard.writeText(combined);
              vscode.window.showInformationMessage("Files content copied to clipboard!");
            } catch (error: any) {
              vscode.window.showErrorMessage("Failed to copy: " + error.message);
            }
          }
          break;

        case "generateTextFile":
          {
            const { files } = data;
            if (!files || !files.length) {
              vscode.window.showWarningMessage("No files selected");
              return;
            }
            try {
              const combined = await this.combineSelectedFiles(files);
              const document = await vscode.workspace.openTextDocument({
                content: combined,
                language: "markdown",
              });
              await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One,
              });
              vscode.window.showInformationMessage("Text file generated from selected files!");
            } catch (error: any) {
              vscode.window.showErrorMessage("Failed to generate text file: " + error.message);
            }
          }
          break;

        case "onInfo":
          if (data.value) {
            vscode.window.showInformationMessage(data.value);
          }
          break;

        case "onError":
          if (data.value) {
            vscode.window.showErrorMessage(data.value);
          }
          break;
      }
    });
  }

  public revive(panel: vscode.WebviewView) {
    this._view = panel;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();

    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "reset.css")
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "vscode.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "out", "compiled", "sidebar.js")
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "out", "compiled", "sidebar.css")
    );

    // Note: Adjust the CSP as necessary for loading your styles/scripts
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy"
          content="
            default-src 'none';
            img-src ${webview.cspSource} https: data:;
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource} 'unsafe-inline';
            font-src ${webview.cspSource};
          "
        />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link href="${styleResetUri}" rel="stylesheet" />
        <link href="${styleVSCodeUri}" rel="stylesheet" />
        <link href="${styleMainUri}" rel="stylesheet" />
      </head>
      <body>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  /**
   * Builds the file tree for the given workspace root.
   * (Debounced to avoid rapid repeated calls.)
   */
  private async getWorkspaceFiles(workspaceRoot: vscode.Uri): Promise<any[]> {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    return new Promise((resolve, reject) => {
      this._debounceTimer = setTimeout(async () => {
        try {
          // Exclude node_modules and hidden files if you wish; adjust as necessary:
          const allFiles = await vscode.workspace.findFiles("**/*", "**/node_modules/**");
          const tree = this._buildFileTree(allFiles, workspaceRoot);
          resolve(tree);
        } catch (err) {
          reject(err);
        }
      }, 300);
    });
  }

  /**
   * Builds a hierarchical file tree (directory/file structure) from the URIs.
   */
  private _buildFileTree(files: vscode.Uri[], workspaceRoot: vscode.Uri): any[] {
    const tree: Record<string, any> = {};

    for (const file of files) {
      const relativePath = path.relative(workspaceRoot.fsPath, file.fsPath);
      const parts = relativePath.split(path.sep);
      let current = tree;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        if (!current[part]) {
          current[part] = {
            name: part,
            path: parts.slice(0, i + 1).join(path.sep),
            type: isFile ? "file" : "directory",
            checked: false,
            partiallyChecked: false,
            children: isFile ? [] : {},
          };
        }
        current = current[part].children;
      }
    }

    function convertToArray(obj: Record<string, any>): any[] {
      return Object.values(obj).map((node: any) => {
        // node.children is an object if directory, or empty array if file
        const hasChildren = node.type === "directory" && node.children;
        return {
          name: node.name,
          path: node.path,
          type: node.type,
          checked: node.checked,
          partiallyChecked: node.partiallyChecked,
          children: hasChildren ? convertToArray(node.children) : [],
        };
      });
    }

    return convertToArray(tree);
  }

  /**
   * Reads the file content from the local filesystem
   */
  private async getFileContents(filePath: string): Promise<string> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
      if (!workspaceRoot) {
        throw new Error("No workspace folder found");
      }
      const fullPath = path.join(workspaceRoot, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      return content;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return "";
    }
  }

  /**
   * Combines the content of multiple files into a markdown-like text with code fences
   */
  private async combineSelectedFiles(files: string[]): Promise<string> {
    const combined = [];
    for (const filePath of files) {
      const content = await this.getFileContents(filePath);
      combined.push(`\`\`\`${filePath}\n${content}\n\`\`\`\n`);
    }
    return combined.join("\n");
  }
}
