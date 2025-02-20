<script lang="ts">
    import { onMount } from 'svelte';
    import { tsvscode } from '../vscode';

    /**
     * A single node in the file tree.
     */
    type FileNode = {
        name: string;
        path: string;
        type: 'file' | 'directory';
        children?: FileNode[];
        checked: boolean;
        partiallyChecked?: boolean;
        expanded?: boolean; // For directories: whether it's expanded
    };

    /**
     * Incoming property if you want to pass a prebuilt array of nodes.
     * If you're loading everything from `window.postMessage(fileTree)`,
     * you can keep this empty and just fill `fileTree` below.
     */
    export let nodes: FileNode[] = [];

    /**
     * The actual data structure we display. If you rely on extension messages,
     * `fileTree` will be populated via a 'fileTree' message event.
     */
    let fileTree: FileNode[] = [];

    /**
     * Hold paths of currently selected (fully checked) files.
     */
    let selectedFiles: string[] = [];

    /**
     * On mount, request the file tree from the extension.
     */
    onMount(() => {
        // Move the event listener inside onMount to avoid duplicate listeners
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.type) {
                case 'fileTree':
                    fileTree = initializeTree(message.value || []);
                    rebuildEntireTree(fileTree);
                    updateSelectedFiles(fileTree);
                    break;
            }
        };

        window.addEventListener('message', messageHandler);

        // Request the file tree
        tsvscode.postMessage({ type: 'getFileTree' });

        // Clean up listener on component destroy
        return () => {
            window.removeEventListener('message', messageHandler);
        };
    });

    /**
     * Sort directories before files, then by name.
     */
    function sortNodes(nodes: FileNode[]): FileNode[] {
        return [...nodes].sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Initialize all nodes with default values (expanded=false, checked=false, etc.).
     */
    function initializeTree(nodes: FileNode[]): FileNode[] {
        for (const node of nodes) {
            node.expanded = node.expanded ?? false;
            node.checked = node.checked ?? false;
            node.partiallyChecked = false;
            if (node.children && node.children.length) {
                initializeTree(node.children);
            }
        }
        return sortNodes(nodes);
    }

    /**
     * Toggle checkbox for a node.
     */
    function toggleCheck(node: FileNode) {
        const newChecked = !node.checked;
        
        // Update the node and all its descendants
        setAllDescendants(node, newChecked);
        
        // Update parent states from this node up to the root
        updateParentStates(node);
        
        // Force a UI update
        fileTree = fileTree;
        
        updateSelectedFiles(fileTree);

        // Add this to send the updated state back to the extension
        tsvscode.postMessage({
            type: 'updateFileTree',
            value: fileTree
        });
    }

    /**
     * Update parent states by traversing up the tree
     */
    function updateParentStates(node: FileNode) {
        // Find the parent by traversing the tree
        const findParentNode = (nodes: FileNode[], targetNode: FileNode): FileNode | null => {
            for (const n of nodes) {
                if (n.children?.includes(targetNode)) {
                    return n;
                }
                if (n.children) {
                    const parent = findParentNode(n.children, targetNode);
                    if (parent) return parent;
                }
            }
            return null;
        };

        let parent = findParentNode(fileTree, node);
        while (parent) {
            const allChecked = parent.children?.every(child => child.checked) ?? false;
            const someChecked = parent.children?.some(child => child.checked || child.partiallyChecked) ?? false;
            
            if (allChecked) {
                parent.checked = true;
                parent.partiallyChecked = false;
            } else if (someChecked) {
                parent.checked = false;
                parent.partiallyChecked = true;
            } else {
                parent.checked = false;
                parent.partiallyChecked = false;
            }
            
            parent = findParentNode(fileTree, parent);
        }
    }

    /**
     * Toggle expansion of a directory node.
     */
    function toggleExpand(node: FileNode) {
        if (node.type === 'directory') {
            node.expanded = !node.expanded;
            // Force Svelte to react to the change
            fileTree = fileTree;

            // Add this to send the updated state back to the extension
            tsvscode.postMessage({
                type: 'updateFileTree',
                value: fileTree
            });
        }
    }

    /**
     * Recursively check/uncheck all children of a node.
     */
    function setAllDescendants(node: FileNode, state: boolean) {
        node.checked = state;
        node.partiallyChecked = false;
        if (node.children) {
            for (const child of node.children) {
                setAllDescendants(child, state);
            }
        }
    }

    /**
     * Rebuild partial-check states from the bottom up.
     */
    function rebuildEntireTree(nodes: FileNode[]) {
        for (const node of nodes) {
            if (node.children && node.children.length > 0) {
                rebuildEntireTree(node.children);
                updateDirectoryCheckState(node);
            }
        }
    }

    /**
     * For a directory node, determine if it should be fully, partially, or not checked.
     */
    function updateDirectoryCheckState(dirNode: FileNode) {
        if (!dirNode.children) return;

        const total = dirNode.children.length;
        let checkedCount = 0;
        let partialCount = 0;

        for (const child of dirNode.children) {
            if (child.checked) checkedCount++;
            if (child.partiallyChecked) partialCount++;
        }

        if (checkedCount === total) {
            // All children checked
            dirNode.checked = true;
            dirNode.partiallyChecked = false;
        } else if (checkedCount === 0 && partialCount === 0) {
            // None checked
            dirNode.checked = false;
            dirNode.partiallyChecked = false;
        } else {
            // Mixed state
            dirNode.checked = false;
            dirNode.partiallyChecked = true;
        }
    }

    /**
     * Update the list of selectedFiles with every fully-checked file.
     * Fully-checked directories automatically include all child files.
     */
    function updateSelectedFiles(nodes: FileNode[]) {
        const result: string[] = [];

        function traverse(node: FileNode) {
            if (node.type === 'file') {
                if (node.checked) {
                    result.push(node.path);
                }
            } else if (node.type === 'directory') {
                if (node.checked && !node.partiallyChecked) {
                    // If the dir is fully checked, add *all* its files
                    gatherAllFiles(node, result);
                } else if (node.children) {
                    // Otherwise, keep drilling down
                    for (const child of node.children) {
                        traverse(child);
                    }
                }
            }
        }

        for (const rootNode of nodes) {
            traverse(rootNode);
        }

        selectedFiles = result;
    }

    /**
     * Helper to gather all files from a fully checked directory.
     */
    function gatherAllFiles(dirNode: FileNode, result: string[]) {
        if (!dirNode.children) return;
        for (const child of dirNode.children) {
            if (child.type === 'file') {
                result.push(child.path);
            } else if (child.type === 'directory') {
                gatherAllFiles(child, result);
            }
        }
    }

    /**
     * Button actions – copy selected files to clipboard.
     */
    function copyToClipboard() {
        if (selectedFiles.length === 0) {
            tsvscode.postMessage({
                type: 'onInfo',
                value: 'Please select at least one file'
            });
            return;
        }

        tsvscode.postMessage({
            type: 'copyToClipboard',
            files: selectedFiles
        });
    }

    /**
     * Button actions – generate new text file with content of selected files.
     */
    function generateTextFile() {
        if (selectedFiles.length === 0) {
            tsvscode.postMessage({
                type: 'onInfo',
                value: 'Please select at least one file'
            });
            return;
        }

        tsvscode.postMessage({
            type: 'generateTextFile',
            files: selectedFiles
        });
    }
</script>

<style>
    :global(body) {
        padding: 0;
        margin: 0;
        width: 100%;
        height: 100vh;
        overflow: hidden;
        background-color: var(--vscode-sideBar-background);
        border-top: 1px solid var(--vscode-sideBar-border);
    }

    .sidebar {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100%;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        
    }

    .tree-container {
        flex: 1;
        overflow-y: auto;
        width: 100%;
        padding: 0;
    }

    ul {
        list-style: none;
        margin: 0;
        padding: 0;
        width: 100%;
    }

    .tree-item {
        margin: 0;
        width: 100%;
    }

    .tree-row {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        margin: 0;
        width: 100%;
        box-sizing: border-box;
    }

    .tree-children {
        margin-left: 0;
        padding-left: 24px;
        border-left: 1px solid var(--vscode-tree-indentGuidesStroke);
        width: 100%;
        box-sizing: border-box;
    }

    .tree-row:hover {
        background: var(--vscode-list-hoverBackground);
    }

    .checkbox-wrapper {
        position: relative;
        width: 16px;
        height: 16px;
        margin-right: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .checkbox-wrapper input {
        position: absolute;
        width: 16px;
        height: 16px;
        opacity: 0;
        cursor: pointer;
        margin: 0;
        z-index: 1;
    }

    .checkmark {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        height: 14px;
        width: 14px;
        border: 1px solid var(--vscode-checkbox-border);
        background: var(--vscode-checkbox-background);
        transition: background-color 0.1s ease;
        border-radius: 2px;
    }

    .checkbox-wrapper input:checked ~ .checkmark {
        background: var(--vscode-checkbox-selectBackground);
        border-color: var(--vscode-checkbox-selectBorder);
    }

    .checkbox-wrapper input:checked ~ .checkmark:after {
        content: "";
        position: absolute;
        left: 4px;
        top: 1px;
        width: 4px;
        height: 8px;
        border: solid white;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
    }

    .partially-checked .checkmark {
        background: var(--vscode-checkbox-selectBackground);
        border-color: var(--vscode-checkbox-selectBorder);
    }

    .partially-checked .checkmark:after {
        content: "";
        position: absolute;
        left: 2px;
        top: 6px;
        width: 8px;
        height: 2px;
        background: white;
        border-radius: 1px;
    }

    .icon {
        width: 16px;
        height: 16px;
        margin-right: 6px;
        flex-shrink: 0;
    }

    .icon.directory {
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23C5C5C5' d='M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h12v4.49z'/%3E%3C/svg%3E") center no-repeat;
    }

    .icon.file {
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath fill='%23C5C5C5' d='M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM13 14H4V2h5v4h4v8z'/%3E%3C/svg%3E") center no-repeat;
    }

    .arrow {
        display: inline-block;
        margin-right: 6px;
        width: 12px;
        text-align: center;
        font-size: 12px;
        user-select: none;
    }

    .arrow::before {
        content: "▶";
    }

    .arrow.expanded::before {
        content: "▼";
    }

    .name {
        flex: 1;
        user-select: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Action buttons */
    .actions {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 10px;
        padding: 10px 10px;
        width: 100%;
        background: var(--vscode-sideBar-background);
        border-top: 1px solid var(--vscode-sideBar-border);
    }

    button {
        padding: 12px 12px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        transition: background 0.2s;
    }

    button:hover {
        background: var(--vscode-button-hoverBackground);
    }
</style>

<div class="sidebar">
    <div class="tree-container">
        <ul>
            {#each (nodes && nodes.length ? nodes : fileTree) as node}
                <li class="tree-item">
                    <div class="tree-row">
                        {#if node.type === 'directory'}
                            <span 
                                class="arrow"
                                class:expanded={node.expanded}
                                on:click={() => toggleExpand(node)}
                            />
                        {:else}
                            <span style="display:inline-block;width:12px;margin-right:6px;" />
                        {/if}

                        <!-- Checkbox -->
                        <div 
                            class="checkbox-wrapper" 
                            class:partially-checked={node.partiallyChecked}
                        >
                            <input
                                type="checkbox"
                                checked={node.checked}
                                on:change={() => toggleCheck(node)}
                            />
                            <span class="checkmark"></span>
                        </div>

                        <!-- Icon + Name -->
                        <span 
                            class={"icon " + node.type} 
                            on:click={() => node.type === 'directory' && toggleExpand(node)}
                        ></span>
                        <span class="name" on:click={() => node.type === 'directory' && toggleExpand(node)}>
                            {node.name}
                        </span>
                    </div>

                    {#if node.type === 'directory' && node.expanded && node.children && node.children.length}
                        <ul class="tree-children">
                            {#each sortNodes(node.children) as child}
                                <li class="tree-item">
                                    <div class="tree-row">
                                        {#if child.type === 'directory'}
                                            <span 
                                                class="arrow"
                                                class:expanded={child.expanded}
                                                on:click={() => toggleExpand(child)}
                                            />
                                        {:else}
                                            <span style="display:inline-block;width:12px;margin-right:6px;" />
                                        {/if}

                                        <div 
                                            class="checkbox-wrapper" 
                                            class:partially-checked={child.partiallyChecked}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={child.checked}
                                                on:change={() => toggleCheck(child)}
                                            />
                                            <span class="checkmark"></span>
                                        </div>

                                        <span 
                                            class={"icon " + child.type} 
                                            on:click={() => child.type === 'directory' && toggleExpand(child)}
                                        ></span>
                                        <span class="name" on:click={() => child.type === 'directory' && toggleExpand(child)}>
                                            {child.name}
                                        </span>
                                    </div>

                                    {#if child.type === 'directory' && child.expanded && child.children && child.children.length}
                                        <ul class="tree-children">
                                            {#each sortNodes(child.children) as grandchild}
                                                <li class="tree-item">
                                                    <div class="tree-row">
                                                        {#if grandchild.type === 'directory'}
                                                            <span
                                                                class="arrow"
                                                                class:expanded={grandchild.expanded}
                                                                on:click={() => toggleExpand(grandchild)}
                                                            />
                                                        {:else}
                                                            <span style="display:inline-block;width:12px;margin-right:6px;" />
                                                        {/if}

                                                        <div
                                                            class="checkbox-wrapper"
                                                            class:partially-checked={grandchild.partiallyChecked}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={grandchild.checked}
                                                                on:change={() => toggleCheck(grandchild)}
                                                            />
                                                            <span class="checkmark"></span>
                                                        </div>

                                                        <span
                                                            class={"icon " + grandchild.type}
                                                            on:click={() => grandchild.type === 'directory' && toggleExpand(grandchild)}
                                                        ></span>
                                                        <span class="name" on:click={() => grandchild.type === 'directory' && toggleExpand(grandchild)}>
                                                            {grandchild.name}
                                                        </span>
                                                    </div>
                                                </li>
                                            {/each}
                                        </ul>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </li>
            {/each}
        </ul>
    </div>
    <div class="actions">
        <button on:click={copyToClipboard}>
            Copy to Clipboard ({selectedFiles.length} selected)
        </button>
        <button on:click={generateTextFile}>
            Generate Text File ({selectedFiles.length} selected)
        </button>
    </div>
</div>
