<script lang="ts">
    import { onMount } from 'svelte';
    import { tsvscode } from '../vscode';

    type FileNode = {
        path: string;
        type: 'file' | 'directory';
        children?: FileNode[];
        checked?: boolean;
    };

    let files: FileNode[] = [];
    
    onMount(() => {
        // Request file tree from extension
        tsvscode.postMessage({ type: 'getFileTree' });
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'fileTree':
                files = message.value;
                break;
        }
    });

    function toggleFile(node: FileNode) {
        node.checked = !node.checked;
        // Notify extension of selection change
        tsvscode.postMessage({ 
            type: 'selectionChanged',
            value: { path: node.path, checked: node.checked }
        });
    }
</script>

<style>
    .container {
        padding: 10px;
    }

    .file-tree {
        margin-left: 20px;
    }

    .file-entry {
        display: flex;
        align-items: center;
        padding: 2px 0;
    }

    .actions {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 10px;
        background: var(--vscode-sideBar-background);
        border-top: 1px solid var(--vscode-sideBar-border);
    }

    button {
        margin: 5px;
        padding: 4px 8px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 2px;
        cursor: pointer;
    }

    button:hover {
        background: var(--vscode-button-hoverBackground);
    }
</style>

<div class="container">
    <div class="file-tree">
        {#each files as file}
            <div class="file-entry">
                <input 
                    type="checkbox" 
                    checked={file.checked}
                    on:change={() => toggleFile(file)}
                />
                <span>{file.path}</span>
            </div>
        {/each}
    </div>

    <div class="actions">
        <button on:click={() => tsvscode.postMessage({ type: 'copyToClipboard' })}>
            Copy to Clipboard
        </button>
        <button on:click={() => tsvscode.postMessage({ type: 'generateTextFile' })}>
            Generate Text File
        </button>
    </div>
</div>